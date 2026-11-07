/* Daily Edit — chat -> script -> voice -> images -> finished video (all in the browser) */
const API = "https://generativelanguage.googleapis.com/v1beta/models/";
const DEFAULTS = {
  keys: "", ratio: "16:9", scenes: "6", voice: "Kore",
  mText: "gemini-2.5-flash, gemini-2.5-flash-lite",
  mTts: "gemini-2.5-flash-preview-tts, gemini-2.5-pro-preview-tts",
  mImg: "gemini-2.5-flash-image, gemini-2.0-flash-preview-image-generation",
};
const $ = (id) => document.getElementById(id);
const list = (x) => String(x || "").split(/[\n,]+/).map((v) => v.trim()).filter(Boolean);
const cfg = () => {
  let s = {};
  try {
    s = JSON.parse(localStorage.getItem("daily-edit-cfg2") || "null") || {};
    if (!s.keys) { const o = JSON.parse(localStorage.getItem("daily-edit-cfg") || "{}"); if (o.key) s.keys = o.key; }
  } catch (e) {}
  return { ...DEFAULTS, ...s };
};

/* ---------- settings ---------- */
const fields = { keys: "sKey", ratio: "sRatio", scenes: "sScenes", voice: "sVoice", mText: "mText", mTts: "mTts", mImg: "mImg" };
$("btnSettings").onclick = () => {
  const c = cfg();
  for (const k in fields) $(fields[k]).value = c[k];
  $("dlg").showModal();
};
$("btnClose").onclick = () => $("dlg").close();
$("btnSave").onclick = () => {
  const c = {};
  for (const k in fields) c[k] = $(fields[k]).value.trim();
  try { localStorage.setItem("daily-edit-cfg2", JSON.stringify(c)); } catch (e) {}
  $("dlg").close();
};

/* ---------- chat helpers ---------- */
function addMsg(cls, html) {
  const d = document.createElement("div");
  d.className = "msg " + cls;
  d.innerHTML = html;
  $("chat").appendChild(d);
  d.scrollIntoView({ block: "end" });
  return d;
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- Gemini calls ---------- */
/* Auto-switch: tries every (key, model) pair; on quota errors it moves to the next
   pair, and only waits when every pair is cooling down. */
const dead = new Set();     // "key|model" that will never work (bad key / unknown model)
const cool = new Map();     // "key|model" -> timestamp until which it is cooling down
let notify = () => {};
const retryMs = (txt) => {
  if (/PerDay/i.test(txt)) return 3600_000;
  const m = /"retryDelay":\s*"(\d+(?:\.\d+)?)s"/.exec(txt);
  return m ? Math.ceil(+m[1] * 1000) + 1000 : 60_000;
};

async function gem(models, body, c) {
  const keys = list(c.keys), mods = list(models);
  if (!keys.length) throw new Error("কোনো API Key দেওয়া নেই (⚙️ থেকে দিন)");
  let waits = 0, lastErr = "";
  for (;;) {
    let soonest = Infinity, alive = 0;
    for (const m of mods) {
      for (let ki = 0; ki < keys.length; ki++) {
        const id = keys[ki] + "|" + m;
        if (dead.has(id)) continue;
        alive++;
        const until = cool.get(id) || 0;
        if (until > Date.now()) { soonest = Math.min(soonest, until); continue; }
        let r;
        try {
          r = await fetch(`${API}${m}:generateContent`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-goog-api-key": keys[ki] },
            body: JSON.stringify(body),
          });
        } catch (e) { lastErr = String(e.message || e); cool.set(id, Date.now() + 3000); soonest = Math.min(soonest, Date.now() + 3000); continue; }
        if (r.ok) return r.json();
        const txt = await r.text();
        lastErr = `${r.status} ${txt.slice(0, 240)}`;
        if (r.status === 429) {
          cool.set(id, Date.now() + retryMs(txt)); soonest = Math.min(soonest, cool.get(id));
          notify(`কোটা শেষ (Key ${ki + 1} · ${m}), অন্যটিতে সুইচ করছি...`);
        } else if (r.status === 500 || r.status === 503) {
          cool.set(id, Date.now() + 5000); soonest = Math.min(soonest, cool.get(id));
          notify(`${m} ব্যস্ত, অন্যটিতে সুইচ করছি...`);
        } else if ([400, 401, 403, 404].includes(r.status)) {
          dead.add(id); alive--;
          notify(`Key ${ki + 1} · ${m} কাজ করছে না (${r.status}), বাদ দিয়ে সুইচ করছি...`);
        } else throw new Error(lastErr);
      }
    }
    if (!alive) throw new Error("কোনো Key/মডেল কাজ করছে না। শেষ ত্রুটি: " + lastErr);
    const wait = soonest - Date.now();
    if (!isFinite(soonest) || wait <= 0) continue;
    if (wait > 90_000 || ++waits > 5) throw new Error("সব Key ও মডেলের কোটা শেষ। নতুন Key যোগ করুন বা পরে চেষ্টা করুন। শেষ ত্রুটি: " + lastErr);
    for (let left = Math.ceil(wait / 1000); left > 0; left--) {
      notify(`সব কোটা শেষ, ${left} সেকেন্ড অপেক্ষা করে আবার চেষ্টা...`);
      await sleep(1000);
    }
  }
}

