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
| `snapshot.teams-159-287-with-time.json` | Same request with `year=2026`, recorded **2026-10-28**, trimmed to the same four gamedays | LeagueSphere 4.42 added `time` (ISO instant) to every log entry and `player` (number or null) to every possession marker. Otherwise its logs equal the recording above, which pins that the new fields change no stored row. |
| `snapshot.teams-159-287-since-2023.json` | `/api/snapshot/?team=159&team=287&date_from=2023-01-01&include=games,logs`, recorded **2026-10-29**, trimmed to the games of teams 159/287 and minified (about 245 KB) | Oracle for every tracked game since 2023: 36 gamedays, 123 games, 492 reported halves, all reproduced from their logs. Also the history source for SYNC-07. |
| `snapshot.standings-teams-159-287-2026.json` | `/api/snapshot/?team=159&team=287&year=2026&include=standings`, recorded **2026-10-29** | The standings source of record: both tables in one request, each row with upstream's `rank` and `group`. FF BL carries 23 ranked rows plus four `Initial` rows with no games. |
| `snapshot.standings-teams-159-287-2027-empty.json` | Same request with `year=2027`, recorded **2026-10-29** | A valid answer with `standings: []` for a season nobody has played: the last good table must be kept. |
| `snapshot.status-draft-empty.json` | `…&status=DRAFT` | The real second call of the two-call draft strategy. Currently returns zero gamedays for our teams; proves the empty-but-valid response shape. |
| `liveticker.default-5-ticks.json` | `/api/liveticker/` | Default response: **only the 5 most recent ticks per game**, newest first. Also shows that recently finished games stay listed, and that unrelated leagues' games come back (we must filter by our own game ids). |
| `liveticker.get-all-ticks-for.json` | `/api/liveticker/?getAllTicksFor=9149,9150` | Full tick history (41 and 26 ticks). Required for a per-tick running score. Oldest tick is `Spiel gestartet`, newest `Spiel beendet`. |
| `snapshot.error-unknown-status.json` | `…&status=BOGUS` | 400 shape for an invalid status. |

## Synthetic fixtures

Cases that do not exist upstream right now are derived from a real gameday with a minimal
change, carry a `_synthetic` key explaining exactly what was changed and why, and must be
replaced with real recordings if such a case ever appears.

| File | What was forced |
| --- | --- |
| `snapshot.synthetic-draft-gameday.json` | `status: "DRAFT"`. No DRAFT gameday exists for teams 159/287 as of 2026-09-27. |
| `snapshot.synthetic-empty-status-gameday.json` | `status: ""`. Every gameday for our teams is currently `PUBLISHED`. |
| `snapshot.synthetic-ot-safety1.json` | Real gameday 632 / game 7272 (from the since-2023 recording) with two home second-half entries added, `OT: 23` and `Safety (+1): 8`, and every reported home total raised by 2. Neither event occurs in any recorded game of teams 159/287 as of 2026-10-29. |

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
- **Points**, validated against all 1500 upstream half-scores with zero mismatches, and against
  the 492 halves of the 123 tracked games in `snapshot.teams-159-287-since-2023.json`:
  `td` → 6, `pat1` non-null → 1, `pat2` non-null → 2, `Safety (+2)` non-null → 2,
  `cop: true` → 0 (possession marker), and any entry with `isDeleted: true` contributes 0.
  `OT` non-null → 1 and `Safety (+1)` non-null → 1 come from upstream's own table
  (`SCORING_EVENT_VALUES`) and are proven on the synthetic fixture only.
