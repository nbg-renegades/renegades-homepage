/**
 * The only place that talks to LeagueSphere.
 *
 * Everything here exists because we are a guest on someone else's API:
 *
 *  - **Conditional requests.** Every call sends `If-None-Match`. A 304 costs upstream almost
 *    nothing and costs us no parsing, and on a quiet day nearly every call is a 304.
 *  - **Throttles are hard limits, not hints.** `/api/snapshot/` allows 60 requests/hour per IP
 *    and all anonymous traffic 120/min. A 429 is obeyed for as long as `Retry-After` says.
 *  - **A local cap below the upstream one.** Being throttled means serving stale results, so
 *    the client refuses to exceed its own budget (30 snapshot calls/hour) before upstream has
 *    to refuse us. Supabase Edge Functions share an egress IP with every other project in the
 *    region, so the budget we actually get may be smaller than the documented one.
 *  - **A timeout.** A hung fetch would otherwise hold the invocation open until the platform
 *    kills it, and the next cron tick would pile onto it.
 *
 * `fetchImpl` and `now` are injected so the tests can drive every branch without a network.
 */

/** Upstream's own limits, for reference. We stay under them deliberately. */
export const UPSTREAM_SNAPSHOT_LIMIT_PER_HOUR = 60;
export const UPSTREAM_ANON_LIMIT_PER_MINUTE = 120;

/** Our self-imposed budget. Half of upstream's, because the IP is shared. */
export const SNAPSHOT_CALL_CAP_PER_HOUR = 30;

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

export type Endpoint = 'snapshot' | 'liveticker' | 'league-table';

export interface ClientOptions {
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => number;
  readonly timeoutMs?: number;
  readonly snapshotCapPerHour?: number;
  readonly log?: (message: string) => void;
}

/**
 * Remembers when calls were made, so the cap and the back-off survive across endpoints
 * within one invocation.
 *
 * Deliberately in memory: an Edge Function instance handles many cron ticks, so this holds
 * for the common case, and `sync_state.calls_last_hour` in Postgres is the durable record
 * that survives a cold start. Neither alone is enough; together they keep us inside budget.
 */
export class CallLedger {
  readonly #timestamps = new Map<Endpoint, number[]>();
  #blockedUntil = 0;

  constructor(private readonly now: () => number) {}

  record(endpoint: Endpoint): void {
    const stamps = this.#timestamps.get(endpoint) ?? [];
    stamps.push(this.now());
    this.#timestamps.set(endpoint, stamps);
  }

  /** Seeds the ledger from Postgres, so a cold start does not forget the last hour. */
  seed(endpoint: Endpoint, count: number): void {
    const now = this.now();
    // Placed at the start of the window: pessimistic, and it never over-reports the budget.
    this.#timestamps.set(endpoint, Array.from({ length: count }, () => now));
  }

  callsInLastHour(endpoint: Endpoint): number {
    const cutoff = this.now() - 3_600_000;
    const stamps = (this.#timestamps.get(endpoint) ?? []).filter((t) => t > cutoff);
    this.#timestamps.set(endpoint, stamps);
    return stamps.length;
  }

  blockUntil(timestamp: number): void {
    this.#blockedUntil = Math.max(this.#blockedUntil, timestamp);
  }

  /** Milliseconds left on a 429 back-off, or 0 when free to call. */
  blockedForMs(): number {
    return Math.max(0, this.#blockedUntil - this.now());
  }
}

export class LeagueSphereClient {
  readonly #fetch: typeof fetch;
  readonly #now: () => number;
  readonly #timeoutMs: number;
  readonly #snapshotCap: number;
  readonly #log: (message: string) => void;
  readonly ledger: CallLedger;

  constructor(options: ClientOptions = {}) {
    this.#fetch = options.fetchImpl ?? fetch;
    this.#now = options.now ?? (() => Date.now());
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#snapshotCap = options.snapshotCapPerHour ?? SNAPSHOT_CALL_CAP_PER_HOUR;
    this.#log = options.log ?? ((message) => console.log(message));
    this.ledger = new CallLedger(this.#now);
  }

  /**
   * The snapshot, for one scope.
   *
   * `status` is repeatable and **must be omitted entirely** to get everything except drafts,
   * which is the only way to receive gamedays whose status is `""` —
   * `Gameday.STATUS_CHOICES` upstream has no empty member, so no filter value selects them.
   * Drafts then need a second call with `status=DRAFT`.
   *
   * `league` and `season` are **primary keys**. Passing a year as `season` is a 400.
   */
  snapshot(params: {
    readonly teamIds?: readonly number[];
    readonly leaguePk?: number;
    readonly seasonPk?: number;
    readonly dateFrom?: string;
    readonly dateTo?: string;
    readonly statuses?: readonly string[];
    readonly includeLogs?: boolean;
    readonly etag?: string | null;
  }): Promise<FetchResult<unknown>> {
    const query = new URLSearchParams();
    for (const teamId of params.teamIds ?? []) query.append('team', String(teamId));
    if (params.leaguePk !== undefined) query.set('league', String(params.leaguePk));
    if (params.seasonPk !== undefined) query.set('season', String(params.seasonPk));
    if (params.dateFrom !== undefined) query.set('date_from', params.dateFrom);
    if (params.dateTo !== undefined) query.set('date_to', params.dateTo);
    for (const status of params.statuses ?? []) query.append('status', status);
    query.set('include', params.includeLogs === true ? 'games,logs' : 'games');

    return this.#request('snapshot', `/api/snapshot/?${query}`, params.etag ?? null);
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

  /** The published table. `slug` is a league slug, not our config key: DKB DFFL is `dffl`. */
  leagueTable(
    slug: string,
    season: string,
    etag: string | null = null,
  ): Promise<FetchResult<unknown>> {
    return this.#request(
      'league-table',
      `/api/league-table/${encodeURIComponent(slug)}/${encodeURIComponent(season)}/`,
      etag,
    );
  }

  async #request(
    endpoint: Endpoint,
    path: string,
    etag: string | null,
  ): Promise<FetchResult<unknown>> {
    const blockedMs = this.ledger.blockedForMs();
    if (blockedMs > 0) {
      const reason = `backing off for another ${Math.ceil(blockedMs / 1000)}s after a 429`;
      this.#log(`[leaguesphere] ${endpoint} skipped: ${reason}`);
      return { kind: 'capped', reason };
    }

    if (endpoint === 'snapshot') {
      const used = this.ledger.callsInLastHour('snapshot');
      if (used >= this.#snapshotCap) {
        const reason = `snapshot budget spent: ${used}/${this.#snapshotCap} in the last hour`;
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
      this.ledger.blockUntil(this.#now() + retryAfterMs);
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

function clampRetryAfter(ms: number): number {
  if (!Number.isFinite(ms) || ms <= 0) return DEFAULT_RETRY_AFTER_MS;
  return Math.min(ms, MAX_RETRY_AFTER_MS);
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}…`;
}
