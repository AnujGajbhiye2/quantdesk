/** Format an ISO date string (YYYY-MM-DD or full ISO) as DD-MM-YYYY for display. */
export function fmtDate(s: string | undefined | null): string {
  if (!s) return '--';
  const iso = s.slice(0, 10); // YYYY-MM-DD
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return s.slice(0, 10);
  return `${d}-${m}-${y}`;
}

/** Format an ISO datetime as DD-MM-YYYY HH:MM UTC for display. */
export function fmtDateTime(s: string | undefined | null): string {
  if (!s) return '--';
  const dt = new Date(s);
  if (isNaN(dt.getTime())) return '--';
  const dd  = String(dt.getUTCDate()).padStart(2, '0');
  const mm  = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = dt.getUTCFullYear();
  const hh  = String(dt.getUTCHours()).padStart(2, '0');
  const min = String(dt.getUTCMinutes()).padStart(2, '0');
  return `${dd}-${mm}-${yyyy} ${hh}:${min} UTC`;
}
