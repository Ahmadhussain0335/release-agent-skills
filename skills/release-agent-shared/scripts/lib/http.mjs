export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Exponential backoff: initial, 2x initial, 4x initial ... capped at max. */
export function backoffDelay(attempt, initialMs, maxMs) {
  return Math.min(initialMs * 2 ** attempt, maxMs);
}

/** fetch with a timeout and a few retries on network errors and 5xx responses. */
export async function fetchWithRetry(url, init = {}, { fetchImpl = fetch, retries = 2, timeoutMs = 30000, sleepImpl = sleep } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      if (res.status < 500 || attempt === retries) return res;
      lastError = new Error(`HTTP ${res.status}`);
    } catch (err) {
      lastError = err;
      if (attempt === retries) break;
    }
    await sleepImpl(backoffDelay(attempt, 1000, 8000));
  }
  throw new Error(`Request to ${new URL(url).host} failed: ${lastError?.message ?? 'unknown error'}`);
}
