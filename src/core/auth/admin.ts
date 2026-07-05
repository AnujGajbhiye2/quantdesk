// Edge-safe: no DB, no bcrypt, no server-only. Imported by both middleware
// (Edge runtime) and the Node auth config.
export const ADMIN_EMAIL = (process.env.ADMIN_EMAIL ?? 'anujgajbhiye97@gmail.com').toLowerCase();

export function isAdminEmail(email: string | null | undefined): boolean {
  return !!email && email.toLowerCase() === ADMIN_EMAIL;
}
