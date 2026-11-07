/* Daily Edit — chat -> script -> voice -> images -> finished video (all in the browser) */
const API = "https://generativelanguage.googleapis.com/v1beta/models/";
const DEFAULTS = {
  key: "", ratio: "16:9", scenes: "6", voice: "Kore",
  mText: "gemini-2.5-flash",
  mTts: "gemini-2.5-flash-preview-tts",
  mImg: "gemini-2.5-flash-image",
};
const $ = (id) => document.getElementById(id);
const cfg = () => {
  let s = {};
  try { s = JSON.parse(localStorage.getItem("daily-edit-cfg") || "{}"); } catch (e) {}
  return { ...DEFAULTS, ...s };
};

/* ---------- settings ---------- */
const fields = { key: "sKey", ratio: "sRatio", scenes: "sScenes", voice: "sVoice", mText: "mText", mTts: "mTts", mImg: "mImg" };
$("btnSettings").onclick = () => {
  const c = cfg();
  for (const k in fields) $(fields[k]).value = c[k];
  $("dlg").showModal();
};
$("btnClose").onclick = () => $("dlg").close();
$("btnSave").onclick = () => {
  const c = {};
  for (const k in fields) c[k] = $(fields[k]).value.trim();
  try { localStorage.setItem("daily-edit-cfg", JSON.stringify(c)); } catch (e) {}
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
async function gem(model, body, key, tries = 4) {
  let last;
  for (let i = 0; i < tries; i++) {
    const r = await fetch(`${API}${model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify(body),
    });
    if (r.ok) return r.json();
    last = `${r.status} ${(await r.text()).slice(0, 300)}`;
    if (![429, 500, 503].includes(r.status)) break;
    await sleep(2000 * (i + 1));
  }
  throw new Error(last);
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
  }, c.key);
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
  }, c.key);
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
    generationConfig: { responseModalities: ["IMAGE"] },
  }, c.key);
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
  if (!c.key) { $("btnSettings").click(); return; }
  busy = true; $("btnSend").disabled = true; $("prompt").value = "";
  addMsg("user", esc(topic));
  const bot = addMsg("bot", `<b>কাজ চলছে...</b><ul class="steps"></ul>`);
  const ul = bot.querySelector(".steps");
  const step = (label) => {
    const li = document.createElement("li"); li.className = "run"; li.textContent = label; ul.appendChild(li);
    li.scrollIntoView({ block: "end" });
    return { set: (t) => (li.textContent = t), ok: () => (li.className = "done"), fail: () => (li.className = "fail") };
  };
  const actx = new (window.AudioContext || window.webkitAudioContext)();
  try {
    let st = step("স্ক্রিপ্ট লেখা হচ্ছে");
    const script = await writeScript(topic, c);
    st.set(`স্ক্রিপ্ট তৈরি: ${script.title} (${script.scenes.length}টি দৃশ্য)`); st.ok();

    const scenes = script.scenes.map((s) => ({ ...s }));
    st = step("ভয়েস (অডিও) তৈরি হচ্ছে");
    for (let i = 0; i < scenes.length; i++) {
      st.set(`ভয়েস তৈরি হচ্ছে ${i + 1}/${scenes.length}`);
      scenes[i].audio = await makeVoice(scenes[i].narration, c, actx);
    }
    st.set("ভয়েস তৈরি শেষ"); st.ok();

    st = step("ছবি তৈরি হচ্ছে (Nano Banana)");
    let failed = 0;
    for (let i = 0; i < scenes.length; i++) {
      st.set(`ছবি তৈরি হচ্ছে ${i + 1}/${scenes.length}`);
      try { scenes[i].img = await makeImage(scenes[i].image_prompt, script.style, c); }
      catch (e) { failed++; console.warn("image fail", i, e); }
    }
    st.set(failed ? `ছবি তৈরি শেষ (${failed}টি ব্যর্থ, সেখানে সাধারণ ব্যাকগ্রাউন্ড)` : "ছবি তৈরি শেষ"); st.ok();

    st = step("ভিডিও জোড়া লাগানো হচ্ছে (রেকর্ডিং চলছে, ট্যাব খোলা রাখুন)");
    const { blob, ext, total } = await composeVideo(scenes, c, actx);
    st.set(`ভিডিও তৈরি শেষ (${Math.round(total)} সেকেন্ড)`); st.ok();

    const url = URL.createObjectURL(blob);
    const name = (script.title || "daily-edit").replace(/[^\p{L}\p{N}]+/gu, "-").slice(0, 40) + "." + ext;
    const thumbs = scenes.filter((s) => s.img).map((s) => {
      const t = document.createElement("canvas"); t.width = 160; t.height = Math.round(160 * s.img.height / s.img.width);
      t.getContext("2d").drawImage(s.img, 0, 0, t.width, t.height); return `<img src="${t.toDataURL("image/jpeg", .7)}">`;
    }).join("");
    addMsg("bot", `<b>${esc(script.title)}</b>
      <video src="${url}" controls playsinline></video>
      <a class="dl" href="${url}" download="${esc(name)}">⬇️ ডাউনলোড</a>
      <div class="thumbs">${thumbs}</div>
      <details class="script"><summary>স্ক্রিপ্ট দেখুন</summary>${scenes.map((s, i) => `<p>${i + 1}. ${esc(s.narration)}</p>`).join("")}</details>`);
  } catch (e) {
    console.error(e);
    addMsg("bot err", "ত্রুটি: " + esc(e.message || e) + "<br>API Key, মডেলের নাম বা কোটা দেখে আবার চেষ্টা করুন।");
  } finally {
    actx.close(); busy = false; $("btnSend").disabled = false;
  }
};
$("prompt").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("btnSend").click(); } });
