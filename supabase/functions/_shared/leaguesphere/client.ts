/**
 * The only place that talks to LeagueSphere.
 *
 * Everything here exists because we are a guest on someone else's API:
 *
 *  - **Conditional requests.** Every call sends `If-None-Match`. A 304 costs upstream almost
 *    nothing and costs us no parsing, and on a quiet day nearly every call is a 304.
 *  - **Throttles are hard limits, not hints.** Upstream has three: a narrow `/api/snapshot/`
 *    scope may rebuild 600 times an hour, a dump or any `include=standings` request is charged
 *    against 60 an hour, and all anonymous traffic gets 120 a minute. A 429 is obeyed for as
 *    long as `Retry-After` says, by the bucket that received it and across cron ticks.
 *  - **Local caps below the upstream ones.** Being throttled means serving stale results, so
 *    the client refuses to exceed its own budgets (300 narrow and 20 standings snapshot
 *    calls/hour) before upstream has to refuse us. Supabase Edge Functions share an egress IP
 *    with every other project in the region, so the budget we actually get may be smaller than
 *    the documented one.
 *  - **A timeout.** A hung fetch would otherwise hold the invocation open until the platform
 *    kills it, and the next cron tick would pile onto it.
 *
 * `fetchImpl` and `now` are injected so the tests can drive every branch without a network.
 */

/**
 * Upstream's own limits, for reference. We stay under them deliberately.
 *
 * Upstream charges dumps and any `include=standings` request against this one
 * (`is_large_scope`, `gamedays/api/snapshot.py`).
 */
export const UPSTREAM_SNAPSHOT_LIMIT_PER_HOUR = 60;
/**
 * Narrow scopes only. Counted per rebuild: a 304 costs no rebuild, and a narrow scope is
 * rebuilt at most every 30 s.
 */
export const UPSTREAM_SNAPSHOT_REBUILD_LIMIT_PER_HOUR = 600;
export const UPSTREAM_ANON_LIMIT_PER_MINUTE = 120;

/** Our narrow-scope budget. Half of upstream's, because the egress IP is shared. */
export const NARROW_SNAPSHOT_CAP_PER_HOUR = 300;
/** Our standings budget. A third of upstream's 60, which dumps share. */
export const STANDINGS_SNAPSHOT_CAP_PER_HOUR = 20;

export const DEFAULT_TIMEOUT_MS = 20_000;

/**
 * Where LeagueSphere is.
 *
 * Overridable through `LEAGUESPHERE_BASE_URL` so a recorded gameday can be replayed against a
 * local stand-in (see `scripts/results-parity/replay-live.ts`) without the live tab being
 * something we only ever find out about during a real game. Unset — which is every deployed
 * environment — it is the real thing.
 */
export const BASE_URL = readBaseUrl();

function readBaseUrl(): string {
  const configured = safeEnv('LEAGUESPHERE_BASE_URL');
  if (configured === undefined || configured === '') return 'https://leaguesphere.app';
  return configured.replace(/\/$/, '');
}

/** `Deno.env` throws without `--allow-env`, and the pure modules are tested without it. */
function safeEnv(name: string): string | undefined {
  try {
    return Deno.env.get(name);
  } catch {
    return undefined;
  }
}

export type FetchResult<T> =
  /** 200 with a body that still has to be validated by `schema.ts`. */
  | { readonly kind: 'ok'; readonly body: unknown; readonly etag: string | null; readonly durationMs: number }
  /** 304: what we hold is current. */
  | { readonly kind: 'not-modified'; readonly durationMs: number }
  /** 429: upstream asked us to back off until `retryAfterMs` has passed. */
  | { readonly kind: 'throttled'; readonly retryAfterMs: number; readonly durationMs: number }
  /** We declined to make the call, to stay inside our own budget. */
  | { readonly kind: 'capped'; readonly reason: string }
  /** Anything else: a 4xx/5xx, a timeout, a transport failure or unparseable JSON. */
  | { readonly kind: 'error'; readonly message: string; readonly status: number | null; readonly durationMs: number };

/** The parts of a snapshot a caller can ask for through `include`. */
export type SnapshotInclude = 'games' | 'logs' | 'teams' | 'standings' | 'live';

/** The two budgets snapshot calls are spent against. */
export type SnapshotBucket = 'snapshot' | 'snapshot-standings';

export type Endpoint = SnapshotBucket | 'liveticker';

