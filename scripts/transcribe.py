import os, sys, json, subprocess, re, pathlib

def err(m):
    print("::error::" + str(m).replace("\n", " ")[:380]); sys.exit(1)
def sh(cmd, **k):
    return subprocess.run(cmd, check=False, text=True, capture_output=True, **k)

url, lang, model = os.environ["URL"], os.environ["LANG_CODE"], os.environ["MODEL"]
f = os.environ.get("FILE", "").strip()
import shutil, hashlib
if f:
    if not os.path.isfile(f): err("ফাইল পাওয়া যায়নি: " + f)
    vid = "f" + hashlib.md5(open(f, "rb").read(1 << 20)).hexdigest()[:10]
    work = pathlib.Path("work") / vid; work.mkdir(parents=True, exist_ok=True)
    mp4 = work / "video.mp4"; shutil.copy(f, mp4)
elif "drive.google.com" in url:
    m_ = re.search(r"/d/([\w-]+)|[?&]id=([\w-]+)", url)
    if not m_: err("ড্রাইভ লিংক থেকে ফাইল আইডি পাওয়া যায়নি")
    fid = m_.group(1) or m_.group(2)
    vid = "g" + fid[:12]
    work = pathlib.Path("work") / vid; work.mkdir(parents=True, exist_ok=True)
    mp4 = work / "video.mp4"
    r = sh(["gdown", "--id", fid, "-O", str(mp4)])
    if not mp4.exists() or mp4.stat().st_size < 10000:
        err("ড্রাইভ থেকে নামানো যায়নি (শেয়ার সেটিং 'যে কেউ লিংক দিয়ে' আছে কিনা দেখুন): " + (r.stderr or "")[-250:])
else:
    r = sh(["yt-dlp", "--get-id", url])
    vid = r.stdout.strip().splitlines()[-1] if r.stdout.strip() else ""
    if not re.fullmatch(r"[\w-]{6,20}", vid):
        err("ভিডিও আইডি পাওয়া যায়নি: " + (r.stderr or "")[-250:])
    work = pathlib.Path("work") / vid; work.mkdir(parents=True, exist_ok=True)
    mp4 = work / "video.mp4"
    r = sh(["yt-dlp", "-f", "bv*[height<=720]+ba/b[height<=720]/b", "--merge-output-format", "mp4",
            "--extractor-args", "youtube:player_client=tv,web_safari,ios", "-o", str(mp4), url])
    if not mp4.exists():
        err("ডাউনলোড ব্যর্থ (YouTube বট-সুরক্ষা হতে পারে): " + (r.stderr or "")[-280:])
wav = work / "audio.wav"
sh(["ffmpeg", "-y", "-i", str(mp4), "-vn", "-ac", "1", "-ar", "16000", str(wav)])
dur = float(sh(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(mp4)]).stdout.strip() or 0)

from faster_whisper import WhisperModel
m = WhisperModel(model, device="cpu", compute_type="int8")
segs, info = m.transcribe(str(wav), language=lang, vad_filter=True, beam_size=5)
out = []
for i, s in enumerate(segs, 1):
    t = s.text.strip()
    if t: out.append({"id": i, "start": round(s.start, 2), "end": round(s.end, 2), "text": t})
json.dump({"video_id": vid, "duration": dur, "lang": lang, "segments": out},
          open(work / "segments.json", "w"), ensure_ascii=False, indent=1)

# ভিডিও Release-এ রাখা
tag = "dub-" + vid
sh(["gh", "release", "create", tag, "--title", tag, "--notes", "dubbing work file"])
r = sh(["gh", "release", "upload", tag, str(mp4), "--clobber"])
if r.returncode: err("Release-এ ভিডিও রাখা যায়নি: " + r.stderr[-250:])

# লেখা dub-work ব্রাঞ্চে পুশ
sh(["git", "config", "user.name", "github-actions"]); sh(["git", "config", "user.email", "actions@github.com"])
sh(["git", "checkout", "-B", "dub-work"])
sh(["git", "add", "-f", str(work / "segments.json")])
sh(["git", "commit", "-m", "transcript " + vid])
r = sh(["git", "push", "-f", "origin", "dub-work"])
if r.returncode: err("পুশ ব্যর্থ: " + r.stderr[-250:])
print(f"::notice::OK id={vid} duration={dur:.0f}s segments={len(out)}")
