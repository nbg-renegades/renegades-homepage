import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';

import {
  GAMEDAY_INTERVAL_MS,
  HOURLY_MS,
  LIVE_INTERVAL_MS,
  isGamedayWindow,
  whatIsDue,
  type ScheduleInput,
  type Task,
} from './schedule.ts';

// 2026-06-20 is in CEST (UTC+2), so 12:00Z is 14:00 club time. Kickoffs below are club times.
const NOW = new Date('2026-06-20T12:00:00Z');
const TODAY = '2026-06-20';

function input(overrides: Partial<ScheduleInput> = {}): ScheduleInput {
  return {
    now: NOW,
    today: TODAY,
    lastOkAt: {},
    todaysKickoffs: [],
    gameInProgress: false,
    gamedayFinished: false,
    ...overrides,
  };
}

function ago(ms: number): Date {
  return new Date(NOW.getTime() - ms);
}

/** Every task marked as just-succeeded, so a test only opts specific ones back in. */
function allFresh(): Record<Task, Date> {
  return {
    'team-snapshot': NOW,
    'league-snapshot': NOW,
    'league-table': NOW,
    liveticker: NOW,
  };
}

// ── Nothing to do ────────────────────────────────────────────────────────────

Deno.test('a tick with everything fresh does no upstream work', () => {
  const due = whatIsDue(input({ lastOkAt: allFresh() }));
  assertEquals(due.tasks, []);
  assertEquals(due.reason, 'nothing due');
});

Deno.test('a first run fetches everything', () => {
  const due = whatIsDue(input());
  assertEquals(new Set(due.tasks), new Set(['team-snapshot', 'league-table', 'league-snapshot']));
});

// ── No gameday today ─────────────────────────────────────────────────────────

Deno.test('with no game today the snapshot runs hourly, not every ten minutes', () => {
  const almost = whatIsDue(input({
    lastOkAt: { ...allFresh(), 'team-snapshot': ago(HOURLY_MS - 60_000) },
  }));
  assert(!almost.tasks.includes('team-snapshot'));

  const due = whatIsDue(input({
    lastOkAt: { ...allFresh(), 'team-snapshot': ago(HOURLY_MS) },
  }));
  assert(due.tasks.includes('team-snapshot'));
  assertEquals(due.reason, 'hourly refresh');
});

Deno.test('the liveticker is never polled on a day with no gameday', () => {
  const due = whatIsDue(input({
    lastOkAt: { ...allFresh(), liveticker: ago(24 * HOURLY_MS) },
    todaysKickoffs: [],
  }));
  assert(!due.tasks.includes('liveticker'));
});

Deno.test('the liveticker starts with the gameday window, not with the first stored score', () => {
  // "In progress" comes from the snapshot, which refreshes every ten minutes. Waiting for it
  // would leave the live tab dark for the first minutes of a real game.
  const due = whatIsDue(input({
    todaysKickoffs: ['15:30:00'],
    gameInProgress: false,
    lastOkAt: { ...allFresh(), liveticker: ago(LIVE_INTERVAL_MS) },
  }));
  assert(due.tasks.includes('liveticker'));
  assertEquals(due.reason, 'inside the gameday window');
});

Deno.test('the liveticker stops once every game is finished', () => {
  const due = whatIsDue(input({
    todaysKickoffs: ['09:00:00'],
    gamedayFinished: true,
    lastOkAt: { ...allFresh(), liveticker: ago(24 * HOURLY_MS) },
  }));
  assert(!due.tasks.includes('liveticker'), 'nothing left to tick');
});

// ── Gameday window ───────────────────────────────────────────────────────────

Deno.test('the window opens two hours before the first kickoff, in club time', () => {
  // Now is 14:00 club time. A 17:00 kickoff is three hours out, still quiet.
  assert(!isGamedayWindow(input({ todaysKickoffs: ['17:00:00'] })));
  // 15:30 is inside the two-hour window.
  assert(isGamedayWindow(input({ todaysKickoffs: ['15:30:00'] })));
  // The earliest kickoff is what counts, not the order they arrive in.
  assert(isGamedayWindow(input({ todaysKickoffs: ['20:00:00', '15:30:00'] })));

  // The whole point of resolving in club time: read as UTC, a 17:00 kickoff would be two hours
  // later than it really is and this would wrongly look quiet.
  assert(isGamedayWindow(input({ todaysKickoffs: ['16:00:00'] })));
});

Deno.test('an unparseable kickoff keeps the faster cadence rather than losing it', () => {
  assert(isGamedayWindow(input({ todaysKickoffs: ['not a time'] })));
});

Deno.test('the window stays open after kickoff, however long the gameday runs', () => {
  assert(isGamedayWindow(input({ todaysKickoffs: ['09:00:00'] })));
});

