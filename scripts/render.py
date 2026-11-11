import os, sys, json, subprocess, asyncio, pathlib
sys.excepthook = lambda t, v, tb: print("::error::" + (t.__name__ + ": " + str(v))[:380].replace("\n", " "))
import numpy as np, edge_tts

def err(m):
    print("::error::" + str(m).replace("\n", " ")[:380]); sys.exit(1)
def sh(cmd):
    return subprocess.run(cmd, text=True, capture_output=True)

vid, voice = os.environ["VID"], os.environ["VOICE"]
tag = "dub-" + vid
w = pathlib.Path("tmp"); w.mkdir(exist_ok=True)
bn = json.load(open(f"dw/work/{vid}/bn.json"))
r = sh(["gh", "release", "download", tag, "-p", "video.mp4", "-D", str(w), "--clobber"])
src = w / "video.mp4"
if not src.exists(): err("ভিডিও Release থেকে নামানো যায়নি: " + r.stderr[-250:])
dur = float(sh(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(src)]).stdout.strip())
SR = 24000

async def tts(text, path):
    await edge_tts.Communicate(text, voice).save(path)

def load(path):
    p = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-f", "s16le", "-ac", "1", "-ar", str(SR), "-"], capture_output=True)
    return np.frombuffer(p.stdout, dtype=np.int16).astype(np.float32) / 32768.0

def tempo(a, f):
    if abs(f - 1) < 0.02: return a
    p = subprocess.run(["ffmpeg", "-v", "error", "-f", "s16le", "-ar", str(SR), "-ac", "1", "-i", "-",
                        "-filter:a", f"atempo={f:.4f}", "-f", "s16le", "-ar", str(SR), "-ac", "1", "-"],
                       input=(a * 32768).astype(np.int16).tobytes(), capture_output=True)
    return np.frombuffer(p.stdout, dtype=np.int16).astype(np.float32) / 32768.0

track = np.zeros(int((dur + 2) * SR), dtype=np.float32)
subs = []
for i, c in enumerate(bn):
    mp3 = str(w / f"c{c['id']}.mp3")
    for attempt in range(3):
        try:
            asyncio.run(tts(c["bn"], mp3)); break
        except Exception as e:
            if attempt == 2: err(f"TTS ব্যর্থ (অংশ {c['id']}): {e}")
    a = load(mp3)
    nxt = bn[i + 1]["start"] if i + 1 < len(bn) else dur
    slot = max(0.8, nxt - c["start"] - 0.15)
    d = len(a) / SR
    if d > slot:
        a = tempo(a, min(d / slot, 1.7))
    s0 = int(c["start"] * SR)
    end = min(len(track), s0 + len(a))
    track[s0:end] += a[:end - s0]
    subs.append((c["start"], min(c["start"] + len(a) / SR + 0.3, nxt - 0.05), c["bn"]))

pk = np.abs(track).max()
if pk > 0.95: track *= 0.95 / pk
dub = w / "dub.wav"
import wave
with wave.open(str(dub), "wb") as wf:
    wf.setnchannels(1); wf.setsampwidth(2); wf.setframerate(SR)
    wf.writeframes((track * 32767).astype(np.int16).tobytes())

def ts(t):
    h = int(t // 3600); m = int(t % 3600 // 60); s = t % 60
    return f"{h:02d}:{m:02d}:{s:06.3f}".replace(".", ",")
def wrap(t, n=34):
    words, lines, cur = t.split(), [], ""
    for x in words:
        if len(cur) + len(x) + 1 > n and cur: lines.append(cur); cur = x
        else: cur = (cur + " " + x).strip()
    if cur: lines.append(cur)
    return "\n".join(lines)
srt = w / "sub.srt"
with open(srt, "w", encoding="utf-8") as f:
    for k, (a, b, t) in enumerate(subs, 1):
        f.write(f"{k}\n{ts(a)} --> {ts(b)}\n{wrap(t)}\n\n")

out = w / "final.mp4"
from PIL import Image, ImageDraw, ImageFont
pr = sh(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", str(src)]).stdout.strip().split(",")
W, H = int(pr[0]), int(pr[1])
fsz = max(22, W // 17)
font = ImageFont.truetype("assets/NotoSansBengali-Bold.ttf", fsz, layout_engine=ImageFont.Layout.RAQM)
def clean(t): return t.replace(",", "").replace("،", "").replace(".", "।").replace("।।", "।")
def wrap_px(t, maxw):
    lines, cur = [], ""
    for x in clean(t).split():
        trial = (cur + " " + x).strip()
        if font.getlength(trial) > maxw and cur: lines.append(cur); cur = x
        else: cur = trial
    if cur: lines.append(cur)
    return lines
pngs = []
for k, (a_, b_, t) in enumerate(subs):
    lines = wrap_px(t, W * 0.92)
    lh = int(fsz * 1.35)
    im = Image.new("RGBA", (W, lh * len(lines) + 12), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    for j, ln in enumerate(lines):
        tw = font.getlength(ln)
        d.text(((W - tw) / 2, 4 + j * lh), ln, font=font, fill=(255, 255, 255, 255), stroke_width=3, stroke_fill=(0, 0, 0, 255))
    pth = w / f"s{k}.png"; im.save(pth); pngs.append((pth, im.height, a_, b_))
cmd = ["ffmpeg", "-y", "-v", "error", "-i", str(src), "-i", str(dub)]
for pth, *_ in pngs: cmd += ["-i", str(pth)]
fc = "[0:a]volume=0.10[o];[1:a]volume=1.4[d];[o][d]amix=inputs=2:duration=first:normalize=0[a];"
prev = "0:v"
for k, (pth, h_, a_, b_) in enumerate(pngs):
    nxt_l = f"v{k}"
    fc += f"[{prev}][{k+2}:v]overlay=0:{H - h_ - int(H*0.04)}:enable='between(t,{a_:.2f},{b_:.2f})'[{nxt_l}];"
    prev = nxt_l
fc = fc.rstrip(";")
cmd += ["-filter_complex", fc, "-map", f"[{prev}]", "-map", "[a]", "-c:v", "libx264", "-crf", "23", "-preset", "veryfast",
        "-c:a", "aac", "-b:a", "160k", str(out)]
r = sh(cmd)
if not out.exists(): err("ভিডিও বানানো যায়নি: " + r.stderr[-300:])
final = w / f"dubbed-bn-{vid}.mp4"; out.rename(final)
r = sh(["gh", "release", "upload", tag, str(final), str(srt), "--clobber"])
if r.returncode: err("আপলোড ব্যর্থ: " + r.stderr[-250:])
print(f"::notice::OK https://github.com/{os.environ.get('GITHUB_REPOSITORY')}/releases/tag/{tag} ({final.stat().st_size//1048576} MB)")
