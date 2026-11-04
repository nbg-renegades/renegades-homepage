import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';

import {
  diffEvents,
  gamesWithLogs,
  livePruneAllowed,
  MAX_PRUNED_GAMEDAYS_PER_RUN,
  planPrune,
} from './reconcile.ts';
import type { PruneInput, ScopeResult } from './reconcile.ts';
import type { GameEventRow } from './mappers.ts';
import { toGameEventRows } from './mappers.ts';
import { parseSnapshot } from './schema.ts';
import type { UpstreamGame, UpstreamGameday } from './schema.ts';
import { loadFixture } from './__fixtures__/load.ts';

function row(seq: number, overrides: Partial<GameEventRow> = {}): GameEventRow {
  return {
    game_id: 100,
    seq,
    half: 1,
    side: 'home',
    text: `Touchdown: #${seq}`,
    points: 6,
    score_home: 6,
    score_away: 0,
    is_deleted: false,
    is_marker: false,
    ...overrides,
  };
}

// ── diffEvents ───────────────────────────────────────────────────────────────

Deno.test('an unchanged play-by-play needs no write', () => {
  const rows = [row(1), row(2, { half: 2, side: 'away' })];
  const diff = diffEvents(rows, structuredClone(rows));
  assertEquals(diff.upsert, []);
  assertEquals(diff.remove, []);
});

Deno.test('a new play is upserted and nothing is removed', () => {
  const diff = diffEvents([row(1)], [row(1), row(2)]);
  assertEquals(diff.upsert, [row(2)]);
  assertEquals(diff.remove, []);
});

Deno.test('a play whose text, points, score, deleted or marker flag changed is upserted', () => {
  const changes: Partial<GameEventRow>[] = [
    { text: 'Touchdown: #9' },
    { points: 7 },
    { score_home: 7 },
    { score_away: 2 },
    { is_deleted: true },
    { is_marker: true },
  ];
  for (const change of changes) {
    const diff = diffEvents([row(1)], [row(1, change)]);
    assertEquals(diff.upsert, [row(1, change)], `changed ${Object.keys(change)[0]}`);
    assertEquals(diff.remove, []);
  }
});

Deno.test('a play key that vanished upstream is removed', () => {
  const gone = row(2, { half: 2, side: 'away', text: 'Safety (+2): #4', points: 2 });
  const diff = diffEvents([row(1), gone], [row(1)]);
  assertEquals(diff.upsert, []);
  assertEquals(diff.remove, [{ game_id: 100, half: 2, side: 'away', seq: 2 }]);
});

Deno.test('the same seq on the other side or half is a different play', () => {
  const diff = diffEvents([row(1)], [row(1), row(1, { side: 'away' }), row(1, { half: 2 })]);
  assertEquals(diff.upsert.length, 2);
  assertEquals(diff.remove, []);
});

// ── gamesWithLogs ────────────────────────────────────────────────────────────

async function realGameday(): Promise<UpstreamGameday> {
  const parsed = parseSnapshot(await loadFixture('snapshot.teams-159-287.json'));
  assert(parsed.ok, parsed.ok ? '' : parsed.errors.join('; '));
  const found = parsed.value.gamedays.find((gameday) => gameday.id === 645);
  assert(found !== undefined, 'gameday 645 must be in the fixture');
  return found;
}

function gamedayOf(base: UpstreamGameday, id: number, games: UpstreamGame[]): UpstreamGameday {
  return { ...base, id, games };
}

Deno.test('only tracked games with a log take part in the diff', async () => {
  const base = await realGameday();
  const ours = base.games.find((game) => game.id === 7374);
  assert(ours !== undefined && ours.log !== null, 'game 7374 must carry a log');

  const otherClub: UpstreamGame = {
    ...ours,
    id: 1,
    results: ours.results.map((result) => ({ ...result, team_id: 1 })),
  };
  const noLog: UpstreamGame = { ...ours, id: 2, log: null };
  const none = { score: 0, entries: [] };
  const emptyLog: UpstreamGame = {
    ...ours,
    id: 3,
    log: {
      ...ours.log,
      home: { ...ours.log.home, firsthalf: none, secondhalf: none },
      away: { ...ours.log.away, firsthalf: none, secondhalf: none },
    },
  };

  const found = gamesWithLogs([gamedayOf(base, 9, [ours, otherClub, noLog, emptyLog])]);
  // The empty log stays: its stored plays have to be removed.
  assertEquals(found.map((game) => game.id), [7374, 3]);
  assertEquals(toGameEventRows(emptyLog), []);
});

