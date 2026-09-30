/**
 * The only thing that talks to LeagueSphere.
 *
 * Called once a minute by pg_cron (see the `results_cron` migration). Most ticks do nothing:
 * `whatIsDue` decides, and outside a gameday that is one `select` and a 200.
 *
 * Orchestration only. Every rule lives in `_shared/leaguesphere/`: what to fetch (`schedule`),
 * how to fetch it (`client`), whether to believe it (`schema`), what it means (`scoring`,
 * `standings`), what to store (`mappers`) and how to store it (`store`). This file wires those
 * together and decides what to do when one of them says no.
 *
 * The failure contract, which is the point of the whole design: a bad response never reaches
 * the tables. Validation happens before any write, a task that fails leaves `last_ok_at` and
 * the stored ETag alone, and the site keeps serving the last good data with a visible "Stand:"
 * timestamp. One task failing never stops the others.
 */

import { getCorsHeaders } from '../_shared/cors.ts';
import {
  carriedSnapshotBudget,
  LeagueSphereClient,
  unquoteEtag,
} from '../_shared/leaguesphere/client.ts';
import { LEAGUE_SEASONS, TEAM_IDS } from '../_shared/leaguesphere/config.ts';
import {
  mapTeamSnapshot,
  toGameEventRows,
  toLiveGameRows,
  toLiveTickRows,
  involvesTrackedTeam,
  todaysTrackedGameIds,
  type ScoreDisagreement,
} from '../_shared/leaguesphere/mappers.ts';
import {
  parseLeagueTable,
  parseLiveticker,
  parseSnapshot,
  type UpstreamGameday,
} from '../_shared/leaguesphere/schema.ts';
import { whatIsDue, type ScheduleInput, type Task } from '../_shared/leaguesphere/schedule.ts';
import {
  computeStandings,
  diffStandings,
  mapOfficialTable,
  summariseCheck,
} from '../_shared/leaguesphere/standings.ts';
import {
  ResultsStore,
  SNAPSHOT_BUDGET_SOURCE,
  SYNC_SOURCES,
} from '../_shared/leaguesphere/store.ts';
import { clubToday } from '../_shared/leaguesphere/time.ts';
import { sendStaleDataAlert } from '../_shared/leaguesphere/alert.ts';

/** How far back the team snapshot reaches. Older seasons are history nobody is waiting for. */
const HISTORY_FROM = '2026-01-01';

interface RunReport {
  readonly ranAt: string;
  readonly today: string;
  readonly due: readonly Task[];
  readonly reason: string;
  readonly outcomes: Record<string, string>;
  readonly disagreements: readonly string[];
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const denied = authorise(req);
  if (denied !== null) return denied;

  try {
    const report = await run();
    return json(report, 200, corsHeaders);
  } catch (cause) {
    // Only a failure of the orchestration itself reaches here; a failing task is reported
    // inside the run. Returning 500 makes it visible in the function logs and in pg_net's
    // response table rather than looking like a quiet success.
    const message = cause instanceof Error ? cause.message : String(cause);
    console.error(`[sync] aborted: ${message}`);
    return json({ error: message }, 500, corsHeaders);
  }
});

/**
 * Refuses anything that is not our own cron job.
 *
 * `verify_jwt = true` in `config.toml` means the gateway has already rejected calls with no
 * valid key, but the anon key is public and committed in the site's bundle, so that alone would
 * leave this open to the world — and an attacker who could trigger it at will could burn the
 * hourly upstream budget and leave the results page stale. The cron secret is the actual gate:
 * it is only in Vault and in this function's environment.
 */
