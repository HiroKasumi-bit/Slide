# Mixes the voice-over (each line at its cue from schedule.json) over the music bed,
# ducking the music under the voice, and muxes the result into the rendered video.
#
#   python mix.py renders/tieu-hoa-3d.mp4 out.mp4
import json, os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, '..')
sched = json.load(open(os.path.join(HERE, 'schedule.json')))
lines = json.load(open(os.path.join(HERE, 'lines.json')))
video, out = sys.argv[1], sys.argv[2]

inputs = ['-i', os.path.join(ROOT, 'assets/audio/music.wav')]
chains, labels = [], []
for k, line in enumerate(lines):
    inputs += ['-i', os.path.join(ROOT, line['file'])]
    ms = int(sched['cues'][line['id']]['voice'] * 1000)
    chains.append(f'[{k + 2}:a]aresample=48000,aformat=channel_layouts=stereo,adelay={ms}|{ms}[v{k}]')
    labels.append(f'[v{k}]')

total = sched['total']
graph = ';'.join(chains + [
    f'{"".join(labels)}amix=inputs={len(labels)}:normalize=0,apad=whole_dur={total},'
    'highpass=f=80,acompressor=threshold=-20dB:ratio=3:attack=5:release=120,volume=1.0[voice]',
    '[voice]asplit=2[vk][vm]',
    # music sits ~5 dB under the voice level between lines and dips ~6 dB more while it speaks
    '[1:a]volume=0.45[m]',
    '[m][vk]sidechaincompress=threshold=0.03:ratio=2.5:attack=60:release=900:makeup=1[duck]',
    '[duck][vm]amix=inputs=2:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000[aout]',
])
cmd = ['ffmpeg', '-hide_banner', '-y', '-i', video, *inputs, '-filter_complex', graph,
       '-map', '0:v', '-map', '[aout]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-shortest', out]
subprocess.run(cmd, check=True)
print('wrote', out)
