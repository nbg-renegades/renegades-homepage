/**
 * What is due on this tick.
 *
 * pg_cron calls the sync every minute, but almost every tick should do nothing. This module is
 * the whole decision, kept pure so the cadence can be tested against a clock instead of
 * observed over a weekend.
 *
 * The budget it is spending: `/api/snapshot/` allows 60 requests an hour per IP and the client
 * caps itself at 30. Two snapshot scopes (all statuses, then drafts) plus one per league season
 * means a full refresh is several calls, so "every 10 minutes" is about as fast as a gameday
 * can be polled while leaving headroom. The liveticker is far cheaper and is cached upstream
 * for 60 s, which is exactly the tick interval.
 */

import { clubInstant } from './time.ts';

export type Task =
  /** Both snapshot calls for our teams: everything but drafts, then drafts. */
  | 'team-snapshot'
  /** One league-scoped snapshot per configured league season, for the standings cross-check. */
  | 'league-snapshot'
  /** The published tables. */
  | 'league-table'
  /** Live ticks for today's games. */
  | 'liveticker';

export interface Due {
  readonly tasks: readonly Task[];
  /** Why, for the function logs. */
  readonly reason: string;
}

/** What the scheduler needs to know about the stored state. */
export interface ScheduleInput {
  readonly now: Date;
  /**
   * Today's club-local date, as `YYYY-MM-DD`. Passed in rather than derived from `now` so the
   * caller resolves the zone once and every module agrees on which day it is.
   */
  readonly today: string;
  /** Last successful run per task, as stored in `results_sync_state`. */
  readonly lastOkAt: Readonly<Partial<Record<Task, Date | null>>>;
  /** Kickoff times of today's games for our teams, as `HH:MM:SS` club time, unordered. */
  readonly todaysKickoffs: readonly string[];
  /** True when at least one of today's games has started and not finished. */
  readonly gameInProgress: boolean;
  /** True when today holds games for our teams and all of them are finished. */
  readonly gamedayFinished: boolean;
}

export const HOURLY_MS = 3_600_000;
export const GAMEDAY_INTERVAL_MS = 600_000;
export const LIVE_INTERVAL_MS = 60_000;

/**
 * How early before the first kickoff the faster cadence starts.
 *
 * Kickoff times move on the day, and a gameday's first game is the one most likely to be
 * re-scheduled, so the window opens well before it.
 */
export const PRE_KICKOFF_WINDOW_MS = 2 * HOURLY_MS;

function elapsed(now: Date, since: Date | null | undefined): number {
  if (since === null || since === undefined) return Number.POSITIVE_INFINITY;
  return now.getTime() - since.getTime();
}

function isDue(input: ScheduleInput, task: Task, intervalMs: number): boolean {
  return elapsed(input.now, input.lastOkAt[task]) >= intervalMs;
}

/**
 * True while today's gameday is close enough to matter.
 *
 * Deliberately open-ended after the first kickoff: a gameday runs for hours and there is no
 * reliable end time, so the window closes only when every game is finished, which
 * `gamedayFinished` reports separately.
 */
export function isGamedayWindow(input: ScheduleInput): boolean {
  if (input.todaysKickoffs.length === 0) return false;

  // Kickoffs are German wall-clock times with no zone, so they are resolved against the club
  // zone rather than against the UTC the function runs in.
  const earliest = input.todaysKickoffs
    .map((kickoff) => clubInstant(input.today, kickoff)?.getTime())
    .filter((ms): ms is number => ms !== undefined)
    .reduce((a, b) => Math.min(a, b), Number.POSITIVE_INFINITY);

  // Every kickoff unparseable: treat the gameday as under way rather than dropping to the
  // hourly cadence on a day we know has games.
  if (!Number.isFinite(earliest)) return true;

  return input.now.getTime() >= earliest - PRE_KICKOFF_WINDOW_MS;
}

/**
 * Decides this tick's work.
 *
 * The order of the checks is the priority: a game in progress is the only case where a visitor
 * is watching a number change, so the liveticker comes first and is the one thing allowed to
 * run every minute.
 */
export function whatIsDue(input: ScheduleInput): Due {
  const tasks: Task[] = [];
  const reasons: string[] = [];

  const inWindow = isGamedayWindow(input);
  const snapshotInterval = inWindow && !input.gamedayFinished ? GAMEDAY_INTERVAL_MS : HOURLY_MS;

  // Polled for the whole gameday window, not only once a game is known to be running.
  //
  // "In progress" is read from our own `games` rows, and those come from the snapshot, which is
  // only refreshed every ten minutes. Gating the ticker on it meant that at a real kickoff the
  // live tab stayed dark until the next snapshot happened to notice — up to ten minutes of a
  // game nobody could follow. The liveticker costs nothing against the snapshot budget and is
  // cached 60 s upstream, so polling it across the window is free and correct.
  if (!input.gamedayFinished && (input.gameInProgress || inWindow)) {
    if (isDue(input, 'liveticker', LIVE_INTERVAL_MS)) {
      tasks.push('liveticker');
      reasons.push(input.gameInProgress ? 'a game is in progress' : 'inside the gameday window');
    }
  }

  if (isDue(input, 'team-snapshot', snapshotInterval)) {
    tasks.push('team-snapshot');
    reasons.push(
      snapshotInterval === HOURLY_MS ? 'hourly refresh' : 'gameday refresh',
    );
  }

  // Standings move only when a game finishes, so the league-wide scopes follow the slower
  // cadence even during a gameday — and are pulled in immediately once it ends.
  const standingsDue = input.gamedayFinished
    ? isDue(input, 'league-table', GAMEDAY_INTERVAL_MS)
    : isDue(input, 'league-table', HOURLY_MS);

  if (standingsDue) {
    tasks.push('league-table', 'league-snapshot');
    reasons.push(input.gamedayFinished ? 'gameday finished, standings settled' : 'hourly standings refresh');
  }

  return {
    tasks,
    reason: reasons.length === 0 ? 'nothing due' : reasons.join('; '),
  };
}