async function writeScript(topic, c) {
  const n = +c.scenes;
  const sys = `তুমি একজন ভিডিও স্ক্রিপ্ট লেখক। ব্যবহারকারীর অনুরোধের ভাষাতেই লেখো (বাংলা হলে সহজ, শুদ্ধ বাংলা)।
ঠিক ${n}টি দৃশ্য দাও। প্রতিটি দৃশ্যের narration ১-৩টি ছোট বাক্য, যা জোরে পড়লে ৫-১২ সেকেন্ড লাগে।
image_prompt অবশ্যই ইংরেজিতে, দৃশ্যের বিস্তারিত ছবির বর্ণনা, কোনো লেখা/অক্ষর ছবিতে থাকবে না।
style: সব ছবির জন্য একই আর্ট স্টাইল ও মূল চরিত্রের চেহারার ইংরেজি বর্ণনা (ধারাবাহিকতার জন্য)।`;
  const j = await gem(c.mText, {
    systemInstruction: { parts: [{ text: sys }] },
    contents: [{ role: "user", parts: [{ text: topic }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: {
          title: { type: "STRING" },
          style: { type: "STRING" },
          scenes: { type: "ARRAY", items: { type: "OBJECT",
            properties: { narration: { type: "STRING" }, image_prompt: { type: "STRING" } },
            required: ["narration", "image_prompt"] } },
        },
        required: ["title", "style", "scenes"],
      },
    },
  }, c);
  const t = j.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
  const s = JSON.parse(t.replace(/```json|```/g, "").trim());
  if (!s.scenes?.length) throw new Error("স্ক্রিপ্ট খালি এসেছে");
  return s;
}

async function makeVoice(text, c, actx) {
  const j = await gem(c.mTts, {
    contents: [{ parts: [{ text }] }],
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: c.voice } } },
    },
  }, c);
  const part = j.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
  if (!part) throw new Error("অডিও আসেনি");
  const rate = +(/rate=(\d+)/.exec(part.inlineData.mimeType || "") || [0, 24000])[1];
  const bin = atob(part.inlineData.data);
  const n = bin.length >> 1;
  const buf = actx.createBuffer(1, n, rate);
  const ch = buf.getChannelData(0);
  for (let i = 0; i < n; i++) {
    let v = bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8);
    if (v & 0x8000) v -= 0x10000;
    ch[i] = v / 32768;
  }
  return buf;
}

async function makeImage(prompt, style, c) {
  const j = await gem(c.mImg, {
    contents: [{ parts: [{ text: `${prompt}\n\nStyle: ${style}\nAspect ratio ${c.ratio}. No text, letters or watermarks.` }] }],
    generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
  }, c);
  const part = j.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
  if (!part) throw new Error("ছবি আসেনি");
  const blob = await (await fetch(`data:${part.inlineData.mimeType};base64,${part.inlineData.data}`)).blob();
  return await createImageBitmap(blob);
}

/* ---------- video composer (canvas + WebAudio + MediaRecorder) ---------- */
function wrap(ctx, text, maxW) {
  const words = text.split(/\s+/), lines = [];
  let cur = "";
  for (const w of words) {
    const t = cur ? cur + " " + w : w;
    if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t;
  }
  if (cur) lines.push(cur);
  return lines;
}

