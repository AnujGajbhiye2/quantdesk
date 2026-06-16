import 'server-only';
import { spawn } from 'node:child_process';
import { tradingViewChartUrl } from './symbol';

/**
 * Open the TradingView chart for a symbol in the system default browser.
 *
 * Fire-and-forget: never throws. Errors are logged but never propagate -
 * this must not break trade creation under any circumstances.
 *
 * Guards:
 *   - QD_TRADINGVIEW_AUTOOPEN must be '1' (off by default)
 *   - macOS only (uses `open` command)
 */
export function openTradingViewChart(symbol: string): void {
  if (process.env.QD_TRADINGVIEW_AUTOOPEN !== '1') return;
  if (process.platform !== 'darwin') return;

  const url = tradingViewChartUrl(symbol);

  try {
    const child = spawn('open', [url], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
  } catch (err) {
    // Log only - must not surface to the caller
    console.warn('[tradingview] failed to open chart for', symbol, err);
  }
}