function authorise(req: Request): Response | null {
  const expected = Deno.env.get('RESULTS_SYNC_CRON_SECRET');
  if (expected === undefined || expected === '') {
    console.error('[sync] RESULTS_SYNC_CRON_SECRET is not set; refusing to run');
    return json({ error: 'not configured' }, 503, {});
  }

  const provided = req.headers.get('x-cron-secret') ?? '';
  if (!timingSafeEqual(provided, expected)) {
    console.warn('[sync] rejected a call with a missing or wrong cron secret');
    // Deliberately vague: a caller learns only that it is not allowed.
    return json({ error: 'forbidden' }, 403, {});
  }

  return null;
}

/** Constant-time comparison, so a wrong secret cannot be found one character at a time. */
function timingSafeEqual(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  // Length alone leaks, so mismatched lengths still walk the longer buffer.
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

async function run(): Promise<RunReport> {
  const url = requireEnv('SUPABASE_URL');
  const serviceKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');

  const store = new ResultsStore({ url, serviceRoleKey: serviceKey });
  const client = new LeagueSphereClient();

  const now = new Date();
  const today = clubToday(now);

  const state = await store.loadSyncState();

  // Seed the call ledger from what earlier ticks spent, so this one does not start from zero.
  const budgetRow = state.get(SNAPSHOT_BUDGET_SOURCE);
  const budget = carriedSnapshotBudget(
    budgetRow?.calls_last_hour ?? 0,
    budgetRow?.calls_window_started_at ?? null,
    now,
  );
  if (budget.calls > 0) {
    client.ledger.seed('snapshot', budget.calls, budget.windowStartedAt.getTime());
  }

  const input = await buildScheduleInput(store, state, now, today);
  const due = whatIsDue(input);
  console.log(`[sync] ${today} due=[${due.tasks.join(', ')}] — ${due.reason}`);

  const outcomes: Record<string, string> = {};
  const disagreements: string[] = [];

  for (const task of due.tasks) {
    try {
      switch (task) {
        case 'liveticker':
          outcomes[task] = await syncLiveticker(store, client, state, now, today);
          break;
        case 'team-snapshot':
          outcomes[task] = await syncTeamSnapshot(store, client, state, now, today, disagreements);
          break;
        case 'league-table':
          outcomes[task] = await syncLeagueTables(store, client, state, now);
          break;
        case 'league-snapshot':
          outcomes[task] = await crossCheckStandings(store, client, state, now, disagreements);
          break;
      }
    } catch (cause) {
      // One task's failure must not cost the others their turn.
      const message = cause instanceof Error ? cause.message : String(cause);
      console.error(`[sync] ${task} failed: ${message}`);
      outcomes[task] = `error: ${message}`;
    }
  }

  // Once per tick, whatever the tasks did: a call that failed or 429'd still spent budget.
  const spent = client.ledger.callsInLastHour('snapshot');
  if (spent !== budget.calls) {
    await store.recordSnapshotBudget({ calls: spent, windowStartedAt: budget.windowStartedAt }, now);
  }

  await maybeAlert(store, state, now, input);

  return { ranAt: now.toISOString(), today, due: due.tasks, reason: due.reason, outcomes, disagreements };
}

/**
 * Builds the scheduler's view from what we already hold.
 *
 * Note what this does *not* do: it never asks upstream what is happening today. Whether a game
 * is in progress is read from our own tables, which the previous ticks filled — otherwise
 * deciding whether to fetch would itself require a fetch.
 */
async function buildScheduleInput(
  store: ResultsStore,
  state: ReadonlyMap<string, { last_ok_at: string | null }>,
  now: Date,
  today: string,
): Promise<ScheduleInput> {
  const games = await store.todaysGames(today);

  const lastOkAt: Partial<Record<Task, Date | null>> = {
    'team-snapshot': toDate(state.get(SYNC_SOURCES.teamSnapshot)?.last_ok_at),
    liveticker: toDate(state.get(SYNC_SOURCES.liveticker)?.last_ok_at),
    'league-table': earliestLeagueOk(state, SYNC_SOURCES.leagueTable),
    'league-snapshot': earliestLeagueOk(state, SYNC_SOURCES.leagueSnapshot),
  };

  return {
    now,
    today,
    lastOkAt,
    todaysKickoffs: games.map((game) => game.scheduled).filter((t): t is string => t !== null),
    // A game that has a status other than "scheduled" and is not finished is under way.
    gameInProgress: games.some((game) => !game.finished && game.status !== 'Geplant'),
    gamedayFinished: games.length > 0 && games.every((game) => game.finished),
  };
}

/**
 * The oldest success across every league season.
 *
 * Taking the oldest means one league season lagging pulls all of them forward. They are read
 * together anyway, and a table that is an hour older than its neighbour is the kind of
 * inconsistency nobody would think to look for.
 */
function earliestLeagueOk(
  state: ReadonlyMap<string, { last_ok_at: string | null }>,
  source: (key: string, season: string) => string,
): Date | null {
  let earliest: Date | null = null;
  for (const config of LEAGUE_SEASONS) {
    const at = toDate(state.get(source(config.key, config.season))?.last_ok_at);
    if (at === null) return null; // never run for this season: due now
    if (earliest === null || at < earliest) earliest = at;
  }
  return earliest;
}

// ── Tasks ────────────────────────────────────────────────────────────────────

/**
 * Both snapshot calls for our teams.
 *
 * Two calls, not one, and this is the only way to see everything: omitting `status` returns
 * every gameday *except* drafts — including those whose status is `""`, which no filter value
 * can select because `Gameday.STATUS_CHOICES` upstream has no empty member. Drafts then need
 * their own `status=DRAFT` call.
 */
async function syncTeamSnapshot(
  store: ResultsStore,
  client: LeagueSphereClient,
  state: ReadonlyMap<string, { etag: string | null }>,
  now: Date,
  today: string,
  disagreements: string[],
): Promise<string> {
  const scopes = [
    { source: SYNC_SOURCES.teamSnapshot, statuses: undefined },
    { source: SYNC_SOURCES.draftSnapshot, statuses: ['DRAFT'] },
  ] as const;

  const gamedays: UpstreamGameday[] = [];
  const notes: string[] = [];
  let anyFresh = false;
  // Scopes that fetched and parsed cleanly, held back until the write succeeds. Marking one
  // successful before the rows land would let a persistent write failure look like a healthy
  // sync and back the whole thing off for an hour.
  const pendingSuccess: { source: string; etag: string | null }[] = [];

  for (const scope of scopes) {
    await store.recordAttempt(scope.source, now);

    const result = await client.snapshot({
      teamIds: [...TEAM_IDS],
      dateFrom: HISTORY_FROM,
      statuses: scope.statuses,
      includeLogs: true,
      etag: state.get(scope.source)?.etag ?? null,
    });

    if (result.kind === 'not-modified') {
      notes.push(`${scope.source}: 304`);
      // Still a success, and nothing to write: what we hold is already current.
      await store.recordSuccess(scope.source, now, state.get(scope.source)?.etag ?? null);
      continue;
    }

    if (result.kind === 'capped') {
      notes.push(`${scope.source}: ${result.reason}`);
      continue;
    }

    if (result.kind === 'throttled') {
      await store.recordFailure(scope.source, now, `429, retrying after ${result.retryAfterMs}ms`);
      notes.push(`${scope.source}: throttled`);
      continue;
    }

    if (result.kind === 'error') {
      await store.recordFailure(scope.source, now, result.message);
      notes.push(`${scope.source}: ${result.message}`);
      continue;
    }

    const parsed = parseSnapshot(result.body);
    if (!parsed.ok) {
      // The whole point of hard constraint 4: a shape we do not recognise is recorded and
      // dropped. Nothing is written, so the last good data survives.
      const message = `schema mismatch: ${parsed.errors.slice(0, 5).join('; ')}`;
      await store.recordFailure(scope.source, now, message);
      notes.push(`${scope.source}: ${message}`);
      continue;
    }

    gamedays.push(...parsed.value.gamedays);
    anyFresh = true;
    pendingSuccess.push({ source: scope.source, etag: unquoteEtag(result.etag) });
    notes.push(`${scope.source}: ${parsed.value.gamedays.length} gameday(s)`);
  }

  if (!anyFresh) return notes.join(', ');

  const mapped = mapTeamSnapshot(gamedays, today);

  try {
    // Parents before children: a game row's foreign key needs its gameday to exist.
    await store.saveGamedays(mapped.gamedays);
    await store.saveGames(mapped.games);

    // Play-by-play is replaced per game rather than upserted, because upstream can delete an
    // entry and an upsert would leave the stale row behind.
    for (const gameday of gamedays) {
      for (const game of gameday.games.filter(involvesTrackedTeam)) {
        if (game.log === null) continue;
        await store.replaceGameEvents(game.id, toGameEventRows(game));
      }
    }

    // Keep the live tables to today's games only.
    await store.pruneLiveGames([...todaysTrackedGameIds(gamedays, today)]);
  } catch (cause) {
    // The fetch was fine and the data was valid; we could not store it. Leaving `last_ok_at`
    // and the ETag alone means the next tick retries with the same conditional request rather
    // than believing it is already up to date.
    const message = cause instanceof Error ? cause.message : String(cause);
    for (const pending of pendingSuccess) {
      await store.recordFailure(pending.source, now, `write failed: ${message}`);
    }
    throw cause;
  }

  for (const pending of pendingSuccess) {
    await store.recordSuccess(pending.source, now, pending.etag);
  }

  for (const disagreement of mapped.disagreements) {
    disagreements.push(describeDisagreement(disagreement));
  }

  return `${notes.join(', ')} → ${mapped.gamedays.length} gameday(s), ${mapped.games.length} game(s), ${mapped.events.length} event(s)`;
}

/**
 * Live ticks for today's games.
 *
 * `getAllTicksFor` is passed for exactly our games: without it the response holds only the five
 * newest ticks per game, which is not enough to build a running score. The result is also
 * filtered against those ids, because the unfiltered liveticker returns whatever is live
 * anywhere on the platform.
 */
async function syncLiveticker(
  store: ResultsStore,
  client: LeagueSphereClient,
  state: ReadonlyMap<string, { etag: string | null }>,
  now: Date,
  today: string,
): Promise<string> {
  const source = SYNC_SOURCES.liveticker;
  const games = await store.todaysGames(today);
  const gameIds = games.map((game) => game.id);
  if (gameIds.length === 0) return 'no games today';

  await store.recordAttempt(source, now);

  const result = await client.liveticker({
    allTicksForGameIds: gameIds,
    etag: state.get(source)?.etag ?? null,
  });

  if (result.kind === 'not-modified') {
    await store.recordSuccess(source, now, state.get(source)?.etag ?? null);
    return '304';
  }
  if (result.kind === 'capped') return result.reason;
  if (result.kind === 'throttled') {
    await store.recordFailure(source, now, `429, retrying after ${result.retryAfterMs}ms`);
    return 'throttled';
  }
  if (result.kind === 'error') {
    await store.recordFailure(source, now, result.message);
    return result.message;
  }

  const parsed = parseLiveticker(result.body);
  if (!parsed.ok) {
    const message = `schema mismatch: ${parsed.errors.slice(0, 5).join('; ')}`;
    await store.recordFailure(source, now, message);
    return message;
  }

  const known = new Set(gameIds);
  const rows = toLiveGameRows(parsed.value, known);
  const ticks = toLiveTickRows(parsed.value, known);

  try {
    await store.saveLiveGames(rows);
    // Ticks after the score: a browser watching Realtime sees the score move, then the play that
    // caused it, which is the order it happens in.
    await store.saveLiveTicks(ticks);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    await store.recordFailure(source, now, `write failed: ${message}`);
    throw cause;
  }

  await store.recordSuccess(source, now, unquoteEtag(result.etag));

  return `${rows.length} live game(s) of ${parsed.value.length} returned, ${ticks.length} tick(s)`;
}

/** The published tables — the standings we actually display. */
async function syncLeagueTables(
  store: ResultsStore,
  client: LeagueSphereClient,
  state: ReadonlyMap<string, { etag: string | null }>,
  now: Date,
): Promise<string> {
  const notes: string[] = [];

  for (const config of LEAGUE_SEASONS) {
    const source = SYNC_SOURCES.leagueTable(config.key, config.season);
    await store.recordAttempt(source, now);

    // The slug is not our config key: DKB DFFL is `dffl`, and `dkb-dffl` is a 404.
    const result = await client.leagueTable(
      config.tableSlug,
      config.season,
      state.get(source)?.etag ?? null,
    );

    if (result.kind === 'not-modified') {
      await store.recordSuccess(source, now, state.get(source)?.etag ?? null);
      notes.push(`${config.key}: 304`);
      continue;
    }
    if (result.kind === 'capped' || result.kind === 'throttled') {
      notes.push(`${config.key}: deferred`);
      continue;
    }
    if (result.kind === 'error') {
      await store.recordFailure(source, now, result.message);
      notes.push(`${config.key}: ${result.message}`);
      continue;
    }

    const parsed = parseLeagueTable(result.body);
    if (!parsed.ok) {
      const message = `schema mismatch: ${parsed.errors.slice(0, 5).join('; ')}`;
      await store.recordFailure(source, now, message);
      notes.push(`${config.key}: ${message}`);
      continue;
    }

    const rows = mapOfficialTable(config, parsed.value);
    // An empty table would blank the standings tab. Far more likely a mistake upstream than a
    // league genuinely having no played games, so it is refused rather than written.
    if (rows.length === 0) {
      await store.recordFailure(source, now, 'published table held no played teams; keeping the last good one');
      notes.push(`${config.key}: empty, kept`);
      continue;
    }

    await store.replaceStandings(config.key, config.season, rows);
    await store.recordSuccess(source, now, unquoteEtag(result.etag));
    notes.push(`${config.key}: ${rows.length} row(s)`);
  }

  return notes.join(', ');
}

/**
 * Recomputes each league table ourselves and reports where it differs from the published one.
 *
 * Nothing here is displayed. It exists so that a missing gameday, a stale exclusion list or a
 * rule change upstream shows up as a logged difference instead of as a table that is quietly
 * wrong. For FF BL the two agree exactly; for DKB DFFL the quotient cannot agree, because that
 * league divides win points by a fixed 30 and weights wins by the opponent's league using
 * configuration no public endpoint exposes — so those differences are reported separately from
 * differences in games, wins or points, which are always worth investigating.
 */
async function crossCheckStandings(
  store: ResultsStore,
  client: LeagueSphereClient,
  state: ReadonlyMap<string, { etag: string | null }>,
  now: Date,
  disagreements: string[],
): Promise<string> {
  const notes: string[] = [];

  for (const config of LEAGUE_SEASONS) {
    const source = SYNC_SOURCES.leagueSnapshot(config.key, config.season);
    await store.recordAttempt(source, now);

    // League-scoped, and without logs: standings need results, not play-by-play. Scoped by team
    // it would only return gamedays our teams attended, leaving every other club short of games.
    const result = await client.snapshot({
      leaguePk: config.leaguePk,
      seasonPk: config.seasonPk,
      includeLogs: false,
      etag: state.get(source)?.etag ?? null,
    });

    if (result.kind === 'not-modified') {
      await store.recordSuccess(source, now, state.get(source)?.etag ?? null);
      notes.push(`${config.key}: 304`);
      continue;
    }
    if (result.kind === 'capped' || result.kind === 'throttled') {
      notes.push(`${config.key}: deferred`);
      continue;
    }
    if (result.kind === 'error') {
      await store.recordFailure(source, now, result.message);
      notes.push(`${config.key}: ${result.message}`);
      continue;
    }

    const parsed = parseSnapshot(result.body);
    if (!parsed.ok) {
      await store.recordFailure(source, now, `schema mismatch: ${parsed.errors.slice(0, 5).join('; ')}`);
      notes.push(`${config.key}: schema mismatch`);
      continue;
    }

    const ours = computeStandings(config, parsed.value.gamedays);
    const official = await store.select<{ team_id: number; sp: number; s: number; u: number; n: number; ep: number; gp: number; pd: number; sq: number }>(
      'results_standings',
      `select=team_id,sp,s,u,n,ep,gp,pd,sq&league_key=eq.${encodeURIComponent(config.key)}&season=eq.${encodeURIComponent(config.season)}`,
    );

    const check = diffStandings(
      config,
      ours,
      official.map((row) => ({
        leagueKey: config.key,
        season: config.season,
        teamId: row.team_id,
        rank: 0,
        group: '',
        sp: row.sp,
        s: row.s,
        u: row.u,
        n: row.n,
        ep: Number(row.ep),
        gp: Number(row.gp),
        pd: Number(row.pd),
        sq: Number(row.sq),
        promotionRestricted: false,
        mode: 'official' as const,
      })),
    );

    const summary = summariseCheck(check);
    console.log(`[sync] standings check ${summary}`);
    if (check.recordDifferences.length > 0 || check.onlyOurs.length > 0) {
      // A countable difference means our data is incomplete, not that the rules changed.
      disagreements.push(`standings ${summary}`);
      await store.recordFailure(source, now, `standings cross-check: ${summary}`);
      notes.push(`${config.key}: ${summary}`);
      continue;
    }

    await store.recordSuccess(source, now, unquoteEtag(result.etag));
    notes.push(`${config.key}: agrees (${summary})`);
  }

  return notes.join(', ');
}

// ── Alerting ─────────────────────────────────────────────────────────────────

/** During a gameday two hours of silence is a problem; otherwise a day and a bit is. */
const STALE_GAMEDAY_MS = 2 * 3_600_000;
const STALE_NORMAL_MS = 26 * 3_600_000;

/**
 * Mails when the data has gone stale, at most once per incident.
 *
 * `alerted_at` is the latch, and `recordSuccess` clears it, so a recovery re-arms the alert
 * without anyone touching the row.
 */
async function maybeAlert(
  store: ResultsStore,
  state: ReadonlyMap<string, { last_ok_at: string | null; alerted_at: string | null; last_error: string | null }>,
  now: Date,
  input: ScheduleInput,
): Promise<void> {
  const source = SYNC_SOURCES.teamSnapshot;
  const row = state.get(source);
  const lastOk = toDate(row?.last_ok_at);

  // Never run at all: there is nothing to be stale yet, and the first run's log says enough.
  if (lastOk === null) return;

  const limit = input.todaysKickoffs.length > 0 ? STALE_GAMEDAY_MS : STALE_NORMAL_MS;
  const age = now.getTime() - lastOk.getTime();
  if (age < limit) return;
  if (row?.alerted_at !== null && row?.alerted_at !== undefined) return;

  const sent = await sendStaleDataAlert({
    lastOkAt: lastOk,
    ageMs: age,
    duringGameday: input.todaysKickoffs.length > 0,
    lastError: row?.last_error ?? null,
  });
  if (sent) await store.markAlerted(source, now);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function describeDisagreement(disagreement: ScoreDisagreement): string {
  return `game ${disagreement.gameId} ${disagreement.side} half ${disagreement.half}: ` +
    `upstream ${disagreement.reported}, we computed ${disagreement.computed}`;
}

function toDate(value: string | null | undefined): Date | null {
  if (value === null || value === undefined) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (value === undefined || value === '') throw new Error(`${name} is not set`);
  return value;
}

function json(body: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'content-type': 'application/json' },
  });
}
