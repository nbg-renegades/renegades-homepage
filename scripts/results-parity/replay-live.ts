/**
 * Replays a recorded gameday so the live tab can be exercised without waiting for a real one.
 *
 * Stands in for LeagueSphere on a local port and hands out a progressively longer prefix of a
 * recorded tick history, oldest first, one step at a time. Point `sync-leaguesphere` at it with
 * `LEAGUESPHERE_BASE_URL` and each sync sees a few more plays, exactly as it would during a game:
 * the score moves, ticks land in `results_live_ticks`, Realtime pushes both to any open page, and
 * the last step marks the game finished.
 *
 * The ticks are real — `__fixtures__/liveticker.get-all-ticks-for.json`, recorded on 2026-09-27 —
 * so the text, the timestamps and the scoring are upstream's, not invented.
 *
 * Usage:
 *   deno run --allow-net --allow-read scripts/results-parity/replay-live.ts [--port 8787] [--game 9149]
 *
 * Then, in another shell:
 *   LEAGUESPHERE_BASE_URL=http://localhost:8787 \
 *   SUPABASE_URL=http://localhost:55434 \
 *   SUPABASE_SERVICE_ROLE_KEY=<service role jwt> \
 *   RESULTS_SYNC_CRON_SECRET=local-test-cron-secret \
 *     deno run --allow-net --allow-env --allow-read supabase/functions/sync-leaguesphere/index.ts
 *
 *   # advance the replay and sync, repeatedly
 *   curl -X POST http://localhost:8787/advance
 *   curl -X POST http://localhost:8000/ -H 'x-cron-secret: local-test-cron-secret'
 */

const FIXTURES = new URL(
  '../../supabase/functions/_shared/leaguesphere/__fixtures__/',
  import.meta.url,
);

interface Tick {
  text: string;
  team: 'home' | 'away' | null;
  time: string;
}

interface LiveGame {
  gameId: number;
  status: string;
  standing?: string;
  time?: string;
  home: { name: string; score: number; isInPossession?: boolean };
  away: { name: string; score: number; isInPossession?: boolean };
  ticks: Tick[];
}

const args = parseArgs(Deno.args);
const port = Number(args.port ?? 8787);
const gameId = Number(args.game ?? 9149);
/** How many plays each `/advance` reveals. */
const step = Number(args.step ?? 3);

const recorded = await loadRecordedGame(gameId);
/** Oldest first, which is the order they happened in. */
const allTicks = [...recorded.ticks].reverse();
const today = clubToday();

let revealed = 0;

console.log(
  `replaying game ${gameId} — ${recorded.home.name} v ${recorded.away.name}, ` +
    `${allTicks.length} ticks, ${step} per step`,
);
console.log(`the gameday is dated ${today} so the sync treats it as today's`);
console.log(`listening on http://localhost:${port}`);

Deno.serve({ port }, (req) => {
  const url = new URL(req.url);

  if (req.method === 'POST' && url.pathname === '/advance') {
    revealed = Math.min(allTicks.length, revealed + step);
    const done = revealed >= allTicks.length;
    console.log(`→ ${revealed}/${allTicks.length} ticks${done ? ' (finished)' : ''}`);
    return json({ revealed, total: allTicks.length, finished: done });
  }

  if (req.method === 'POST' && url.pathname === '/reset') {
    revealed = 0;
    return json({ revealed, total: allTicks.length });
  }

  if (url.pathname === '/api/liveticker/') return json([currentLiveGame()]);
  if (url.pathname === '/api/snapshot/') return json(currentSnapshot());
  if (url.pathname.startsWith('/api/league-table/')) return json(emptyTable(url.pathname));

  return new Response('not found', { status: 404 });
});

/** The game as it stands after `revealed` plays: the ticks so far and the score they add up to. */
function currentLiveGame(): LiveGame {
  const ticks = allTicks.slice(0, revealed);
  let home = 0;
  let away = 0;
  for (const tick of ticks) {
    if (tick.team === 'home') home += points(tick.text);
    else if (tick.team === 'away') away += points(tick.text);
  }

  const finished = revealed >= allTicks.length;
  return {
    gameId,
    // The sync reads `beendet` as the game being over, which is what moves it to results.
    status: finished ? 'beendet' : revealed === 0 ? 'Geplant' : '2. Halbzeit',
    standing: recorded.standing ?? 'Gruppe 1',
    time: new Date().toISOString(),
    home: { name: recorded.home.name, score: home, isInPossession: false },
    away: { name: recorded.away.name, score: away, isInPossession: false },
    // Upstream serves newest first.
    ticks: [...ticks].reverse(),
  };
}

