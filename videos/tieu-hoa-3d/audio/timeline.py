# Fits the video to its voice-over.
# The 3D scene was authored on a 72 s "scene clock". Each caption owns one segment of
# that clock; a segment is stretched (slow motion) when its narration needs longer.
# Writes schedule.json (time warp knots + cue times) and patches index.html to match.
import json, os, re

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, '..')
lines = {l['id']: l for l in json.load(open(os.path.join(HERE, 'lines.json')))}

TAIL_SILENCE = 0.88      # edge-tts pads every clip with ~0.88 s of silence
LEAD = 0.35              # caption appears, then the voice starts
HOLD = 0.75              # breathing room after the last word
OUT_GAP = 0.35           # caption leaves this long before the next segment

# (id, scene start, scene end)
SEGMENTS = [('title', 0, 6.6), ('b1', 6.6, 9.6), ('b2', 9.6, 13.4), ('c', 13.4, 20.4),
            ('d1', 20.4, 24.2), ('d2', 24.2, 27.4), ('d3', 27.4, 31.4),
            ('e1', 31.4, 35.2), ('e2', 35.2, 39.4), ('e3', 39.4, 43.4),
            ('f1', 43.4, 48.4), ('f2', 48.4, 54.4), ('g1', 54.4, 58.6), ('g2', 58.6, 64.6),
            ('recap', 64.6, 72)]

knots = [(0.0, 0.0)]
cues = {}
v = 0.0
for key, s0, s1 in SEGMENTS:
    speech = lines[key]['duration'] - TAIL_SILENCE
    lead = 0.8 if key == 'title' else 0.4 if key == 'recap' else LEAD
    hold = 1.6 if key == 'recap' else HOLD
    need = lead + speech + hold + (0 if key == 'recap' else OUT_GAP)
    length = round(max(s1 - s0, need), 2)
    cues[key] = {'start': round(v, 3), 'end': round(v + length, 3), 'voice': round(v + lead, 3)}
    v += length
    knots.append((float(s1), round(v, 3)))

TOTAL = round(v, 2)


def warp_v(s):
    """Scene time -> video time."""
    for (s0, v0), (s1, v1) in zip(knots, knots[1:]):
        if s <= s1:
            return round(v0 + (s - s0) * (v1 - v0) / (s1 - s0), 3)
    return knots[-1][1]


# Recap stages pop as the voice names them (word starts measured from recap.mp3)
RECAP_WORDS = [2.32, 3.29, 4.44, 5.81]
recap_pops = [round(cues['recap']['voice'] + t - 0.15, 3) for t in RECAP_WORDS]

sched = {'total': TOTAL, 'knots': knots, 'cues': cues, 'recap_pops': recap_pops,
         'legend': [warp_v(44.6), warp_v(53.6)], 'legend_clip': [warp_v(44), warp_v(54)]}
json.dump(sched, open(os.path.join(HERE, 'schedule.json'), 'w'), indent=1)
for k, c in cues.items():
    print(f'{k:6} {c["start"]:7.2f} → {c["end"]:7.2f}   voice {c["voice"]:7.2f}')
print('total', TOTAL)

# ---------------------------------------------------------------- patch index.html
path = os.path.join(ROOT, 'index.html')
doc = open(path).read()


def set_clip(doc, cid, start, dur):
    pat = re.compile(rf'(<section id="{cid}"[^>]*?data-start=")[^"]*(" data-duration=")[^"]*(")')
    doc, n = pat.subn(rf'\g<1>{start:g}\g<2>{dur:g}\g<3>', doc)
    assert n == 1, cid
    return doc


doc = re.sub(r'(<div id="root"[^>]*data-duration=")[^"]*(")', rf'\g<1>{TOTAL:g}\g<2>', doc)
title_end = cues['b1']['start']
doc = set_clip(doc, 'title', 0, round(title_end - 0.4, 2))
for key, c in cues.items():
    if key in ('title', 'recap'):
        continue
    doc = set_clip(doc, f'cap-{key}', c['start'], round(c['end'] - c['start'] - 0.05, 2))
doc = set_clip(doc, 'legend', sched['legend_clip'][0], round(sched['legend_clip'][1] - sched['legend_clip'][0], 2))
doc = set_clip(doc, 'recap', cues['recap']['start'], round(TOTAL - cues['recap']['start'], 2))

# Timeline: everything between the markers is regenerated
tl = [
    "tl.fromTo('#title .kick', { opacity: 0, x: -40 }, { opacity: 1, x: 0, duration: 0.8, ease: 'expo.out' }, 0.4);",
    "tl.fromTo('#title .w', { opacity: 0, yPercent: 60 }, { opacity: 1, yPercent: 0, duration: 0.9, ease: 'back.out(1.6)', stagger: 0.07 }, 0.6);",
    f"tl.to('#title .wrap', {{ opacity: 0, x: -60, duration: 0.5, ease: 'power2.in' }}, {round(title_end - 1.0, 2)});",
]
for key, c in cues.items():
    if key in ('title', 'recap'):
        continue
    tl.append(f"capIn('#cap-{key}', {c['start']});")
    tl.append(f"capOut('#cap-{key}', {round(c['end'] - OUT_GAP, 2)});")
l0, l1 = sched['legend']
tl.append(f"tl.fromTo('#legend span', {{ opacity: 0, y: -20 }}, {{ opacity: 1, y: 0, duration: 0.6, ease: 'expo.out', stagger: 0.15 }}, {l0});")
tl.append(f"tl.to('#legend .legend', {{ opacity: 0, duration: 0.3 }}, {l1});")
# The pulled-back recap shot puts the oesophagus label where the brand pill sits
tl.append(f"tl.to('.brand', {{ opacity: 0, x: -30, duration: 0.5, ease: 'power2.in' }}, {round(cues['recap']['start'] - 0.6, 2)});")
tl.append(f"tl.fromTo('#recap h2', {{ opacity: 0, y: 20 }}, {{ opacity: 1, y: 0, duration: 0.7, ease: 'expo.out' }}, {round(cues['recap']['start'] + 0.2, 2)});")
for i, t in enumerate(recap_pops):
    tl.append(f"tl.fromTo('#recap .stage:nth-child({i + 1})', {{ opacity: 0, y: 40, scale: 0.8 }}, {{ opacity: 1, y: 0, scale: 1, duration: 0.7, ease: 'back.out(1.8)' }}, {t});")
body = '\n'.join('        ' + x for x in tl)
doc, n = re.subn(r'// @timeline-begin\n.*?// @timeline-end', lambda m: '// @timeline-begin\n' + body + '\n        // @timeline-end', doc, flags=re.S)
assert n == 1, 'timeline markers'

warp_js = 'const WARP = ' + json.dumps([[a, b] for b, a in knots]) + ';'
doc, n = re.subn(r'const WARP = .*?;', warp_js, doc)
assert n == 1, 'warp table'
open(path, 'w').write(doc)
print('patched index.html')