/** `include` is always sent in this order, so the same request always looks the same. */
const INCLUDE_ORDER: readonly SnapshotInclude[] = ['games', 'logs', 'teams', 'standings', 'live'];

export interface ClientOptions {
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => number;
  readonly timeoutMs?: number;
  readonly narrowCapPerHour?: number;
  readonly standingsCapPerHour?: number;
  readonly log?: (message: string) => void;
}

/**
 * Remembers when calls were made, so the caps and the back-offs hold across endpoints within
 * one invocation. A 429 blocks only the bucket that received it.
 *
 * Only within one: the function builds a fresh client per cron tick, so nothing here outlives
 * the tick. Across ticks the budget lives in Postgres as a count and the start of the window
 * it was spent in (`calls_last_hour`, `calls_window_started_at`), and `seed` brings it back.
 * A back-off comes back through `results_sync_state.last_error` and `blockUntil`.
 */
export class CallLedger {
  readonly #timestamps = new Map<Endpoint, number[]>();
  readonly #blockedUntil = new Map<Endpoint, number>();

  constructor(private readonly now: () => number) {}

  record(endpoint: Endpoint): void {
    const stamps = this.#timestamps.get(endpoint) ?? [];
    stamps.push(this.now());
    this.#timestamps.set(endpoint, stamps);
  }

  /**
   * Seeds the ledger from Postgres, so a new tick does not forget the calls made before it.
   *
   * The calls are stamped at the start of their window, so they drop out an hour after it
   * opened. Stamping them "now" instead meant they never aged: every tick re-seeded the same
   * count as fresh, the count only ever grew, and once it reached the cap the snapshot sync
   * stopped for good.
   */
  seed(endpoint: Endpoint, count: number, windowStartedAt: number): void {
    this.#timestamps.set(endpoint, Array.from({ length: count }, () => windowStartedAt));
  }

