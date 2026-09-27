# LeagueSphere fixtures

Recorded responses from `https://leaguesphere.app`, captured **2026-09-27**. These are the
functional spec for `_shared/leaguesphere/`: the mappers, scoring and standings modules are
tested against them so a change in our code fails locally rather than in production.

LeagueSphere is a third-party system. Re-record only when a shape genuinely changed upstream,
and mind the throttles: `/api/snapshot/` is **60 requests/hour per IP**, all anonymous API
traffic is **120/min per IP**.

## Real recordings

| File | Request | Why it is here |
| --- | --- | --- |
| `snapshot.teams-159-287.json` | `/api/snapshot/?team=159&team=287&include=games,logs`, trimmed to gamedays 645, 844, 852, 893 | The main read path. Covers finished games, an unplayed (`Geplant`) game, an abandoned `2. Halbzeit` game, failed extra points, a deleted log entry, a real address, a city-only address and the `Adresse folgt in der Einladung` placeholder. |
| `snapshot.league-ffbl-2026.json` | `/api/snapshot/?league=18&season=6&include=games` | League-scoped fetch for FF BL 2026. Standings parity oracle: reproduces `league-table.ff-bl-2026.json` exactly. |
| `snapshot.league-dffl-2026.json` | `/api/snapshot/?league=7&season=6&include=games` | Same for DKB DFFL 2026. W/L/D/PF/PA reproduce exactly; `win_points`/`win_quotient` do not — see the Phase 0 notes. |
| `snapshot.status-draft-empty.json` | `…&status=DRAFT` | The real second call of the two-call draft strategy. Currently returns zero gamedays for our teams; proves the empty-but-valid response shape. |
| `liveticker.default-5-ticks.json` | `/api/liveticker/` | Default response: **only the 5 most recent ticks per game**, newest first. Also shows that recently finished games stay listed, and that unrelated leagues' games come back (we must filter by our own game ids). |
| `liveticker.get-all-ticks-for.json` | `/api/liveticker/?getAllTicksFor=9149,9150` | Full tick history (41 and 26 ticks). Required for a per-tick running score. Oldest tick is `Spiel gestartet`, newest `Spiel beendet`. |
| `league-table.ff-bl-2026.json` | `/api/league-table/ff-bl/2026/` | Cross-check target. Its ruleset is the simple one: `win_points = 2·S + U`, `win_quotient = win_points / (2·Sp)`. |
| `league-table.dffl-2026.json` | `/api/league-table/dffl/2026/` | Cross-check target for the 1st team. **Different ruleset**: `win_quotient = win_points / 30` (fixed divisor) and `win_points ≠ 2·S + U`. |
| `snapshot.error-unknown-season-pk.json` | `…&season=2026` | 400. `season` is a **Season primary key**, not a year — `season=2026` is rejected. The 2026 season is PK `6`. |
| `snapshot.error-unknown-status.json` | `…&status=BOGUS` | 400 shape for an invalid status. |
| `league-table.error-unknown-league.json` | `/api/league-table/dkb-dffl/2026/` | 404. The 1st team's league slug is `dffl`, **not** `dkb-dffl`. |

## Synthetic fixtures

Two cases the brief asks for do not exist upstream right now. They are derived from real
gameday 852 with one field changed, carry a `_synthetic` key explaining exactly what was
changed and why, and must be replaced with real recordings if such a gameday ever appears.

| File | What was forced |
| --- | --- |
| `snapshot.synthetic-draft-gameday.json` | `status: "DRAFT"`. No DRAFT gameday exists for teams 159/287 as of 2026-09-27. |
| `snapshot.synthetic-empty-status-gameday.json` | `status: ""`. Every gameday for our teams is currently `PUBLISHED`. |

## Facts these recordings pin down

- **ETag**: the HTTP header is quoted (`"3066857c…"`), the `etag` field in the body is not.
  `If-None-Match` must send the quoted header form; a 304 was verified end to end.
- **`final_score` is never `null`** — it is `{home: 0, away: 0}` for unplayed games. A guard on
  `final_score == null` never fires. Use `status === 'beendet'` plus non-null `pa`.
- **`pa` is points *against*.** The winner is the side with the lower `pa`. Own points scored are
  `fh + sh`, which equals the opponent's `pa`.
- **Game status is free text**, observed: `Geplant`, `2. Halbzeit`, `beendet`. Do not model it as a
  closed enum.
- **Log entries** are grouped by `sequence` and carry player numbers as values. Player number `0`
  occurs, so presence must be tested with a null check, never truthiness.
- **Points**, validated against all 1500 upstream half-scores with zero mismatches:
  `td` → 6, `pat1` non-null → 1, `pat2` non-null → 2, `Safety (+2)` non-null → 2,
  `cop: true` → 0 (possession marker), and any entry with `isDeleted: true` contributes 0.