Deno.test('a game delivered by both scopes is diffed once, the later copy winning', async () => {
  const base = await realGameday();
  const ours = base.games.find((game) => game.id === 7374);
  assert(ours !== undefined, 'game 7374 must be in the fixture');

  const earlier: UpstreamGame = { ...ours, status: 'earlier' };
  const later: UpstreamGame = { ...ours, status: 'later' };
  const found = gamesWithLogs([
    gamedayOf(base, 10, [earlier]),
    gamedayOf(base, 11, [later]),
  ]);

  assertEquals(found.length, 1);
  assertEquals(found[0].status, 'later');
});

// ── Scopes ───────────────────────────────────────────────────────────────────

const fresh = (...gamedayIds: number[]): ScopeResult => ({ outcome: 'fresh', gamedayIds });
const unchanged: ScopeResult = { outcome: 'unchanged', gamedayIds: [] };
const unknown: ScopeResult = { outcome: 'unknown', gamedayIds: [] };

Deno.test('live rows are pruned only after a fresh main scope', () => {
  assertEquals(livePruneAllowed({ main: fresh(10), draft: fresh() }), true);
  assertEquals(livePruneAllowed({ main: fresh(10), draft: unchanged }), true);
  // The latent bug: with only the DRAFT scope fresh, today's game ids come out empty and an
  // empty keep list clears every live row, including a running game's.
  assertEquals(livePruneAllowed({ main: unchanged, draft: fresh() }), false);
  assertEquals(livePruneAllowed({ main: unknown, draft: fresh() }), false);
});

// ── planPrune ────────────────────────────────────────────────────────────────

function stored(id: number, status = 'PUBLISHED', date = '2026-06-20') {
  return { id, status, date };
}

function pruneInput(overrides: Partial<PruneInput> = {}): PruneInput {
  return {
    historyFrom: '2026-01-01',
    stored: { gamedays: [], games: [] },
    scopes: { main: fresh(), draft: fresh() },
    kept: { gamedayIds: [], gameIds: [] },
    maxGamedays: MAX_PRUNED_GAMEDAYS_PER_RUN,
    ...overrides,
  };
}

Deno.test('a game re-published under a new id replaces the old one', () => {
  const plan = planPrune(pruneInput({
    stored: { gamedays: [stored(10)], games: [{ id: 100, gameday_id: 10 }] },
    scopes: { main: fresh(10), draft: fresh() },
    kept: { gamedayIds: [10], gameIds: [200] },
  }));
  assertEquals(plan, { gamedayIds: [], gameIds: [100], skipped: null });
});

Deno.test('a gameday re-published under a new id replaces the old one', () => {
  const plan = planPrune(pruneInput({
    stored: { gamedays: [stored(10)], games: [{ id: 100, gameday_id: 10 }] },
    scopes: { main: fresh(11), draft: fresh() },
    kept: { gamedayIds: [11], gameIds: [200] },
  }));
  // Its game goes with it through the foreign key, so it is not listed on its own.
  assertEquals(plan, { gamedayIds: [10], gameIds: [], skipped: null });
});

Deno.test('a gameday upstream deleted is pruned with its games', () => {
  const plan = planPrune(pruneInput({
    stored: {
      gamedays: [stored(10), stored(11)],
      games: [{ id: 100, gameday_id: 10 }, { id: 101, gameday_id: 10 }, { id: 110, gameday_id: 11 }],
    },
    scopes: { main: fresh(11), draft: unchanged },
    kept: { gamedayIds: [11], gameIds: [110] },
  }));
  assertEquals(plan, { gamedayIds: [10], gameIds: [], skipped: null });
});

Deno.test('a gameday still in the payload without any tracked game is pruned', () => {
  const plan = planPrune(pruneInput({
    stored: { gamedays: [stored(10), stored(11)], games: [] },
    scopes: { main: fresh(10, 11), draft: fresh() },
    kept: { gamedayIds: [10], gameIds: [100] },
  }));
  assertEquals(plan.gamedayIds, [11]);
});