  callsInLastHour(endpoint: Endpoint): number {
    const cutoff = this.now() - 3_600_000;
    const stamps = (this.#timestamps.get(endpoint) ?? []).filter((t) => t > cutoff);
    this.#timestamps.set(endpoint, stamps);
    return stamps.length;
  }

  blockUntil(endpoint: Endpoint, timestamp: number): void {
    this.#blockedUntil.set(endpoint, Math.max(this.#blockedUntil.get(endpoint) ?? 0, timestamp));
  }

  /** Milliseconds left on a 429 back-off of `endpoint`, or 0 when free to call. */
  blockedForMs(endpoint: Endpoint): number {
    return Math.max(0, (this.#blockedUntil.get(endpoint) ?? 0) - this.now());
  }
}

/** The snapshot budget as Postgres holds it between ticks. */
export interface SnapshotBudget {
  readonly calls: number;
  readonly windowStartedAt: Date;
}

/**
 * What is left of the recorded budget at `now`: the stored count while its window is open,
 * or a fresh window once it has run an hour (or none was ever recorded).
 *
 * A fixed window, because one count and one timestamp cannot describe a rolling one. Its known
 * cost: 300 narrow calls at the end of one window and 300 at the start of the next are 600
 * within an hour, which is upstream's own narrow limit (and 20 + 20 standings calls stay
 * under its 60). The scheduler spends about 14 narrow calls an hour today, plus 60 once the
 * live path moves to the snapshot (LIVE-01).
 */
export function carriedSnapshotBudget(
  calls: number,
  windowStartedAt: string | null,
  now: Date,
): SnapshotBudget {
  const started = windowStartedAt === null ? null : new Date(windowStartedAt);
  if (started === null || now.getTime() - started.getTime() >= 3_600_000) {
    return { calls: 0, windowStartedAt: now };
  }
  return { calls, windowStartedAt: started };
}

export class LeagueSphereClient {
  readonly #fetch: typeof fetch;
  readonly #now: () => number;
  readonly #timeoutMs: number;
  readonly #narrowCap: number;
  readonly #standingsCap: number;
  readonly #log: (message: string) => void;
  readonly ledger: CallLedger;

  constructor(options: ClientOptions = {}) {
    this.#fetch = options.fetchImpl ?? fetch;
    this.#now = options.now ?? (() => Date.now());
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#narrowCap = options.narrowCapPerHour ?? NARROW_SNAPSHOT_CAP_PER_HOUR;
    this.#standingsCap = options.standingsCapPerHour ?? STANDINGS_SNAPSHOT_CAP_PER_HOUR;
    this.#log = options.log ?? ((message) => console.log(message));
    this.ledger = new CallLedger(this.#now);
  }

  /**
   * The snapshot, for one scope.
   *
   * `include` names the parts wanted (`live` implies games upstream). A request that includes
   * `standings` is charged against upstream's strict budget, so it spends the standings
   * bucket; every other request spends the narrow one.
   *
   * `status` is repeatable and **must be omitted entirely** to get everything except drafts,
   * which is the only way to receive gamedays whose status is `""` —
   * `Gameday.STATUS_CHOICES` upstream has no empty member, so no filter value selects them.
   * Drafts then need a second call with `status=DRAFT`.
   */
  snapshot(params: {
    readonly teamIds?: readonly number[];
    readonly year?: number;
    readonly dateFrom?: string;
    readonly dateTo?: string;
    readonly statuses?: readonly string[];
    readonly include: readonly SnapshotInclude[];
    readonly etag?: string | null;
  }): Promise<FetchResult<unknown>> {
    const query = new URLSearchParams();
    for (const teamId of params.teamIds ?? []) query.append('team', String(teamId));
    if (params.year !== undefined) query.set('year', String(params.year));
    if (params.dateFrom !== undefined) query.set('date_from', params.dateFrom);
    if (params.dateTo !== undefined) query.set('date_to', params.dateTo);
    for (const status of params.statuses ?? []) query.append('status', status);
    query.set('include', INCLUDE_ORDER.filter((part) => params.include.includes(part)).join(','));

    const bucket: SnapshotBucket = params.include.includes('standings')
      ? 'snapshot-standings'
      : 'snapshot';
    return this.#request(bucket, `/api/snapshot/?${query}`, params.etag ?? null);
  }

  /**
   * Live games.
   *
   * Without `getAllTicksFor` the response carries only the 5 newest ticks per game, which is
   * not enough to build a running score. Upstream also caches this for 60 s, so calling more
   * than once a minute returns identical bytes.
   */
  liveticker(params: {
    readonly allTicksForGameIds?: readonly number[];
    readonly gamedayIds?: readonly number[];
    readonly etag?: string | null;
  } = {}): Promise<FetchResult<unknown>> {
    const query = new URLSearchParams();
    if (params.allTicksForGameIds !== undefined && params.allTicksForGameIds.length > 0) {
      query.set('getAllTicksFor', params.allTicksForGameIds.join(','));
    }
    if (params.gamedayIds !== undefined && params.gamedayIds.length > 0) {
      query.set('gameday', params.gamedayIds.join(','));
    }
    const suffix = query.size > 0 ? `?${query}` : '';
    return this.#request('liveticker', `/api/liveticker/${suffix}`, params.etag ?? null);
  }

  async #request(
    endpoint: Endpoint,
    path: string,
    etag: string | null,
  ): Promise<FetchResult<unknown>> {
    const blockedMs = this.ledger.blockedForMs(endpoint);
    if (blockedMs > 0) {
      const reason = `backing off for another ${Math.ceil(blockedMs / 1000)}s after a 429`;
      this.#log(`[leaguesphere] ${endpoint} skipped: ${reason}`);
      return { kind: 'capped', reason };
    }

    const cap = endpoint === 'snapshot'
      ? this.#narrowCap
      : endpoint === 'snapshot-standings'
      ? this.#standingsCap
      : null;
    if (cap !== null) {
      const used = this.ledger.callsInLastHour(endpoint);
      if (used >= cap) {
        const reason = `${endpoint} budget spent: ${used}/${cap} in the last hour`;
        this.#log(`[leaguesphere] ${endpoint} skipped: ${reason}`);
        return { kind: 'capped', reason };
      }
    }

    const headers: Record<string, string> = {
      accept: 'application/json',
      // Identifies us to upstream so they can reach a human if we misbehave.
      'user-agent': 'nuernberg-renegades.de results sync (+https://www.nuernberg-renegades.de)',
    };
    // The header form is quoted; the `etag` field inside a snapshot body is not, and sending
    // that unquoted form would never match.
    if (etag !== null && etag !== '') headers['if-none-match'] = quoteEtag(etag);

    const started = this.#now();
    this.ledger.record(endpoint);

    let response: Response;
    try {
      response = await this.#fetch(`${BASE_URL}${path}`, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
    } catch (cause) {
      const durationMs = this.#now() - started;
      const message = cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause);
      // The path is logged, never a header: `path` carries no secret, headers may.
      this.#log(`[leaguesphere] GET ${path} failed after ${durationMs}ms — ${message}`);
      return { kind: 'error', message, status: null, durationMs };
    }

    const durationMs = this.#now() - started;
    this.#log(`[leaguesphere] GET ${path} → ${response.status} in ${durationMs}ms`);

    if (response.status === 304) {
      return { kind: 'not-modified', durationMs };
    }

    if (response.status === 429) {
      const retryAfterMs = parseRetryAfter(response.headers.get('retry-after'), this.#now());
      this.ledger.blockUntil(endpoint, this.#now() + retryAfterMs);
      return { kind: 'throttled', retryAfterMs, durationMs };
    }

    if (!response.ok) {
      // Upstream 400s carry a useful body (`{"season":"unknown Season ids: [2026]"}`).
      const detail = await response.text().catch(() => '');
      return {
        kind: 'error',
        message: `HTTP ${response.status}${detail === '' ? '' : ` — ${truncate(detail, 300)}`}`,
        status: response.status,
        durationMs,
      };
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch (cause) {
      const message = `response was not JSON: ${cause instanceof Error ? cause.message : String(cause)}`;
      return { kind: 'error', message, status: response.status, durationMs };
    }

    return { kind: 'ok', body, etag: response.headers.get('etag'), durationMs };
  }
}

/** Wraps a bare ETag in the quotes the header form needs, leaving `W/"…"` and `"…"` alone. */
export function quoteEtag(etag: string): string {
  const trimmed = etag.trim();
  if (trimmed.startsWith('"') || trimmed.startsWith('W/')) return trimmed;
  return `"${trimmed}"`;
}

/** Strips the quotes so an ETag can be compared with the value in a snapshot body. */
export function unquoteEtag(etag: string | null): string | null {
  if (etag === null) return null;
  return etag.trim().replace(/^W\//, '').replace(/^"|"$/g, '');
}

/**
 * `Retry-After` is either seconds or an HTTP date. An absent, unparseable or negative value
 * falls back to a minute, which matches the cron cadence — the next tick simply finds itself
 * still blocked rather than hammering upstream.
 */
export const DEFAULT_RETRY_AFTER_MS = 60_000;
/** Never sleep past the point where the data would be stale anyway. */
export const MAX_RETRY_AFTER_MS = 3_600_000;

export function parseRetryAfter(header: string | null, now: number): number {
  if (header === null) return DEFAULT_RETRY_AFTER_MS;

  const trimmed = header.trim();
  if (/^\d+$/.test(trimmed)) {
    return clampRetryAfter(Number(trimmed) * 1000);
  }

  const asDate = Date.parse(trimmed);
  if (!Number.isNaN(asDate)) {
    return clampRetryAfter(asDate - now);
  }

  return DEFAULT_RETRY_AFTER_MS;
}

/**
 * How a 429 is written to `results_sync_state.last_error`, so the next cron tick can read it
 * back with `persistedBackoffUntil`.
 *
 * The block is an absolute instant, not a duration from `last_attempt_at`: `recordAttempt`
 * restamps that column at the start of every tick, so anchoring on it would re-arm the block
 * each minute and it would never expire.
 */
export function throttledError(retryAfterMs: number, now: number): string {
  return `429 retry-after-ms=${retryAfterMs} until=${new Date(now + retryAfterMs).toISOString()}`;
}

const THROTTLED_ERROR = /^429 retry-after-ms=(\d+) until=(\S+)$/;

/**
 * The instant a stored 429 still blocks until, or null when `lastError` is not one (or it has
 * passed). Strict on purpose, and clamped to the existing one-hour ceiling, so a corrupted row
 * can never stop the sync for longer than a real `Retry-After` could.
 */
export function persistedBackoffUntil(lastError: string | null, now: number): number | null {
  if (lastError === null) return null;
  const match = THROTTLED_ERROR.exec(lastError);
  if (match === null) return null;

  const until = Date.parse(match[2]);
  if (Number.isNaN(until) || until <= now) return null;
  return Math.min(until, now + MAX_RETRY_AFTER_MS);
}

function clampRetryAfter(ms: number): number {
  if (!Number.isFinite(ms) || ms <= 0) return DEFAULT_RETRY_AFTER_MS;
  return Math.min(ms, MAX_RETRY_AFTER_MS);
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}…`;
}
