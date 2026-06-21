/**
 * Next.js instrumentation hook.
 * Runs once on server startup (nodejs runtime only - not edge).
 *
 * Responsibilities:
 * - Start the EOD data refresh cron job.
 * - Start the open-trade stop/target proximity monitor (Telegram alerts).
 *
 * Cron schedule env vars:
 *   REFRESH_CRON  - cron expression, default "5 21 * * 1-5" (21:05 Mon-Fri)
 *   REFRESH_TZ    - timezone, default "Europe/Dublin" (~16:05 ET)
 *   MONITOR_CRON  - proximity monitor, default every 15 min Mon-Fri
 *                   no-op unless TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID are set
 *
 * The crons only run while the Next.js server process is alive.
 * For production use a system cron / scheduled task calling `npm run refresh` instead.
 */

export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  // Lazy import to avoid loading server-only code during edge/build evaluation
  const { default: cron } = await import('node-cron');
  const { refreshUniverse } = await import('@/core/data/ingest');
  const { postRefreshTasks } = await import('@/core/data/post-refresh');

  const schedule = process.env.REFRESH_CRON ?? '5 21 * * 1-5';
  const timezone = process.env.REFRESH_TZ ?? 'Europe/Dublin';

  if (!cron.validate(schedule)) {
    console.error(`[instrumentation] Invalid REFRESH_CRON expression: "${schedule}". Cron not started.`);
    return;
  }

  console.log(`[instrumentation] EOD refresh cron: "${schedule}" (${timezone})`);

  cron.schedule(
    schedule,
    async () => {
      console.log('[cron] EOD refresh started...');
      try {
        const results = await refreshUniverse();
        const totalBars = results.reduce((sum, r) => sum + r.barsAdded, 0);
        const errors = results.filter((r) => r.error).length;
        console.log(
          `[cron] EOD refresh done. ${results.length} symbols, ${totalBars} new bars, ${errors} error(s).`,
        );
        const post = postRefreshTasks();
        if (post.sweep.error) console.error('[cron] sweep failed:', post.sweep.error);
        if (post.scan.error)  console.error('[cron] scan-all failed:', post.scan.error);
        if (post.edge.error)  console.error('[cron] edge compute failed:', post.edge.error);
        if (post.scan.result) {
          const s = post.scan.result;
          console.log(
            `[cron] scan-all done. ${s.scanned} symbols, ${s.signals.length} signals, ${s.durationMs}ms.`,
          );
        }
        if (post.edge.result) {
          const e = post.edge.result;
          console.log(
            `[cron] edge stats done. ${e.rows} rows (${e.recomputed} recomputed), ${e.durationMs}ms.`,
          );
        }

        // Daily heartbeat - fires every trading day; its absence signals failure
        try {
          const { sendDailyHeartbeat } = await import('@/core/notify/heartbeat');
          await sendDailyHeartbeat({
            totalBars,
            symbolCount: results.length,
            refreshErrors: errors,
            post,
          });
        } catch (err) {
          console.error('[cron] heartbeat failed:', err);
        }
      } catch (err) {
        console.error('[cron] EOD refresh failed:', err);
      }
    },
    { timezone },
  );

  // Stop/target proximity monitor - Telegram alerts for open paper trades
  const { checkOpenTrades } = await import('@/core/notify/monitor');
  const { telegramConfigured } = await import('@/core/notify/telegram');

  const monitorSchedule = process.env.MONITOR_CRON ?? '*/15 * * * 1-5';
  if (!cron.validate(monitorSchedule)) {
    console.error(`[instrumentation] Invalid MONITOR_CRON expression: "${monitorSchedule}". Monitor not started.`);
    return;
  }

  if (!telegramConfigured()) {
    console.log('[instrumentation] Telegram env not set - stop/target monitor idle (set TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID)');
  } else {
    console.log(`[instrumentation] Stop/target monitor cron: "${monitorSchedule}" (${timezone})`);
  }

  // ------------------------------------------------------------------
  // Auto-trading cron - intraday signal scan + paper-trade execution
  // ------------------------------------------------------------------
  const autoTradeEnabled  = process.env.AUTO_TRADE_ENABLED === '1';
  const autoTradeCron     = process.env.AUTO_TRADE_CRON ?? '*/15 9-16 * * 1-5';
  const autoTradeTimezone = 'America/New_York';

  if (!autoTradeEnabled) {
    console.log('[instrumentation] Auto-trading disabled (AUTO_TRADE_ENABLED != 1). Set to 1 to enable.');
  } else if (!cron.validate(autoTradeCron)) {
    console.error(`[instrumentation] Invalid AUTO_TRADE_CRON: "${autoTradeCron}". Auto-trade cron not started.`);
  } else {
    const dryRun = process.env.AUTO_TRADE_DRY_RUN === '1';
    const tf     = process.env.AUTO_TRADE_TIMEFRAME ?? '15m';
    console.log(
      `[instrumentation] Auto-trade cron: "${autoTradeCron}" (${autoTradeTimezone})` +
      ` | timeframe: ${tf}` +
      (dryRun ? ' | DRY RUN' : ' | LIVE PAPER'),
    );

    cron.schedule(
      autoTradeCron,
      async () => {
        try {
          const { ingestIntraday } = await import('@/core/data/intraday-ingest');
          const ingest = await ingestIntraday(tf as import('@/core/types').Timeframe);
          if (ingest.errors > 0) {
            console.warn(`[auto-trade] ingest: ${ingest.symbols} symbols, ${ingest.barsAdded} bars, ${ingest.errors} error(s)`);
          }

          const { runAutoTrade } = await import('@/core/paper/auto-trade');
          const result = await runAutoTrade({ timeframe: tf as import('@/core/types').Timeframe });

          if (!result.marketOpen) return; // silent off-hours
          console.log(
            `[auto-trade] ${result.etTime} ET | entries:${result.entries.length}` +
            ` exits:${result.exits.length} skips:${result.skips.length}` +
            ` halted:${result.halted}` +
            (result.dryRun ? ' [DRY RUN]' : ''),
          );
          if (result.haltReason) console.warn('[auto-trade] HALT:', result.haltReason);
        } catch (err) {
          console.error('[auto-trade] tick failed:', err);
        }
      },
      { timezone: autoTradeTimezone },
    );
  }

  cron.schedule(
    monitorSchedule,
    async () => {
      // Poll Telegram for inbound commands (/halt, /resume, /status) first
      try {
        const { pollTelegramCommands } = await import('@/core/notify/commands');
        await pollTelegramCommands();
      } catch (err) {
        console.error('[monitor] command poll failed:', err);
      }

      try {
        // Check resting limit orders against live quotes first; fills fire Telegram
        const { fillPendingTradesWithQuotes } = await import('@/core/paper/broker');
        const fills = await fillPendingTradesWithQuotes();
        const filled = fills.filter((r) => r.action === 'filled').length;
        if (filled > 0) {
          console.log(`[monitor] ${filled} pending trade(s) filled via live quote`);
        }
      } catch (err) {
        console.error('[monitor] pending fill check failed:', err);
      }

      try {
        const result = await checkOpenTrades();
        if (!result.configured) return; // silent when Telegram unset
        if (result.alertsSent > 0 || result.errors.length > 0) {
          console.log(
            `[monitor] ${result.checked} open trade(s) checked, ${result.alertsSent} alert(s) sent` +
            (result.errors.length ? `, errors: ${result.errors.join('; ')}` : ''),
          );
        }
      } catch (err) {
        console.error('[monitor] check failed:', err);
      }
    },
    { timezone },
  );
}
