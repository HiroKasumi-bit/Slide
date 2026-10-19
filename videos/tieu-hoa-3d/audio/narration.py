# Vietnamese voice-over for the 3D digestion video (Microsoft neural voice via edge-tts).
# Each line reads its on-screen caption word for word; only the spoken form of
# foreign/chemical terms is respelled so the Vietnamese voice pronounces them the
# way a biology teacher would (the captions themselves stay verbatim).
#
#   python narration.py            -> assets/audio/voice/<id>.mp3 + lines.json (durations)
import asyncio, json, os, subprocess, sys

import edge_tts

VOICE = 'vi-VN-HoaiMyNeural'
RATE = '-4%'
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'assets', 'audio', 'voice')

LINES = [
    ('title', 'Tiêu hoá thức ăn trong ống tiêu hoá ở người.'),
    ('b1', 'Tiêu hoá ở khoang miệng. Răng cắt, nghiền nhỏ thức ăn.'),
    ('b2', 'Enzyme amylase trong nước bọt thuỷ phân tinh bột thành maltose.'),
    ('c', 'Thực quản co bóp theo kiểu nhu động, đẩy thức ăn xuống dạ dày.'),
    ('d1', 'Tiêu hoá ở dạ dày. Dạ dày co bóp, làm nhỏ và trộn thức ăn với dịch vị.'),
    ('d2', 'Pepsin phân giải protein thành các peptide.'),
    ('d3', 'HCl tạo môi trường acid, hỗ trợ hoạt động của pepsin và giúp hạn chế nhiều vi sinh vật có hại.'),
    ('e1', 'Tiêu hoá ở ruột non. Dịch tụy và dịch ruột chứa enzyme phân giải các chất dinh dưỡng.'),
    ('e2', 'Dịch mật do gan sản xuất giúp chia giọt mỡ lớn thành các giọt mỡ nhỏ, làm tăng diện tích tiếp xúc của lipid với enzyme lipase.'),
    ('e3', 'Nhu động đẩy thức ăn dọc theo ruột non về phía ruột già.'),
    ('f1', 'Hấp thụ chất dinh dưỡng chủ yếu diễn ra ở ruột non.'),
    ('f2', 'Thành ruột non có nhiều nếp gấp, lông ruột và vi nhung mao, làm tăng diện tích hấp thụ.'),
    ('g1', 'Tiêu hoá ở ruột già. Nhu động ruột già đẩy phân về phía trực tràng.'),
    ('g2', 'Phân được thải ra ngoài qua hậu môn.'),
    ('recap', 'Quá trình dinh dưỡng gồm 4 giai đoạn: lấy thức ăn, tiêu hoá thức ăn, hấp thụ chất dinh dưỡng, đồng hoá các chất.'),
]

# Spoken forms (Northern Vietnamese reading of the textbook terms)
SAY = [
    ('Enzyme', 'En dim'), ('enzyme', 'en dim'),
    ('amylase', 'a mi la dơ'), ('maltose', 'man tô dơ'),
    ('Pepsin', 'Pép xin'), ('pepsin', 'pép xin'),
    ('protein', 'prô tê in'), ('peptide', 'pép tít'),
    ('HCl', 'Hát xê lờ'), ('acid', 'a xít'),
    ('lipid', 'li pít'), ('lipase', 'li pa dơ'),
    ('4 giai đoạn', 'bốn giai đoạn'),
]


def spoken(text):
    for a, b in SAY:
        text = text.replace(a, b)
    return text


def duration(path):
    out = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path],
                         capture_output=True, text=True, check=True).stdout
    return float(out)


async def main():
    os.makedirs(OUT, exist_ok=True)
    proxy = os.environ.get('HTTPS_PROXY') or os.environ.get('https_proxy')
    meta = []
    for key, text in LINES:
        path = os.path.join(OUT, f'{key}.mp3')
        if not os.path.exists(path) or '--force' in sys.argv:
            await edge_tts.Communicate(spoken(text), VOICE, rate=RATE, proxy=proxy).save(path)
        meta.append({'id': key, 'text': text, 'spoken': spoken(text), 'file': f'assets/audio/voice/{key}.mp3',
                     'duration': round(duration(path), 3)})
        print(f'{key:6} {meta[-1]["duration"]:5.2f}s  {spoken(text)}')
    with open(os.path.join(HERE, 'lines.json'), 'w') as f:
        json.dump(meta, f, ensure_ascii=False, indent=1)


asyncio.run(main())
