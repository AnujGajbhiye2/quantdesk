/**
 * Next.js instrumentation hook.
 * Runs once on server startup (nodejs runtime only - not edge).
 *
 * Responsibilities:
 * - Per-market EOD refresh + daily auto-trade crons (NSE, EU, US+commodities).
 * - Start the open-trade stop/target proximity monitor (Telegram alerts).
 * - Intraday auto-trade cron (US equities via Alpaca, gated by AUTO_TRADE_ENABLED).
 *
 * Cron schedule env vars (all Europe/Dublin unless noted):
 *   NSE_SCAN_CRON       - default "30 11 * * 1-5" (11:30 - safely after NSE 15:30 IST close)
 *   EU_SCAN_CRON        - default "45 16 * * 1-5" (16:45 - after EU continental close)
 *   REFRESH_CRON        - default "5 21 * * 1-5"  (21:05 - US close; also runs daily auto-trade)
 *   REFRESH_TZ          - default "Europe/Dublin"
 *   MONITOR_CRON        - proximity monitor, default every 15 min Mon-Fri
 *                         no-op unless TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID are set
 *   DAILY_AUTO_TRADE_ENABLED=1 - activate daily paper-trade execution (NSE/EU/US)
 *
 * The crons only run while the Next.js server process is alive.
 * For production use a system cron / scheduled task calling `npm run refresh` instead.
 */