Deno.test('inside the window the snapshot runs every ten minutes', () => {
  const base = { todaysKickoffs: ['11:00:00'] };

  const tooSoon = whatIsDue(input({
    ...base,
    lastOkAt: { ...allFresh(), 'team-snapshot': ago(GAMEDAY_INTERVAL_MS - 1000) },
  }));
  assert(!tooSoon.tasks.includes('team-snapshot'));

  const due = whatIsDue(input({
    ...base,
    lastOkAt: { ...allFresh(), 'team-snapshot': ago(GAMEDAY_INTERVAL_MS) },
  }));
  assert(due.tasks.includes('team-snapshot'));
  assertEquals(due.reason, 'gameday refresh');
});

// ── A game in progress ───────────────────────────────────────────────────────

Deno.test('a game in progress polls the liveticker every minute', () => {
  const base = { todaysKickoffs: ['11:00:00'], gameInProgress: true };

  const tooSoon = whatIsDue(input({
    ...base,
    lastOkAt: { ...allFresh(), liveticker: ago(LIVE_INTERVAL_MS - 1000) },
  }));
  assert(!tooSoon.tasks.includes('liveticker'));

  const due = whatIsDue(input({
    ...base,
    lastOkAt: { ...allFresh(), liveticker: ago(LIVE_INTERVAL_MS) },
  }));
  assertEquals(due.tasks, ['liveticker']);
  assertEquals(due.reason, 'a game is in progress');
});

Deno.test('the liveticker comes first, because that is the number someone is watching', () => {
  const due = whatIsDue(input({
    todaysKickoffs: ['11:00:00'],
    gameInProgress: true,
    lastOkAt: {},
  }));
  assertEquals(due.tasks[0], 'liveticker');
});

Deno.test('a game in progress does not make the snapshot go faster than ten minutes', () => {
  const due = whatIsDue(input({
    todaysKickoffs: ['11:00:00'],
    gameInProgress: true,
    lastOkAt: { ...allFresh(), 'team-snapshot': ago(2 * LIVE_INTERVAL_MS) },
  }));
  assert(!due.tasks.includes('team-snapshot'), 'the snapshot budget must not be spent per minute');
});

// ── After the final whistle ──────────────────────────────────────────────────

Deno.test('a finished gameday pulls the standings in without waiting an hour', () => {
  const due = whatIsDue(input({
    todaysKickoffs: ['09:00:00'],
    gamedayFinished: true,
    lastOkAt: { ...allFresh(), 'league-table': ago(GAMEDAY_INTERVAL_MS) },
  }));
  assert(due.tasks.includes('league-table'));
  assert(due.tasks.includes('league-snapshot'), 'the cross-check needs the league-scoped snapshot');
  assertEquals(due.reason, 'gameday finished, standings settled');
});

Deno.test('a finished gameday drops back to the hourly snapshot cadence', () => {
  const due = whatIsDue(input({
    todaysKickoffs: ['09:00:00'],
    gamedayFinished: true,
    lastOkAt: { ...allFresh(), 'team-snapshot': ago(GAMEDAY_INTERVAL_MS) },
  }));
  assert(!due.tasks.includes('team-snapshot'), 'there is nothing left to change today');
});

Deno.test('standings and the league snapshot always travel together', () => {
  for (const finished of [true, false]) {
    const due = whatIsDue(input({
      todaysKickoffs: ['09:00:00'],
      gamedayFinished: finished,
      lastOkAt: {},
    }));
    assertEquals(
      due.tasks.includes('league-table'),
      due.tasks.includes('league-snapshot'),
      'a table without its snapshot cannot be cross-checked',
    );
  }
});

// ── Budget ───────────────────────────────────────────────────────────────────

Deno.test('a full gameday stays inside the snapshot budget', () => {
  // Walk a 12-hour gameday minute by minute and count the snapshot scopes requested.
  // Two scopes per team-snapshot task (all statuses, then drafts) and one per league season.
  const LEAGUE_SEASONS = 2;
  let teamSnapshots = 0;
  let leagueSnapshots = 0;
  const lastOkAt: Record<string, Date> = {};

  for (let minute = 0; minute < 12 * 60; minute += 1) {
    const now = new Date('2026-06-20T08:00:00Z');
    now.setUTCMinutes(now.getUTCMinutes() + minute);

    const due = whatIsDue({
      now,
      today: '2026-06-20',
      lastOkAt: lastOkAt as ScheduleInput['lastOkAt'],
      todaysKickoffs: ['10:00:00'],
      gameInProgress: minute > 120 && minute < 480,
      gamedayFinished: minute >= 480,
    });

    for (const task of due.tasks) {
      lastOkAt[task] = now;
      if (task === 'team-snapshot') teamSnapshots += 1;
      if (task === 'league-snapshot') leagueSnapshots += 1;
    }
  }

  const calls = teamSnapshots * 2 + leagueSnapshots * LEAGUE_SEASONS;
  const hours = 12;
  const perHour = calls / hours;
  assert(
    perHour <= 30,
    `averaged ${perHour.toFixed(1)} snapshot calls/hour over a gameday, cap is 30`,
  );
  // And it must actually be doing work, not passing by doing nothing.
  assert(teamSnapshots > 10, `expected regular refreshes, got ${teamSnapshots}`);
});