function drawScene(ctx, W, H, img, text, p, idx) {
  ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H);
  if (img) {
    const zoom = 1 + 0.08 * p;                       // slow Ken Burns zoom
    const base = Math.max(W / img.width, H / img.height) * zoom;
    const w = img.width * base, h = img.height * base;
    const dir = idx % 2 ? -1 : 1;
    ctx.drawImage(img, (W - w) / 2 + dir * (p - 0.5) * W * 0.03, (H - h) / 2, w, h);
  } else {
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, "#243b55"); g.addColorStop(1, "#141e30");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }
  // subtitles
  const fs = Math.round(Math.min(W, H) * 0.05);
  ctx.font = `600 ${fs}px "Noto Sans Bengali","Hind Siliguri",system-ui,sans-serif`;
  ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
  const lines = wrap(ctx, text, W * 0.86), lh = fs * 1.4;
  const boxH = lines.length * lh + fs * 0.6, y0 = H - boxH - H * 0.04;
  ctx.fillStyle = "rgba(0,0,0,.55)";
  ctx.fillRect(W * 0.04, y0, W * 0.92, boxH);
  ctx.fillStyle = "#fff";
  lines.forEach((l, i) => ctx.fillText(l, W / 2, y0 + fs * 0.3 + (i + 1) * lh - fs * 0.25));
}

async function composeVideo(scenes, c, actx) {
  const [rw, rh] = c.ratio === "9:16" ? [720, 1280] : [1280, 720];
  const cv = document.createElement("canvas"); cv.width = rw; cv.height = rh;
  const ctx = cv.getContext("2d");
  const GAP = 0.5;
  let t = 0;
  const plan = scenes.map((s) => { const o = { ...s, start: t, dur: s.audio.duration + GAP }; t += o.dur; return o; });
  const total = t;

  await actx.resume();
  const dest = actx.createMediaStreamDestination();
  const stream = new MediaStream([...cv.captureStream(30).getVideoTracks(), ...dest.stream.getAudioTracks()]);
  const mime = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm", "video/mp4"].find((m) => MediaRecorder.isTypeSupported(m));
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 4_000_000 });
  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const done = new Promise((r) => (rec.onstop = r));

  const t0 = actx.currentTime + 0.2;
  plan.forEach((s) => {
    const src = actx.createBufferSource(); src.buffer = s.audio; src.connect(dest);
    src.start(t0 + s.start);
  });
  rec.start(500);
  await new Promise((resolve) => {
    const tick = () => {
      const now = actx.currentTime - t0;
      if (now >= total) return resolve();
      const i = Math.max(0, plan.findIndex((s) => now >= s.start && now < s.start + s.dur));
      const s = plan[i];
      drawScene(ctx, rw, rh, s.img, s.narration, Math.min(1, Math.max(0, (now - s.start) / s.dur)), i);
      requestAnimationFrame(tick);
    };
    tick();
  });
  rec.stop(); await done;
  return { blob: new Blob(chunks, { type: mime.split(";")[0] }), ext: mime.startsWith("video/mp4") ? "mp4" : "webm", total };
}

