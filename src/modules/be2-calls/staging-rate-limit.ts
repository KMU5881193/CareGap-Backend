/**
 * Process-local fixed-window rate limiter for the single-instance staging server.
 * Not a distributed limiter — sufficient for one Render web service instance.
 */
export class FixedWindowRateLimiter {
  readonly #windowMs: number;
  readonly #max: number;
  readonly #hits = new Map<string, { count: number; resetAt: number }>();

  constructor(opts: { windowMs: number; max: number }) {
    this.#windowMs = opts.windowMs;
    this.#max = opts.max;
  }

  /** @returns true when the request is allowed */
  allow(key: string, now = Date.now()): boolean {
    const row = this.#hits.get(key);
    if (!row || row.resetAt <= now) {
      this.#hits.set(key, { count: 1, resetAt: now + this.#windowMs });
      return true;
    }
    if (row.count >= this.#max) return false;
    row.count += 1;
    return true;
  }

  reset(): void {
    this.#hits.clear();
  }
}
