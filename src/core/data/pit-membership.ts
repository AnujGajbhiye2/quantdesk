/**
 * Point-in-time index membership reconstruction.
 *
 * Backtests and edge stats normally run against TODAY's constituent list
 * applied retroactively - a stock that was added to the S&P 500 in 2023
 * appears to have been "in the index" back in 2015 too. That's survivorship
 * bias: delisted/dropped names are invisible, and every reported win rate,
 * profit factor, and Sharpe is optimistically skewed.
 *
 * This module replays a ledger of {date, symbol, added|removed} events
 * backward from the current constituent list to reconstruct membership as of
 * any past date. Pure logic here (no DB) - the DB-facing wrapper lives in
 * core/db/membership.ts, the scraper in scripts/build-pit-membership.ts.
 */

export interface MembershipChange {
  effectiveDate: string; // 'YYYY-MM-DD'
  symbol:        string;
  action:        'added' | 'removed';
}

/**
 * Reconstruct index membership as of `date`, given today's constituent list
 * and the ledger of changes since. Changes with effectiveDate > `date` are
 * undone in reverse: an 'added' after `date` means the symbol wasn't a
 * member yet, so it's removed from the working set; a 'removed' after `date`
 * means the symbol was still a member, so it's added back.
 *
 * @param currentMembers  Today's constituent symbols.
 * @param changes         Full change ledger for the index, any order.
 * @param date            Target date, 'YYYY-MM-DD'.
 */
export function membershipAsOf(
  currentMembers: readonly string[],
  changes: readonly MembershipChange[],
  date: string,
): Set<string> {
  const members = new Set(currentMembers);

  // Undo changes strictly after the target date, latest first, so that a
  // symbol added then removed (or vice versa) multiple times after `date`
  // replays correctly.
  const toUndo = changes
    .filter((c) => c.effectiveDate > date)
    .sort((a, b) => (a.effectiveDate < b.effectiveDate ? 1 : a.effectiveDate > b.effectiveDate ? -1 : 0));

  for (const c of toUndo) {
    if (c.action === 'added') {
      members.delete(c.symbol);
    } else {
      members.add(c.symbol);
    }
  }

  return members;
}

/**
 * Was `symbol` a member of the index on `date`? Convenience wrapper over
 * membershipAsOf for a single-symbol check (e.g. filtering a backtest
 * universe at a given rebalance date).
 */
export function wasMemberOn(
  symbol: string,
  currentMembers: readonly string[],
  changes: readonly MembershipChange[],
  date: string,
): boolean {
  return membershipAsOf(currentMembers, changes, date).has(symbol);
}
