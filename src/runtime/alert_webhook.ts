export interface WeixinAlertPayload {
  type: string;
  stage: string;
  message: string;
  at: number;
  restartCount?: number;
  pendingDeliveryRetries?: number;
}

interface PostAlertOptions {
  minIntervalMs?: number;
  timeoutMs?: number;
}

let lastSentAt = 0;
let lastKey = '';

/**
 * POSTs an error alert to a configured webhook URL.
 *
 * - No-op (returns false) when the URL is empty or not http(s).
 * - Debounces by (stage + message): an identical alert within `minIntervalMs`
 *   is suppressed so a burst of the same error does not spam the webhook.
 * - Uses an AbortController timeout so a slow/hung webhook can never stall the
 *   caller (the runtime error path).
 *
 * Never throws — failures are swallowed and reported via the boolean return.
 */
export async function postAlert(
  url: string | null | undefined,
  payload: WeixinAlertPayload,
  { minIntervalMs = 60_000, timeoutMs = 5_000 }: PostAlertOptions = {},
): Promise<boolean> {
  const target = String(url ?? '').trim();
  if (!target || !/^https?:\/\//iu.test(target)) {
    return false;
  }
  const now = Date.now();
  const key = `${payload.stage}:${payload.message}`;
  if (key === lastKey && now - lastSentAt < Math.max(0, minIntervalMs)) {
    return false;
  }
  lastKey = key;
  lastSentAt = now;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1, timeoutMs));
  try {
    await fetch(target, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** Test-only helper to reset the module-level debounce state. */
export function resetAlertDebounceForTests(): void {
  lastSentAt = 0;
  lastKey = '';
}
