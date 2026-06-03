/**
 * Next.js instrumentation hook.
 * Runs once on server startup (nodejs runtime only - not edge).
 *
 * Responsibilities:
 * - Start the EOD data refresh cron job.
 *
 * Cron schedule env vars:
 *   REFRESH_CRON  - cron expression, default "5 21 * * 1-5" (21:05 Mon-Fri)
 *   REFRESH_TZ    - timezone, default "Europe/Dublin" (~16:05 ET)
 *
 * The cron only runs while the Next.js server process is alive.
 * For production use a system cron / scheduled task calling `npm run refresh` instead.
 */

export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  // Lazy import to avoid loading server-only code during edge/build evaluation
  const { default: cron } = await import('node-cron');
  const { refreshUniverse } = await import('@/core/data/ingest');

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
      } catch (err) {
        console.error('[cron] EOD refresh failed:', err);
      }
    },
    { timezone },
  );
}
