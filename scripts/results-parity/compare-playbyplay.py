"""Compares our play-by-play running scores against the widget's.

The widget scraped the game-detail HTML page and recorded a running score `s` on every scoring
play. We derive ours from /api/snapshot/'s structured log. Two independent derivations of the
same progression, so the sequence of scores should be identical even though the widget also
captured non-scoring events (First Down, Strafe, Auszeit) that the JSON API does not expose.
"""
import json, subprocess, re, sys

WIDGET='/Users/phhbr/Documents/Repositories/renegades/renegades-scores/snapshot.json'
TEAMS={159,287}

rows = subprocess.run(
    ['docker','exec','results-schema-test','psql','-U','postgres','-tAF\x1f','-c',
     """select game_id, half, seq, score_home, score_away, points, is_deleted
        from public.results_game_events order by game_id, half, seq;"""],
    capture_output=True, text=True, check=True).stdout

ours={}
for line in rows.strip().split('\n'):
    if not line.strip(): continue
    gid, half, seq, sh, sa, pts, deleted = line.split('\x1f')
    if int(pts) == 0:      # only scoring plays carry a comparable score
        continue
    ours.setdefault(int(gid), []).append(f'{sh}:{sa}')

snap=json.load(open(WIDGET))
theirs={}
for gd in snap['gamedays']:
    for game in gd.get('games') or []:
        results = game.get('results') or []
        if not any(r.get('team_id') in TEAMS for r in results): continue
        log = game.get('log') or {}
        seq=[]
        for ev in log.get('ev') or []:
            s = ev.get('s')
            # `s` is also used for clock updates ("Spielzeit: 07:00"); keep only scores.
            if isinstance(s, str) and re.fullmatch(r'\d+:\d+', s):
                seq.append(s)
        if seq: theirs[int(game['id'])]=seq

both=sorted(set(ours)&set(theirs))
print(f'games with play-by-play in both: {len(both)}')
mismatch=[]
for gid in both:
    # The widget records 0:0 on the first change of possession before anyone has scored.
    mine=ours[gid]
    theirsSeq=[s for s in theirs[gid] if s != '0:0'] if theirs[gid][:1]==['0:0'] else theirs[gid]
    if mine != theirsSeq:
        mismatch.append((gid, mine, theirsSeq))

# Ours is coarser by design. /api/snapshot/ groups a touchdown and its conversion under one
# `sequence`, so we emit one row (7:0) where the widget's HTML scrape emitted two (6:0, 7:0).
# The correctness claim is therefore: our progression is a subsequence of the widget's, and both
# end on the same score. Anything else is a real disagreement.
def is_subsequence(small, big):
    it = iter(big)
    return all(any(x == y for y in it) for x in small)

wrong=[]
coarser=0
for gid, mine, theirsSeq in [(g, ours[g], theirs[g]) for g in both]:
    cleaned = theirsSeq[1:] if theirsSeq[:1] == ['0:0'] else theirsSeq
    same_end = bool(mine) and bool(cleaned) and mine[-1] == cleaned[-1]
    if not (is_subsequence(mine, cleaned) and same_end):
        wrong.append((gid, mine, cleaned))
    elif len(mine) < len(cleaned):
        coarser += 1

total=sum(len(ours[g]) for g in both)
print(f'scoring plays compared: {total}')
print(f'progressions that are a subsequence of the widget’s and end on the same score: '
      f'{len(both) - len(wrong)}/{len(both)}')
print(f'of those, coarser than the widget (touchdown and conversion grouped): {coarser}')
if wrong:
    print(f'\nREAL DISAGREEMENTS: {len(wrong)}')
    for gid, a, b in wrong[:5]:
        print(f'  game {gid}')
        print(f'    ours   ({len(a)}): {" ".join(a)}')
        print(f'    widget ({len(b)}): {" ".join(b)}')
sys.exit(1 if wrong else 0)
