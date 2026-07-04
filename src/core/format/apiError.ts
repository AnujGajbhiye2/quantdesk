/** API errors come back as `{ error: "..." }` JSON - extract the message
 *  instead of surfacing the raw response body (dumping the whole JSON
 *  blob - extra fields like existingTradeId included - into UI status lines). */
export async function fetchErrorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    if (body?.error) return body.error;
  } catch { /* not JSON - fall through */ }
  return res.statusText || `request failed (${res.status})`;
}
