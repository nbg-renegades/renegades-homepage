import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';

import { diffEvents, gamesWithLogs, livePruneAllowed } from './reconcile.ts';
import type { ScopeResult } from './reconcile.ts';
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
