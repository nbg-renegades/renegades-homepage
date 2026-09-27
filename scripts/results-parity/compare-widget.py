"""One-off: compare what the sync stored against the widget's snapshot.json.

The widget snapshot was generated 2026-08-07 and covers every team; ours covers teams 159/287
from 2026-01-01. So the comparison is over the intersection, and anything only we have is
reported separately rather than counted as a difference.
"""
import json, subprocess, sys

WIDGET = '/Users/phhbr/Documents/Repositories/renegades/renegades-scores/snapshot.json'
TEAMS = {159, 287}

def psql(sql):
    out = subprocess.run(
        ['docker', 'exec', 'results-schema-test', 'psql', '-U', 'postgres', '-tAF\x1f', '-c', sql],
        capture_output=True, text=True, check=True).stdout
    return [line.split('\x1f') for line in out.strip().split('\n') if line.strip()]

# Ours
ours = {}
for gid, gdid, date, home, away, hs, as_, fin in psql("""
  select g.id, g.gameday_id, gd.date, coalesce(g.home_name,''), coalesce(g.away_name,''),
         coalesce(g.home_score::text,''), coalesce(g.away_score::text,''), g.finished
  from public.results_games g join public.results_gamedays gd on gd.id = g.gameday_id;"""):
    ours[int(gid)] = dict(gameday=int(gdid), date=date, home=home, away=away,
                          home_score=int(hs) if hs else None,
                          away_score=int(as_) if as_ else None, finished=fin == 't')

# Theirs, restricted to games our teams play in and to 2026
theirs = {}
snap = json.load(open(WIDGET))
for gd in snap['gamedays']:
    if not str(gd.get('date', '')).startswith('2026'):
        continue
    for game in gd.get('games') or []:
        results = game.get('results') or []
        if not any(r.get('team_id') in TEAMS for r in results):
            continue
        home = next((r for r in results if r.get('isHome')), None)
        away = next((r for r in results if not r.get('isHome')), None)
        # The widget stores only `pa` per side plus a `final_score` object; it does not keep
        # `fh`/`sh`. An unplayed game has `pa: None`, and final_score is 0:0 either way, so the
        # pa values decide whether a score exists at all.
        played = home is not None and away is not None \
            and home.get('pa') is not None and away.get('pa') is not None
        final = game.get('final_score') or {}
        theirs[int(game['id'])] = dict(
            gameday=gd['id'], date=gd['date'],
            home=(home or {}).get('team_name') or '', away=(away or {}).get('team_name') or '',
            home_score=final.get('home') if played else None,
            away_score=final.get('away') if played else None,
            finished=game.get('status') == 'beendet')

both = sorted(set(ours) & set(theirs))
only_ours = sorted(set(ours) - set(theirs))
only_theirs = sorted(set(theirs) - set(ours))

print(f'games in our database (2026, teams 159/287): {len(ours)}')
print(f'games in the widget snapshot (same filter):   {len(theirs)}')
print(f'in both:      {len(both)}')
print(f'only ours:    {len(only_ours)}')
print(f'only widget:  {len(only_theirs)}')
print()

FIELDS = ['date', 'home', 'away', 'home_score', 'away_score', 'finished']
diffs = []
for gid in both:
    for field in FIELDS:
        if ours[gid][field] != theirs[gid][field]:
            diffs.append((gid, field, ours[gid][field], theirs[gid][field]))

if diffs:
    print(f'FIELD DIFFERENCES: {len(diffs)}')
    for gid, field, a, b in diffs[:40]:
        print(f'  game {gid} {field}: ours={a!r} widget={b!r}')
else:
    print(f'no field differences across {len(both)} shared games '
          f'({len(both) * len(FIELDS)} field comparisons)')

if only_ours:
    print('\ngames only we have (published after the widget snapshot of 2026-08-07):')
    for gid in only_ours[:20]:
        print(f'  game {gid} on {ours[gid]["date"]}  {ours[gid]["home"]} v {ours[gid]["away"]}')
if only_theirs:
    print('\ngames only the widget has:')
    for gid in only_theirs[:20]:
        print(f'  game {gid} on {theirs[gid]["date"]}  {theirs[gid]["home"]} v {theirs[gid]["away"]}')

sys.exit(1 if diffs else 0)
