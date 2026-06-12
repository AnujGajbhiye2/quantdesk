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

  cron.schedule(
    monitorSchedule,
    async () => {
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
