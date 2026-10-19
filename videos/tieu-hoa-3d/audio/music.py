# Background music for the 3D digestion video, synthesised from scratch (no samples,
# no licence to worry about): a calm "science documentary" bed in D major —
# warm detuned pad, soft sub bass, a plucked arpeggio that enters with the
# journey, glassy bells for the absorption scene, resolving on D for the recap.
#
#   python music.py <video seconds> <recap start> <out.wav>
import sys

import numpy as np
import soundfile as sf
from scipy.signal import fftconvolve, butter, sosfilt

SR = 48000
TOTAL = float(sys.argv[1]) if len(sys.argv) > 1 else 96.2
RECAP = float(sys.argv[2]) if len(sys.argv) > 2 else 87.55
OUT = sys.argv[3] if len(sys.argv) > 3 else 'music.wav'
rng = np.random.default_rng(8)

N = int((TOTAL + 0.5) * SR)
t_all = np.arange(N) / SR
mix_dry = np.zeros((N, 2))
mix_wet = np.zeros((N, 2))   # sent to the reverb

hz = lambda m: 440.0 * 2 ** ((m - 69) / 12)

# Chord loop (bass note, upper voicing) — Dmaj9, Bm9, Gmaj9, Asus4→A
PROG = [
    (38, [50, 57, 61, 64, 66]),
    (35, [47, 54, 57, 61, 62]),
    (31, [43, 50, 54, 57, 59]),
    (33, [45, 52, 57, 62, 64]),
]
FINAL = (38, [50, 57, 61, 64, 66, 69])
BARS = 28
BAR = RECAP / BARS            # the loop lands on A exactly when the recap starts
chords = [(i * BAR, (i + 1) * BAR, *PROG[i % 4]) for i in range(BARS)]
chords.append((RECAP, TOTAL + 0.5, *FINAL))


def env(n, attack, release, sustain_from=None):
    e = np.ones(n)
    a = min(n, int(attack * SR))
    r = min(n, int(release * SR))
    if a:
        e[:a] = np.sin(np.linspace(0, np.pi / 2, a)) ** 2
    if r:
        e[-r:] *= np.cos(np.linspace(0, np.pi / 2, r)) ** 2
    return e


def place(buf, start, sig, pan=0.0):
    i = int(start * SR)
    if i < 0:
        sig, i = sig[-i:], 0
    if i >= len(buf):
        return
    sig = sig[: len(buf) - i]
    l, r = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
    buf[i:i + len(sig), 0] += sig * l
    buf[i:i + len(sig), 1] += sig * r


def section_level(t):
    """Arrangement over the video: 0..1 intensity used by the moving layers."""
    pts = [(0, 0.0), (5.5, 0.0), (7.5, 0.7), (40, 0.85), (63.6, 1.0), (75, 0.75), (RECAP - 1, 0.6), (RECAP + 1.5, 0.35), (TOTAL, 0.0)]
    xs, ys = zip(*pts)
    return np.interp(t, xs, ys)


# ---- Pad: detuned saw-like voices through a gently opening low-pass
for (a, b, bass, notes) in chords:
    dur = b - a + 1.6
    n = int(dur * SR)
    tt = np.arange(n) / SR
    pad = np.zeros(n)
    cutoff = 900 + 700 * section_level(a + tt / 2)
    for m in notes:
        f0 = hz(m + 12 * (m < 48))
        for det in (-0.07, 0.0, 0.06):
            f = f0 * 2 ** (det / 12)
            ph = rng.uniform(0, 2 * np.pi)
            for k in range(1, 9):
                if f * k > 6000:
                    break
                g = (1 / k) / (1 + (f * k / cutoff) ** 2)
                pad += g * np.sin(2 * np.pi * f * k * tt + ph * k)
    pad *= env(n, 1.4, 1.6) * (0.5 + 0.5 * np.sin(2 * np.pi * 0.11 * tt + a) * 0.25 + 0.25)
    pad *= 0.010
    place(mix_dry, a - 0.3, pad * 0.6, -0.15)
    place(mix_dry, a - 0.3, pad * 0.6, 0.15)
    place(mix_wet, a - 0.3, pad * 0.9, 0.0)

# ---- Sub bass: one soft swell per bar
for (a, b, bass, notes) in chords:
    if a < 6:
        continue
    n = int((b - a + 0.4) * SR)
    tt = np.arange(n) / SR
    f = hz(bass + 12)          # an octave up so classroom speakers can play it
    s = np.sin(2 * np.pi * f * tt) + 0.3 * np.sin(2 * np.pi * 2 * f * tt)
    s *= env(n, 0.25, 0.8) * 0.035 * float(section_level(a))
    place(mix_dry, a, s, 0.0)