export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  // Local-dev safety switch: once local points at the shared Turso DB, this
  // suppresses ALL crons below (including the monitor cron's write path,
  // fillPendingTradesWithQuotes()) before anything registers or logs.
  // Does NOT block manual actions (UI buttons / direct API calls) - see .env.local.example.
  if (process.env.LOCAL_DEV_MODE === '1') {
    console.log('[instrumentation] LOCAL_DEV_MODE=1 - all crons disabled (shared-DB safety).');
    return;
  }

  // Lazy import to avoid loading server-only code during edge/build evaluation
  const { default: cron } = await import('node-cron');
  const timezone = process.env.REFRESH_TZ ?? 'Europe/Dublin';

  // ---------------------------------------------------------------------------
  // Helper: run a per-market daily scan + trade execution tick
  // ---------------------------------------------------------------------------
  async function runMarketTick(
    market: 'nse' | 'eu' | 'sp500' | 'commodity',
    label: string,
  ): Promise<void> {
    console.log(`[cron:${label}] daily tick started...`);
    const ingestStartedAt = new Date().toISOString();
    try {
      const { universeForMarket } = await import('@/core/data/universe');
      const { refreshUniverse }   = await import('@/core/data/ingest');
      const universe = universeForMarket(market);
      const results  = await refreshUniverse(universe, '1d');
      const totalBars = results.reduce((sum, r) => sum + r.barsAdded, 0);
      const errors    = results.filter((r) => r.error).length;
      console.log(`[cron:${label}] refresh done. ${results.length} symbols, ${totalBars} bars, ${errors} error(s).`);

      // Log ingest run
      try {
        const { buildIngestRunInput, insertIngestRun, pruneOldIngestRuns } = await import('@/core/db/ingest-log');
        insertIngestRun(buildIngestRunInput(results, ingestStartedAt, 'eod-cron'));
        pruneOldIngestRuns(30);
      } catch (err) {
        console.error(`[cron:${label}] ingest log write failed (non-fatal):`, err);
      }

      // Daily auto-trade (scan + execute) for this market
      const { runDailyAutoTrade } = await import('@/core/paper/daily-auto-trade');
      const dailyResult = await runDailyAutoTrade({ market });
      if (dailyResult.enabled) {
        console.log(
          `[cron:${label}] daily auto-trade done.` +
          ` entries:${dailyResult.entries.length}` +
          ` exits:${dailyResult.exits.length}` +
          ` skips:${dailyResult.skips.length}` +
          ` signals:${dailyResult.signals}` +
          ` halted:${dailyResult.halted}` +
          (dailyResult.dryRun ? ' [DRY RUN]' : ''),
        );
      }

      // Invalidate snapshot cache
      try {
        const { invalidateSnapshotCache } = await import('@/core/market/snapshot');
        invalidateSnapshotCache();
      } catch { /* non-fatal */ }

    } catch (err) {
      console.error(`[cron:${label}] tick failed:`, err);
    }
  }

  // ---------------------------------------------------------------------------
  // NSE scan cron - after NSE close (15:30 IST = ~11:00 Dublin summer / 10:30 winter)
  // 11:30 is safe for both DST seasons
  // ---------------------------------------------------------------------------
  const nseCronExpr = process.env.NSE_SCAN_CRON ?? '30 11 * * 1-5';
  if (cron.validate(nseCronExpr)) {
    console.log(`[instrumentation] NSE scan cron: "${nseCronExpr}" (${timezone})`);
    cron.schedule(nseCronExpr, () => runMarketTick('nse', 'nse'), { timezone });
  } else {
    console.error(`[instrumentation] Invalid NSE_SCAN_CRON: "${nseCronExpr}". NSE scan not started.`);
  }

  // ---------------------------------------------------------------------------
  // EU scan cron - after European continental close (~16:30 UTC, same as Dublin year-round)
  // 16:45 gives 15 min buffer
  // ---------------------------------------------------------------------------
  const euCronExpr = process.env.EU_SCAN_CRON ?? '45 16 * * 1-5';
  if (cron.validate(euCronExpr)) {
    console.log(`[instrumentation] EU scan cron: "${euCronExpr}" (${timezone})`);
    cron.schedule(euCronExpr, () => runMarketTick('eu', 'eu'), { timezone });
  } else {
    console.error(`[instrumentation] Invalid EU_SCAN_CRON: "${euCronExpr}". EU scan not started.`);
  }

  // ---------------------------------------------------------------------------
  // US + Commodities scan cron (21:05 Dublin = ~16:05 ET)
  // Also runs edge compute + heartbeat for the full universe.
  // ---------------------------------------------------------------------------
  const usCronExpr = process.env.REFRESH_CRON ?? '5 21 * * 1-5';
  if (!cron.validate(usCronExpr)) {
    console.error(`[instrumentation] Invalid REFRESH_CRON: "${usCronExpr}". US scan not started.`);
  } else {
    console.log(`[instrumentation] US scan cron: "${usCronExpr}" (${timezone})`);
    cron.schedule(
      usCronExpr,
      async () => {
        // SP500 + commodity refreshes + daily auto-trade
        await runMarketTick('sp500', 'sp500');
        await runMarketTick('commodity', 'commodity');

        // Post-refresh: sweep pending limit orders + edge stats (full universe)
        const ingestStartedAt = new Date().toISOString();
        try {
          const { postRefreshTasks } = await import('@/core/data/post-refresh');
          const post = await postRefreshTasks();
          if (post.sweep.error)        console.error('[cron:us] sweep failed:', post.sweep.error);
          if (post.scan.error)         console.error('[cron:us] scan-all failed:', post.scan.error);
          if (post.edge.error)         console.error('[cron:us] edge compute failed:', post.edge.error);
          if (post.fundamentalsPrefetch?.error) {
            console.error('[cron:us] fundamentals prefetch failed:', post.fundamentalsPrefetch.error);
          }
          if (post.fundamentalsPrefetch?.result) {
            const f = post.fundamentalsPrefetch.result;
            console.log(`[cron:us] fundamentals prefetch: ${f.fetched} fetched, ${f.cached} cached, ${f.failed} failed of ${f.attempted}.`);
          }
          if (post.scan.result) {
            const s = post.scan.result;
            console.log(`[cron:us] scan-all done. ${s.scanned} symbols, ${s.signals.length} signals, ${s.durationMs}ms.`);
          }
          if (post.edge.result) {
            const e = post.edge.result;
            console.log(`[cron:us] edge stats done. ${e.rows} rows (${e.recomputed} recomputed), ${e.durationMs}ms.`);
          }

          // Daily heartbeat
          try {
            const { sendDailyHeartbeat } = await import('@/core/notify/heartbeat');
            // Re-use aggregate from postRefreshTasks scan result for heartbeat
            await sendDailyHeartbeat({
              totalBars:     post.scan.result?.scanned ?? 0,
              symbolCount:   post.scan.result?.scanned ?? 0,
              refreshErrors: 0,
              post,
            });
          } catch (err) {
            console.error('[cron:us] heartbeat failed:', err);
          }
          void ingestStartedAt;
        } catch (err) {
          console.error('[cron:us] post-refresh failed:', err);
        }
      },
      { timezone },
    );
  }

  // ---------------------------------------------------------------------------
  // Stop/target proximity monitor - Telegram alerts for open paper trades
  // ---------------------------------------------------------------------------
  const { checkOpenTrades }    = await import('@/core/notify/monitor');
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

  // ---------------------------------------------------------------------------
  // Auto-trading cron - intraday signal scan + paper-trade execution (US only)
  // ---------------------------------------------------------------------------
  const alpacaEnabled     = process.env.ALPACA_ENABLED === '1';
  const autoTradeEnabled  = alpacaEnabled && process.env.AUTO_TRADE_ENABLED === '1';
  const autoTradeCron     = process.env.AUTO_TRADE_CRON ?? '*/15 9-16 * * 1-5';
  const autoTradeTimezone = 'America/New_York';

  if (!alpacaEnabled) {
    console.log('[instrumentation] Alpaca disabled (ALPACA_ENABLED != 1). Intraday auto-trade cron not started.');
  } else if (!autoTradeEnabled) {
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