Deno.test('a game that moved to another kept gameday is not pruned', () => {
  const plan = planPrune(pruneInput({
    stored: { gamedays: [stored(10), stored(11)], games: [{ id: 100, gameday_id: 10 }] },
    scopes: { main: fresh(10, 11), draft: fresh() },
    kept: { gamedayIds: [10, 11], gameIds: [100] },
  }));
  assertEquals(plan, { gamedayIds: [], gameIds: [], skipped: null });
});

Deno.test('a 304 main scope prunes nothing it owns', () => {
  const plan = planPrune(pruneInput({
    stored: { gamedays: [stored(10)], games: [{ id: 100, gameday_id: 10 }] },
    scopes: { main: unchanged, draft: fresh() },
  }));
  assertEquals(plan, { gamedayIds: [], gameIds: [], skipped: null });
});

Deno.test('a failed, throttled or capped scope prunes nothing it owns', () => {
  const plan = planPrune(pruneInput({
    stored: { gamedays: [stored(10), stored(20, 'DRAFT')], games: [] },
    scopes: { main: unknown, draft: fresh() },
  }));
  // Not the published one (its own scope is unknown) and not the draft one either: with main
  // unknown, a draft that was published meanwhile cannot be told from a deleted one.
  assertEquals(plan, { gamedayIds: [], gameIds: [], skipped: null });
});

Deno.test('the DRAFT call owns stored drafts', () => {
  const plan = planPrune(pruneInput({
    stored: { gamedays: [stored(10), stored(20, 'DRAFT')], games: [] },
    scopes: { main: unchanged, draft: fresh() },
  }));
  assertEquals(plan.gamedayIds, [20]);
});

Deno.test('an empty DRAFT scope never trips the guard', () => {
  const plan = planPrune(pruneInput({
    stored: { gamedays: [stored(10), stored(20, 'DRAFT')], games: [] },
    scopes: { main: fresh(10), draft: fresh() },
    kept: { gamedayIds: [10], gameIds: [] },
  }));
  assertEquals(plan, { gamedayIds: [20], gameIds: [], skipped: null });
});

Deno.test('nothing is pruned while the other scope is unknown', () => {
  const plan = planPrune(pruneInput({
    stored: { gamedays: [stored(10), stored(11)], games: [] },
    scopes: { main: fresh(10), draft: unknown },
    kept: { gamedayIds: [10], gameIds: [] },
  }));
  // Gameday 11 may have moved to DRAFT, which the unknown scope would have shown.
  assertEquals(plan.gamedayIds, []);
});

Deno.test('a main scope with zero gamedays while gamedays are stored prunes nothing and says so', () => {
  const plan = planPrune(pruneInput({
    stored: { gamedays: [stored(10), stored(11)], games: [{ id: 100, gameday_id: 10 }] },
    scopes: { main: fresh(), draft: fresh() },
  }));
  assertEquals(plan.gamedayIds, []);
  assertEquals(plan.gameIds, []);
  assert(plan.skipped !== null && plan.skipped.includes('2'), `names the count: ${plan.skipped}`);
});

Deno.test('more than 10 gamedays to delete deletes nothing and says so', () => {
  const run = (count: number) =>
    planPrune(pruneInput({
      stored: {
        gamedays: [stored(1), ...Array.from({ length: count }, (_, i) => stored(100 + i))],
        games: [],
      },
      scopes: { main: fresh(1), draft: fresh() },
      kept: { gamedayIds: [1], gameIds: [] },
    }));

  const over = run(11);
  assertEquals(over.gamedayIds, []);
  assert(over.skipped !== null && over.skipped.includes('11') && over.skipped.includes('10'));

  const exactly = run(10);
  assertEquals(exactly.gamedayIds.length, 10);
  assertEquals(exactly.skipped, null);
});

Deno.test('a gameday before historyFrom is never touched', () => {
  const plan = planPrune(pruneInput({
    stored: { gamedays: [stored(10), stored(5, 'PUBLISHED', '2025-08-02')], games: [] },
    scopes: { main: fresh(10), draft: fresh() },
    kept: { gamedayIds: [10], gameIds: [] },
  }));
  assertEquals(plan.gamedayIds, []);
});