# ---- Plucked arpeggio (eighth notes), with a ping-pong echo via the wet bus
step = BAR / 8
pattern = [0, 2, 4, 1, 3, 2, 4, 3]
for (a, b, bass, notes) in chords:
    if a < 6.4:
        continue
    pool = sorted(set(notes[1:] + [notes[1] + 12, notes[2] + 12]))
    for j in range(8):
        t0 = a + j * step
        if t0 >= min(b, TOTAL - 1.5):
            break
        lvl = float(section_level(t0))
        if a >= RECAP and j > 3:
            break
        m = pool[pattern[j] % len(pool)] + 12
        f = hz(m)
        n = int(1.2 * SR)
        tt = np.arange(n) / SR
        s = (np.sin(2 * np.pi * f * tt) + 0.35 * np.sin(2 * np.pi * 2 * f * tt) * np.exp(-tt / 0.12)
             + 0.12 * np.sin(2 * np.pi * 3 * f * tt) * np.exp(-tt / 0.06))
        s *= np.exp(-tt / 0.32) * env(n, 0.004, 0.05)
        accent = 1.0 if j % 4 == 0 else 0.75
        s *= 0.035 * lvl * accent
        pan = 0.35 if j % 2 else -0.35
        place(mix_dry, t0, s, pan)
        place(mix_wet, t0, s * 1.2, -pan)
        place(mix_wet, t0 + 3 * step / 2, s * 0.45, pan)   # echo

# ---- Glass bells: sparse, brighter during absorption (villi) and the recap
bell_times = [1.2, 4.0] + [x for x in np.arange(44.0, 75.0, BAR)] + [RECAP + 0.3, RECAP + 2.6]
for i, t0 in enumerate(bell_times):
    chord = next(c for c in chords if c[0] <= t0 < c[1])
    m = chord[3][(i * 2) % len(chord[3])] + 24
    f = hz(m)
    n = int(3.0 * SR)
    tt = np.arange(n) / SR
    s = (np.sin(2 * np.pi * f * tt) * np.exp(-tt / 1.1) + 0.4 * np.sin(2 * np.pi * f * 2.76 * tt) * np.exp(-tt / 0.4)
         + 0.2 * np.sin(2 * np.pi * f * 5.4 * tt) * np.exp(-tt / 0.18)) * env(n, 0.003, 0.2)
    s *= 0.022
    place(mix_dry, t0, s, 0.5 if i % 2 else -0.5)
    place(mix_wet, t0, s * 1.6, 0.0)

# ---- Soft pulse (felt-like low thump on beats 1 and 3) while food travels
for (a, b, bass, notes) in chords:
    if a < 7 or a >= RECAP:
        continue
    for j in (0, 2):
        t0 = a + j * BAR / 4
        n = int(0.4 * SR)
        tt = np.arange(n) / SR
        f = 70 + 60 * np.exp(-tt / 0.03)
        s = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-tt / 0.11) * 0.025 * float(section_level(t0))
        place(mix_dry, t0, s, 0.0)

# ---- Reverb: decaying, darkened stereo noise as an impulse response
ir_n = int(3.2 * SR)
it = np.arange(ir_n) / SR
ir = rng.standard_normal((ir_n, 2)) * np.exp(-it / 0.85)[:, None]
ir = sosfilt(butter(2, 5000, 'low', fs=SR, output='sos'), ir, axis=0)
ir[: int(0.02 * SR)] *= np.linspace(0, 1, int(0.02 * SR))[:, None]
ir /= np.sqrt((ir ** 2).sum(axis=0))
wet = np.stack([fftconvolve(mix_wet[:, c], ir[:, c])[:N] for c in range(2)], axis=1)

out = mix_dry + 0.55 * wet
out = sosfilt(butter(2, 60, 'high', fs=SR, output='sos'), out, axis=0)   # no rumble
fade = int(2.5 * SR)
end = int(TOTAL * SR)
out = out[:end]
out[-fade:] *= np.linspace(1, 0, fade)[:, None] ** 2
out *= 0.5 / np.max(np.abs(out))
sf.write(OUT, out.astype(np.float32), SR, subtype='FLOAT')
print('music', OUT, f'{len(out) / SR:.2f}s', f'bar {BAR:.3f}s')