/* ---------- pipeline ---------- */
let busy = false;
$("btnSend").onclick = async () => {
  const topic = $("prompt").value.trim();
  const c = cfg();
  if (busy || !topic) return;
  if (!list(c.keys).length) { $("btnSettings").click(); return; }
  busy = true; $("btnSend").disabled = true; $("prompt").value = "";
  addMsg("user", esc(topic));
  const bot = addMsg("bot", `<b>কাজ চলছে...</b><ul class="steps"></ul>`);
  const ul = bot.querySelector(".steps");
  const step = (label) => {
    const li = document.createElement("li"); li.className = "run"; li.textContent = label; ul.appendChild(li);
    li.scrollIntoView({ block: "end" });
    return { set: (t) => (li.textContent = t), ok: () => (li.className = "done"), fail: () => (li.className = "fail") };
  };
  let cur = null;
  notify = (m) => cur && cur.set(m);
  const actx = new (window.AudioContext || window.webkitAudioContext)();
  try {
    let st = cur = step("স্ক্রিপ্ট লেখা হচ্ছে");
    const script = await writeScript(topic, c);
    st.set(`স্ক্রিপ্ট তৈরি: ${script.title} (${script.scenes.length}টি দৃশ্য)`); st.ok();

    const scenes = script.scenes.map((s) => ({ ...s }));
    st = cur = step("ভয়েস (অডিও) তৈরি হচ্ছে");
    for (let i = 0; i < scenes.length; i++) {
      st.set(`ভয়েস তৈরি হচ্ছে ${i + 1}/${scenes.length}`);
      scenes[i].audio = await makeVoice(scenes[i].narration, c, actx);
    }
    st.set("ভয়েস তৈরি শেষ"); st.ok();

    st = cur = step("ছবি তৈরি হচ্ছে (Nano Banana)");
    let failed = 0;
    for (let i = 0; i < scenes.length; i++) {
      st.set(`ছবি তৈরি হচ্ছে ${i + 1}/${scenes.length}`);
      try { scenes[i].img = await makeImage(scenes[i].image_prompt, script.style, c); }
      catch (e) { failed++; console.warn("image fail", i, e); }
    }
    st.set(failed ? `ছবি তৈরি শেষ (${failed}টি ব্যর্থ, সেখানে সাধারণ ব্যাকগ্রাউন্ড)` : "ছবি তৈরি শেষ"); st.ok();

    st = cur = step("ভিডিও জোড়া লাগানো হচ্ছে (রেকর্ডিং চলছে, ট্যাব খোলা রাখুন)");
    const { blob, ext, total } = await composeVideo(scenes, c, actx);
    st.set(`ভিডিও তৈরি শেষ (${Math.round(total)} সেকেন্ড)`); st.ok();

    const url = URL.createObjectURL(blob);
    const name = (script.title || "daily-edit").replace(/[^\p{L}\p{N}]+/gu, "-").slice(0, 40) + "." + ext;
    const thumbs = scenes.filter((s) => s.img).map((s) => {
      const t = document.createElement("canvas"); t.width = 160; t.height = Math.round(160 * s.img.height / s.img.width);
      t.getContext("2d").drawImage(s.img, 0, 0, t.width, t.height); return `<img src="${t.toDataURL("image/jpeg", .7)}">`;
    }).join("");
    const card = addMsg("bot", `<b>${esc(script.title)}</b>
      <video src="${url}" controls playsinline></video>
      <a class="dl" id="dlBtn" href="${url}" download="${esc(name)}">${window.DailyNative ? "💾 সেভ / শেয়ার" : "⬇️ ডাউনলোড"}</a>
      <div class="thumbs">${thumbs}</div>
      <details class="script"><summary>স্ক্রিপ্ট দেখুন</summary>${scenes.map((s, i) => `<p>${i + 1}. ${esc(s.narration)}</p>`).join("")}</details>`);
    if (window.DailyNative) {
      card.querySelector("#dlBtn").onclick = async (ev) => {
        ev.preventDefault();
        try { await window.DailyNative.save(blob, name); }
        catch (e) { addMsg("bot err", "সেভ করা যায়নি: " + esc(e.message || e)); }
      };
    }
  } catch (e) {
    console.error(e);
    addMsg("bot err", "ত্রুটি: " + esc(e.message || e) + "<br>আবার চেষ্টা করলে কাজ না-করা Key/মডেল বাদ দিয়ে সুইচ করবে।");
  } finally {
    notify = () => {}; actx.close(); busy = false; $("btnSend").disabled = false;
  }
};
$("prompt").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("btnSend").click(); } });

/* ---------- in-app update ---------- */
const REPO = "alamgirabdullahgh/Daily-Editing";
const APK_URL = `https://github.com/${REPO}/releases/download/latest/Daily-Edit.apk`;
async function checkUpdate(manual) {
  const cur = window.APP_BUILD || 0;
  if (!cur && !window.DailyNative) { if (manual) addMsg("bot", "এটি ওয়েব সংস্করণ, রিফ্রেশ করলেই সর্বশেষটি পাবেন।"); return; }
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases/tags/latest`, { headers: { Accept: "application/vnd.github+json" } });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const j = await r.json();
    const m = /build:\s*(\d+)/.exec(j.body || "");
    const latest = m ? +m[1] : 0;
    if (latest > cur) {
      const d = addMsg("bot", `🔄 নতুন সংস্করণ আছে (build ${latest}, আপনার build ${cur})।<br><button class="upd">এখনই আপডেট করুন</button><br><span class="hint">APK নামলে খুলে "Install/Update" চাপুন।</span>`);
      d.querySelector(".upd").onclick = () => (window.DailyNative ? window.DailyNative.openUrl(APK_URL) : window.open(APK_URL, "_blank"));
    } else if (manual) addMsg("bot", `✅ আপনি সর্বশেষ সংস্করণেই আছেন (build ${cur})।`);
  } catch (e) {
    if (manual) addMsg("bot err", "আপডেট যাচাই করা যায়নি: " + esc(e.message || e));
  }
}
$("btnUpdate").onclick = () => checkUpdate(true);
$("verInfo").textContent = "সংস্করণ: build " + (window.APP_BUILD || "dev");
setTimeout(() => checkUpdate(false), 1500);