/**
 * A snapshot holding one gameday, dated today, with one game that our first team plays in.
 *
 * Team 159 is substituted into the recorded fixture so the sync's own scoping — "games involving
 * teams 159 and 287" — is exercised rather than bypassed.
 */
function currentSnapshot() {
  const live = currentLiveGame();
  const finished = revealed >= allTicks.length;
  const played = revealed > 0;

  return {
    generated_at: new Date().toISOString(),
    etag: `replay-${revealed}`,
    scope: { team: [159, 287], count: 1 },
    gamedays: [{
      id: 999900,
      name: 'Replay Spieltag',
      date: today,
      start: '10:00',
      league: 7,
      league_display: 'DKB DFFL',
      season: 6,
      season_display: String(new Date().getFullYear()),
      address: 'Hofer Straße 30, 90411 Nürnberg',
      status: 'PUBLISHED',
      games: [{
        id: gameId,
        gameday: 999900,
        scheduled: '10:00:00',
        field: 1,
        officials: null,
        stage: 'Hauptrunde',
        standing: 'Gruppe 1',
        status: live.status,
        results: [
          {
            id: 1,
            team_id: 159,
            team_name: 'Nürn',
            fh: played ? live.home.score : null,
            sh: played ? 0 : null,
            pa: played ? live.away.score : null,
            isHome: true,
          },
          {
            id: 2,
            team_id: 112,
            team_name: 'LLions',
            fh: played ? live.away.score : null,
            sh: played ? 0 : null,
            pa: played ? live.home.score : null,
            isHome: false,
          },
        ],
        halftime_score: { home: live.home.score, away: live.away.score },
        final_score: { home: live.home.score, away: live.away.score },
        // No log until the game is over: mid-game the structured log is what lags behind the
        // ticker, which is the whole reason the live tab reads the ticks instead.
        log: finished ? emptyLog() : null,
      }],
    }],
  };
}

function emptyLog() {
  const side = (id: number, name: string) => ({
    id,
    name,
    score: 0,
    firsthalf: { score: 0, entries: [] },
    secondhalf: { score: 0, entries: [] },
  });
  return { gameId, isFirstHalf: false, home: side(159, 'Nürn'), away: side(112, 'LLions') };
}

function emptyTable(pathname: string) {
  const [, , , slug = 'dffl', season = '2026'] = pathname.split('/');
  return {
    league: { slug, name: slug },
    season: { slug: season, name: season },
    // Empty on purpose: the sync refuses to overwrite a good table with an empty one, so a
    // replay cannot wipe the standings it is not testing.
    standing: [],
  };
}

/** Mirrors `tickPoints` in `_shared/leaguesphere/scoring.ts`. */
function points(text: string): number {
  const failed = /:\s*-\s*$/.test(text);
  if (text.startsWith('Touchdown')) return 6;
  if (text.startsWith('2-Extra-Punkte')) return failed ? 0 : 2;
  if (text.startsWith('1-Extra-Punkt')) return failed ? 0 : 1;
  if (text.startsWith('Safety')) return 2;
  return 0;
}

async function loadRecordedGame(id: number): Promise<LiveGame> {
  const raw = JSON.parse(
    await Deno.readTextFile(new URL('liveticker.get-all-ticks-for.json', FIXTURES)),
  ) as LiveGame[];
  const found = raw.find((game) => game.gameId === id) ?? raw[0];
  if (found === undefined) throw new Error('the liveticker fixture holds no games');
  return found;
}

function clubToday(): string {
  const parts = new Intl.DateTimeFormat('de-DE', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json', etag: `"replay-${revealed}"` },
  });
}

function parseArgs(argv: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        out[key] = next;
        i += 1;
      } else {
        out[key] = 'true';
      }
    }
  }
  return out;
}
