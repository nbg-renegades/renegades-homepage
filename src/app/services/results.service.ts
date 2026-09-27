/**
 * Reads the results tables. The only data source the results section has.
 *
 * Two deliberate choices:
 *
 * **PostgREST over `HttpClient`, not `supabase.service.ts`.** That service throws on the server
 * by design — `@supabase/supabase-js` pulls in `ws`, which needs `node:net`/`tls`/`fs`, and the
 * Netlify Deno edge runtime provides none of them. A route whose `loadComponent()` rejects is
 * silently dropped by Angular's server router, so importing it here would 404 the whole results
 * section in production while working locally. `HttpClient` runs identically on both sides, and
 * supabase-js stays where it earns its keep: the browser, for Realtime, in the live tab.
 *
 * **No caching layer of our own.** `provideClientHydration(withHttpTransferCacheOptions(…))` is
 * already configured in `app.config.ts`, so a GET made while server-rendering is serialised into
 * the page and replayed from there on hydration. The HTML therefore contains the results, and
 * the browser does not re-fetch them. Adding a cache here would only get in the way of that.
 *
 * Nothing in these rows is trusted as markup. Team names, gameday names and play-by-play text
 * all come from LeagueSphere and are only ever rendered as text.
 */

import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { map, shareReplay, type Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { LOGO_BASE_PATH } from '../components/results/results.config';

// ── View models ──────────────────────────────────────────────────────────────
// Deliberately camelCase and free of upstream vocabulary: no `pa`, no German status strings.

export interface ResultsTeam {
  readonly id: number;
  readonly name: string;
  readonly shortName: string | null;
  /** Ready to put in `src`, or null when we have no logo for this club. */
  readonly logoUrl: string | null;
}

export type GameOutcome = 'win' | 'loss' | 'draw' | null;

export interface ResultsGame {
  readonly id: number;
  readonly scheduled: string | null;
  readonly field: number | null;
  readonly stage: string | null;
  readonly group: string | null;
  readonly finished: boolean;
  readonly homeTeamId: number | null;
  readonly awayTeamId: number | null;
  readonly homeName: string | null;
  readonly awayName: string | null;
  readonly homeScore: number | null;
  readonly awayScore: number | null;
  readonly homeHalftime: number | null;
  readonly awayHalftime: number | null;
}

export type GamedayPhase = 'past' | 'today' | 'upcoming';

export interface ResultsGameday {
  readonly id: number;
  readonly date: string;
  readonly startTime: string | null;
  readonly name: string;
  readonly leagueDisplay: string;
  /** Already normalised by the sync: a placeholder such as "Adresse folgt" arrives as null. */
  readonly address: string | null;
  readonly phase: GamedayPhase;
  readonly games: readonly ResultsGame[];
}

export interface StandingsEntry {
  readonly teamId: number;
  readonly rank: number;
  readonly group: string;
  readonly played: number;
  readonly won: number;
  readonly drawn: number;
  readonly lost: number;
  readonly pointsFor: number;
  readonly pointsAgainst: number;
  readonly pointsDiff: number;
  readonly quotient: number;
  /** A second team, which cannot be promoted. Shown greyed out. */
  readonly promotionRestricted: boolean;
}

export interface GameEvent {
  readonly half: 1 | 2;
  readonly seq: number;
  readonly side: 'home' | 'away';
  readonly text: string;
  readonly points: number;
  readonly scoreHome: number;
  readonly scoreAway: number;
  readonly isDeleted: boolean;
  readonly isMarker: boolean;
}

/** When the data was last confirmed current, so the page can say "Stand: …". */
export interface SyncFreshness {
  readonly lastOkAt: string | null;
}

// ── Row shapes, as PostgREST returns them ────────────────────────────────────

interface GameRow {
  id: number;
  scheduled: string | null;
  field: number | null;
  stage: string | null;
  group_name: string | null;
  finished: boolean;
  home_team_id: number | null;
  away_team_id: number | null;
  home_name: string | null;
  away_name: string | null;
  home_score: number | null;
  away_score: number | null;
  home_ht: number | null;
  away_ht: number | null;
}

interface GamedayRow {
  id: number;
  date: string;
  start_time: string | null;
  name: string;
  league_display: string;
  address: string | null;
  phase: GamedayPhase;
  games: GameRow[] | null;
}

interface StandingsRowDto {
  team_id: number;
  rank: number;
  group_name: string;
  sp: number;
  s: number;
  u: number;
  n: number;
  ep: string | number;
  gp: string | number;
  pd: string | number;
  sq: string | number;
  promotion_restricted: boolean;
}

interface GameEventRowDto {
  half: number;
  seq: number;
  side: string;
  text: string;
  points: number;
  score_home: number;
  score_away: number;
  is_deleted: boolean;
  is_marker: boolean;
}

interface TeamsFile {
  teams: { id: number; name: string; short_name?: string; logo?: string }[];
}

const GAME_COLUMNS =
  'id,scheduled,field,stage,group_name,finished,home_team_id,away_team_id,' +
  'home_name,away_name,home_score,away_score,home_ht,away_ht';

@Injectable({ providedIn: 'root' })
export class ResultsService {
  #http = inject(HttpClient);

  readonly #restUrl = `${environment.supabase.url}/rest/v1`;

  /**
   * The anon key, as `apikey` only — deliberately **not** also as an `Authorization` bearer.
   *
   * Angular's HTTP transfer cache skips any request carrying an `Authorization` header
   * (`includeRequestsWithAuthHeaders` defaults to false, so a per-user response cannot leak into
   * the HTML). Sending the key both ways, as supabase-js does, therefore cost us the transfer
   * cache: the server-rendered page held the results and the browser then fetched every one of
   * them again on hydration. `apikey` alone is enough for Supabase to resolve the anon role, and
   * it keeps these GETs cacheable.
   *
   * The key is public by design and already in the bundle; RLS is what limits it to SELECT.
   */
  readonly #headers = { apikey: environment.supabase.key };

  /**
   * Team display names and logos.
   *
   * A committed JSON asset rather than a table, matching how the roster and the sponsors are
   * maintained here. It changes once or twice a season, it belongs in review alongside the logo
   * files it references, and keeping it in the repo means adding a club needs no database access.
   * `shareReplay` because every gameday and every table row looks teams up.
   */
  readonly teams$: Observable<ReadonlyMap<number, ResultsTeam>> = this.#http
    .get<TeamsFile>('/assets/data/results-teams.json')
    .pipe(
      map((file) => new Map(
        (file.teams ?? []).map((team) => [team.id, {
          id: team.id,
          name: team.name,
          shortName: team.short_name ?? null,
          logoUrl: team.logo === undefined ? null : `${LOGO_BASE_PATH}/${team.logo}`,
        } satisfies ResultsTeam]),
      )),
      shareReplay({ bufferSize: 1, refCount: false }),
    );

  /**
   * Every gameday one team plays in, newest first, with that team's games embedded.
   *
   * One request rather than two: the embedded `!inner` join also drops gamedays where the team
   * has no game, which happens for a gameday our *other* team attended.
   */
  gamedays(teamId: number): Observable<readonly ResultsGameday[]> {
    const params = new URLSearchParams({
      select: `id,date,start_time,name,league_display,address,phase,games:results_games!inner(${GAME_COLUMNS})`,
      'games.or': `(home_team_id.eq.${teamId},away_team_id.eq.${teamId})`,
      order: 'date.desc',
    });

    return this.#http
      .get<GamedayRow[]>(`${this.#restUrl}/results_gamedays?${params}`, { headers: this.#headers })
      .pipe(map((rows) => rows.map(toGameday)));
  }

  standings(leagueKey: string, season: string): Observable<readonly StandingsEntry[]> {
    const params = new URLSearchParams({
      select: 'team_id,rank,group_name,sp,s,u,n,ep,gp,pd,sq,promotion_restricted',
      league_key: `eq.${leagueKey}`,
      season: `eq.${season}`,
      order: 'rank.asc',
    });

    return this.#http
      .get<StandingsRowDto[]>(`${this.#restUrl}/results_standings?${params}`, { headers: this.#headers })
      .pipe(map((rows) => rows.map(toStandingsEntry)));
  }

  /** Play-by-play for one game, oldest first. Fetched when a game card is expanded. */
  events(gameId: number): Observable<readonly GameEvent[]> {
    const params = new URLSearchParams({
      select: 'half,seq,side,text,points,score_home,score_away,is_deleted,is_marker',
      game_id: `eq.${gameId}`,
      order: 'half.asc,seq.asc',
    });

    return this.#http
      .get<GameEventRowDto[]>(`${this.#restUrl}/results_game_events?${params}`, { headers: this.#headers })
      .pipe(map((rows) => rows.map(toGameEvent)));
  }

  /**
   * When the schedule data was last confirmed current.
   *
   * `results_sync_state` is not readable by `anon` — it holds upstream error strings — so this
   * reads the newest `updated_at` among the gamedays instead, which is set on every successful
   * write and is the same thing from a visitor's point of view.
   */
  lastUpdatedAt(): Observable<string | null> {
    const params = new URLSearchParams({
      select: 'updated_at',
      order: 'updated_at.desc',
      limit: '1',
    });

    return this.#http
      .get<{ updated_at: string }[]>(`${this.#restUrl}/results_gamedays?${params}`, { headers: this.#headers })
      .pipe(map((rows) => rows[0]?.updated_at ?? null));
  }
}

// ── Mapping ──────────────────────────────────────────────────────────────────

function toGameday(row: GamedayRow): ResultsGameday {
  return {
    id: row.id,
    date: row.date,
    startTime: trimSeconds(row.start_time),
    name: row.name,
    leagueDisplay: row.league_display,
    address: row.address,
    phase: row.phase,
    // Kickoff order within the day; PostgREST does not order an embedded resource for us.
    games: (row.games ?? []).map(toGame).sort(byKickoff),
  };
}

function toGame(row: GameRow): ResultsGame {
  return {
    id: row.id,
    scheduled: trimSeconds(row.scheduled),
    field: row.field,
    stage: row.stage,
    group: row.group_name,
    finished: row.finished,
    homeTeamId: row.home_team_id,
    awayTeamId: row.away_team_id,
    homeName: row.home_name,
    awayName: row.away_name,
    homeScore: row.home_score,
    awayScore: row.away_score,
    homeHalftime: row.home_ht,
    awayHalftime: row.away_ht,
  };
}

function byKickoff(a: ResultsGame, b: ResultsGame): number {
  return (a.scheduled ?? '').localeCompare(b.scheduled ?? '') || a.id - b.id;
}

function toStandingsEntry(row: StandingsRowDto): StandingsEntry {
  return {
    teamId: row.team_id,
    rank: row.rank,
    group: row.group_name,
    played: row.sp,
    won: row.s,
    drawn: row.u,
    lost: row.n,
    // Postgres `numeric` arrives as a string through PostgREST, so these are parsed rather
    // than trusted to be numbers.
    pointsFor: Number(row.ep),
    pointsAgainst: Number(row.gp),
    pointsDiff: Number(row.pd),
    quotient: Number(row.sq),
    promotionRestricted: row.promotion_restricted,
  };
}

function toGameEvent(row: GameEventRowDto): GameEvent {
  return {
    half: row.half === 2 ? 2 : 1,
    seq: row.seq,
    side: row.side === 'away' ? 'away' : 'home',
    text: row.text,
    points: row.points,
    scoreHome: row.score_home,
    scoreAway: row.score_away,
    isDeleted: row.is_deleted,
    isMarker: row.is_marker,
  };
}

/** Postgres `time` comes back as `HH:MM:SS`; nobody needs the seconds. */
function trimSeconds(time: string | null): string | null {
  if (time === null) return null;
  const match = /^(\d{2}:\d{2})/.exec(time);
  return match === null ? time : match[1];
}

/**
 * Which way a game went for a given team, or null while it has no result.
 *
 * Exported as a function rather than stored on the row because the same game reads as a win for
 * one side and a loss for the other, and both teams' pages render the same rows.
 */
export function outcomeFor(game: ResultsGame, teamId: number): GameOutcome {
  if (!game.finished || game.homeScore === null || game.awayScore === null) return null;

  const isHome = game.homeTeamId === teamId;
  const isAway = game.awayTeamId === teamId;
  if (!isHome && !isAway) return null;

  const own = isHome ? game.homeScore : game.awayScore;
  const other = isHome ? game.awayScore : game.homeScore;
  if (own > other) return 'win';
  if (own < other) return 'loss';
  return 'draw';
}
