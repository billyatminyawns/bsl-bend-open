/* ── 11th BSL Bend Open · app logic ── */
"use strict";

// ───────────────────────── helpers ─────────────────────────
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const uid = () => `id_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const holeInfo = (h) => COURSE.holes[h - 1];
const fmtPar = (d) => (d === 0 ? "E" : d > 0 ? `+${d}` : `${d}`);
const timeAgo = (ts) => {
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(ts).toLocaleDateString();
};
const scoreWord = (diff) => {
  if (diff <= -3) return "ALBATROSS ⁉️";
  if (diff === -2) return "EAGLE 🦅";
  if (diff === -1) return "BIRDIE 🐦";
  if (diff === 0) return "PAR";
  if (diff === 1) return "BOGEY";
  if (diff === 2) return "DOUBLE BOGEY 🍺";
  if (diff === 3) return "TRIPLE BOGEY";
  return `+${diff}`;
};

// ───────────────────────── sync adapters ─────────────────────────
// Both expose: on(path, cb) for live data, set(path, val), push(path, val) -> id, get(path) -> Promise
class FirebaseAdapter {
  constructor(cfg) {
    firebase.initializeApp(cfg);
    this.db = firebase.database();
    this.live = true;
  }
  on(path, cb) { this.db.ref(path).on("value", (s) => cb(s.val())); }
  set(path, val) { return this.db.ref(path).set(val); }
  push(path, val) { const r = this.db.ref(path).push(); r.set(val); return r.key; }
  async get(path) { const s = await this.db.ref(path).get(); return s.val(); }
  onConnection(cb) { this.db.ref(".info/connected").on("value", (s) => cb(!!s.val())); }
}

class LocalAdapter {
  constructor() {
    this.live = false;
    this.KEY = "bslbend-db";
    this.subs = {}; // path -> [cb]
    window.addEventListener("storage", (e) => { if (e.key === this.KEY) this._emitAll(); });
  }
  _read() { try { return JSON.parse(localStorage.getItem(this.KEY)) || {}; } catch { return {}; } }
  _write(db) { try { localStorage.setItem(this.KEY, JSON.stringify(db)); } catch (e) { toast("⚠️ Local storage full — media too large for demo mode."); } setTimeout(() => this._emitAll(), 0); }
  _at(db, path, create) {
    const parts = path.split("/").filter(Boolean);
    let node = db;
    for (let i = 0; i < parts.length - 1; i++) {
      if (node[parts[i]] == null) { if (!create) return [null, null]; node[parts[i]] = {}; }
      node = node[parts[i]];
    }
    return [node, parts[parts.length - 1]];
  }
  on(path, cb) { (this.subs[path] = this.subs[path] || []).push(cb); cb(this._get(path)); }
  _get(path) {
    const parts = path.split("/").filter(Boolean);
    let node = this._read();
    for (const p of parts) { if (node == null) return null; node = node[p]; }
    return node ?? null;
  }
  _emitAll() { for (const p in this.subs) for (const cb of this.subs[p]) cb(this._get(p)); }
  set(path, val) { const db = this._read(); const [node, key] = this._at(db, path, true); node[key] = val; this._write(db); }
  push(path, val) { const id = uid(); this.set(`${path}/${id}`, val); return id; }
  async get(path) { return this._get(path); }
  onConnection(cb) { cb(false); }
}

// ───────────────────────── state ─────────────────────────
let sync;
let myTeam = null; // team id or null (spectator)
const state = { scores: {}, drinks: {}, mediaMeta: {}, reactions: {}, comments: {} };
const DEVICE_ID = (() => {
  let d = localStorage.getItem("bslbend-device");
  if (!d) { d = uid(); localStorage.setItem("bslbend-device", d); }
  return d;
})();
const mediaCache = {}; // id -> data url
let currentTab = "score";

const ACK_KEY = "bslbend-acked";
const acked = new Set(JSON.parse(localStorage.getItem(ACK_KEY) || "[]"));
function ack(id) { acked.add(id); localStorage.setItem(ACK_KEY, JSON.stringify([...acked].slice(-400))); }

// ───────────────────────── boot ─────────────────────────
function boot() {
  if (window.FIREBASE_CONFIG && window.FIREBASE_CONFIG.apiKey) {
    sync = new FirebaseAdapter(window.FIREBASE_CONFIG);
  } else {
    sync = new LocalAdapter();
    $("demo-note").style.display = "block";
  }
  const dot = $("sync-dot");
  if (sync.live) {
    sync.onConnection((ok) => { dot.className = ok ? "live" : ""; $("sync-label").textContent = ok ? "LIVE" : "offline"; dot.id = "sync-dot"; });
    dot.classList.add("live"); $("sync-label").textContent = "LIVE";
  } else { dot.classList.add("demo"); $("sync-label").textContent = "DEMO"; }

  sync.on("scores", (v) => { state.scores = v || {}; onData(); });
  sync.on("drinks", (v) => { state.drinks = v || {}; onData(); });
  sync.on("mediaMeta", (v) => { state.mediaMeta = v || {}; onData(); });
  sync.on("reactions", (v) => { state.reactions = v || {}; onData(); });
  sync.on("comments", (v) => { state.comments = v || {}; onData(); });

  const sess = JSON.parse(localStorage.getItem("bslbend-session") || "null");
  if (sess) { myTeam = sess.team; showApp(); } else showLogin();
}

// ───────────────────────── login ─────────────────────────
let loginPick = null;
function showLogin() {
  $("app").style.display = "none";
  $("login-screen").style.display = "block";
  const grid = $("login-teams");
  grid.innerHTML = "";
  for (const tid of TEAM_ORDER) {
    const t = TEAMS[tid];
    const card = document.createElement("button");
    card.className = "team-card";
    card.style.setProperty("--team-color", t.color);
    card.innerHTML = `<span class="team-dot" style="background:${t.color};width:14px;height:14px;display:inline-block;border-radius:50%"></span>
      <div class="tname">${esc(t.name)}</div>
      <div class="roster">${t.players.map(esc).join("<br>")}</div>`;
    card.onclick = () => {
      loginPick = tid;
      [...grid.children].forEach((c) => c.classList.remove("selected"));
      card.classList.add("selected");
      $("login-err").textContent = "";
      $("login-pw").focus();
    };
    grid.appendChild(card);
  }
  $("login-btn").onclick = tryLogin;
  $("login-pw").onkeydown = (e) => { if (e.key === "Enter") tryLogin(); };
  $("spectate-btn").onclick = () => { myTeam = null; localStorage.setItem("bslbend-session", JSON.stringify({ team: null })); showApp(); switchTab("board"); };
}
function tryLogin() {
  if (!loginPick) { $("login-err").textContent = "Pick your team first."; return; }
  const pw = $("login-pw").value.trim().toLowerCase();
  if (pw !== TEAMS[loginPick].pw) { $("login-err").textContent = "Wrong password. Ask your captain. 🍺"; return; }
  myTeam = loginPick;
  localStorage.setItem("bslbend-session", JSON.stringify({ team: myTeam }));
  showApp();
}

function showApp() {
  $("login-screen").style.display = "none";
  $("app").style.display = "block";
  const chip = $("team-chip");
  if (myTeam) {
    const t = TEAMS[myTeam];
    chip.innerHTML = `<span class="team-dot" style="background:${t.color}"></span>${esc(t.name)}`;
  } else chip.innerHTML = `👀 Spectator`;
  chip.onclick = () => { if (confirm("Switch team / log out?")) { localStorage.removeItem("bslbend-session"); location.reload(); } };
  renderAll();
}

// ───────────────────────── tabs ─────────────────────────
document.addEventListener("click", (e) => {
  const btn = e.target.closest("nav.tabs button");
  if (btn) switchTab(btn.dataset.tab);
});
function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll("nav.tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  document.querySelectorAll(".tab-panel").forEach((p) => p.classList.toggle("active", p.id === `panel-${tab}`));
}

// ───────────────────────── data → render + events ─────────────────────────
function onData() {
  if ($("app").style.display !== "none") renderAll();
  checkNotifications();
}
function renderAll() {
  renderHoles();
  renderLeaderboard();
  renderReqs();
  renderMedia();
  renderFeed();
  renderRules();
}

function teamScores(tid) { return state.scores[tid] || {}; }

// ───────────────────────── scorecard ─────────────────────────
function renderHoles() {
  const list = $("hole-list");
  list.innerHTML = "";
  const mine = myTeam ? teamScores(myTeam) : {};
  for (const info of COURSE.holes) {
    const s = mine[info.h];
    const diff = s ? s.s - info.par : null;
    let cls = "hole-score";
    if (s) {
      cls += " entered";
      if (diff <= -2) cls += " s-eagle";
      else if (diff === -1) cls += " s-birdie";
      else if (diff >= 2) cls += " s-double";
    }
    const row = document.createElement("div");
    row.className = "hole-row";
    const used = s ? [s.drive && `D: ${firstName(s.drive)}`, s.second && `2nd: ${firstName(s.second)}`, s.putt && `Putt: ${firstName(s.putt)}`].filter(Boolean).join(" · ") : "";
    row.innerHTML = `
      <div class="hole-num">${info.h}</div>
      <div class="hole-info">
        <div><b>Par ${info.par}</b> <span class="hole-meta">· ${info.yds} yds · HCP ${info.hcp}</span> <span class="tee-badge ${info.tee === "R" ? "tee-r" : "tee-g"}">${TEE_LABEL[info.tee]}</span></div>
        ${used ? `<div class="hole-players">${esc(used)}</div>` : ""}
      </div>
      <div class="${cls}">${s ? s.s : "–"}</div>`;
    row.onclick = () => {
      if (!myTeam) { toast("Spectator mode — view only 👀"); return; }
      openScoreModal(info.h);
    };
    list.appendChild(row);
  }
}
function firstName(n) { return String(n).split(" ")[0]; }

// ───────────────────────── score modal ─────────────────────────
function openScoreModal(h) {
  const info = holeInfo(h);
  const team = TEAMS[myTeam];
  const existing = teamScores(myTeam)[h] || null;
  let strokes = existing ? existing.s : info.par;
  let drive = existing ? existing.drive : null;
  let second = existing ? existing.second : null;
  let putt = existing ? existing.putt || null : null;

  const counts = reqCounts(myTeam);
  const isPar3 = info.par === 3;

  const root = $("modal-root");
  root.innerHTML = `
    <div class="modal-back" id="mb">
      <div class="modal">
        <h3>Hole ${h} · Par ${info.par}</h3>
        <div class="sub">${info.yds} yds from the <b>${info.tee === "R" ? "Rust ▲" : "Gold ▼"}</b> tees · HCP ${info.hcp} · ${esc(team.name)}</div>
        <div class="stepper">
          <button id="minus">−</button>
          <div><div class="val" id="strokes">${strokes}</div><div class="lbl">team strokes</div></div>
          <button id="plus">+</button>
        </div>
        <div class="score-word" id="score-word"></div>
        ${isPar3 ? "" : `<div class="pick-label">Whose drive did you use?</div><div class="chips" id="chips-drive"></div>`}
        <div class="pick-label">Whose 2nd shot?${isPar3 ? " (par 3s count)" : ""}</div>
        <div class="chips" id="chips-second"></div>
        <div class="pick-label">Whose first putt? (only if ball was ON the green)</div>
        <div class="chips" id="chips-putt"></div>
        <div class="modal-actions">
          <button class="btn ghost" id="cancel">Cancel</button>
          <button class="btn" id="save">Save score</button>
        </div>
      </div>
    </div>`;

  const word = () => {
    const d = strokes - info.par;
    const el = $("score-word");
    el.textContent = scoreWord(d);
    el.style.color = d < 0 ? "var(--birdie)" : d >= 2 ? "var(--bogey)" : "var(--ink)";
  };
  word();
  $("minus").onclick = () => { if (strokes > 1) { strokes--; $("strokes").textContent = strokes; word(); } };
  $("plus").onclick = () => { if (strokes < 15) { strokes++; $("strokes").textContent = strokes; word(); } };

  const mkChips = (elId, kind, getVal, setVal, optional) => {
    const el = $(elId);
    if (!el) return;
    el.innerHTML = "";
    for (const p of team.players) {
      const c = document.createElement("button");
      c.className = "chip" + (getVal() === p ? " on" : "");
      const n = counts[p][kind];
      c.innerHTML = `${esc(firstName(p))}<span class="cnt">${n}</span>`;
      c.onclick = () => { setVal(getVal() === p ? null : p); mkChips(elId, kind, getVal, setVal, optional); };
      el.appendChild(c);
    }
    if (optional) {
      const c = document.createElement("button");
      c.className = "chip" + (getVal() === null ? " on" : "");
      c.textContent = "Off green / none";
      c.onclick = () => { setVal(null); mkChips(elId, kind, getVal, setVal, optional); };
      el.appendChild(c);
    }
  };
  mkChips("chips-drive", "drives", () => drive, (v) => (drive = v), false);
  mkChips("chips-second", "seconds", () => second, (v) => (second = v), false);
  mkChips("chips-putt", "putts", () => putt, (v) => (putt = v), true);

  $("cancel").onclick = closeModal;
  $("mb").onclick = (e) => { if (e.target.id === "mb") closeModal(); };
  $("save").onclick = () => {
    if (!isPar3 && !drive) return toast("Pick whose drive you used ⛳️");
    if (!second) return toast("Pick whose 2nd shot you used");
    const prev = teamScores(myTeam)[h] || null;
    const changed = !prev || prev.s !== strokes;
    const entry = { s: strokes, drive: drive || null, second, putt: putt || null, ts: changed ? Date.now() : prev.ts };
    suppressNotify = true;
    sync.set(`scores/${myTeam}/${h}`, entry);
    ack(`score-${myTeam}-${h}-${entry.ts}`); // don't re-banner yourself
    suppressNotify = false;
    closeModal();
    const diff = strokes - info.par;
    if (changed) {
      if (diff <= -2) { celebrate("eagle", h); promptMedia(h, "eagle"); }
      else if (diff === -1) { celebrate("birdie", h); promptMedia(h, "birdie"); }
      else if (diff >= 2) openDrinksModal(h, diff);
    }
  };
}
function closeModal() { $("modal-root").innerHTML = ""; }

function celebrate(kind, h) {
  if (kind === "eagle") banner("b-eagle", "🦅", `<b>EAGLE on ${h}!</b><br>EVERYONE shotguns / takes a shot. All 16. No exceptions.`);
  else banner("b-birdie", "🐦", `<b>BIRDIE on ${h}!</b><br>3 of 4 players finish your open drink — or take a shot. Then upload the proof. 📸`);
}

// ───────────────────────── drinks ─────────────────────────
function openDrinksModal(h, diff) {
  let target = null, count = 4;
  const root = $("modal-root");
  const others = TEAM_ORDER.filter((t) => t !== myTeam);
  root.innerHTML = `
    <div class="modal-back" id="mb">
      <div class="modal">
        <h3>💀 ${esc(scoreWord(diff).replace(" 🍺",""))} 🍺</h3>
        <div class="sub">House rules: you get to SEND drinks to another group. Choose your victims.</div>
        <div class="drink-teams" id="dt"></div>
        <div class="pick-label">How many drinks?</div>
        <div class="count-toggle" id="ct">
          <button class="chip" data-n="3">3 drinks</button>
          <button class="chip on" data-n="4">4 drinks</button>
        </div>
        <div class="modal-actions">
          <button class="btn ghost" id="cancel">Later</button>
          <button class="btn" id="send" disabled>Send drinks 🍻</button>
        </div>
      </div>
    </div>`;
  const dt = $("dt");
  for (const tid of others) {
    const t = TEAMS[tid];
    const b = document.createElement("button");
    b.className = "drink-team-btn";
    b.style.setProperty("--team-color", t.color);
    b.innerHTML = `<span class="team-dot" style="background:${t.color};width:12px;height:12px"></span>${esc(t.name)}`;
    b.onclick = () => { target = tid; [...dt.children].forEach((c) => c.classList.remove("on")); b.classList.add("on"); $("send").disabled = false; };
    dt.appendChild(b);
  }
  $("ct").onclick = (e) => {
    const c = e.target.closest(".chip");
    if (!c) return;
    count = +c.dataset.n;
    [...$("ct").children].forEach((x) => x.classList.toggle("on", x === c));
  };
  $("cancel").onclick = closeModal;
  $("mb").onclick = (e) => { if (e.target.id === "mb") closeModal(); };
  $("send").onclick = () => {
    suppressNotify = true;
    const id = sync.push("drinks", { from: myTeam, to: target, hole: h, count, ts: Date.now() });
    ack(`drink-${id}`);
    suppressNotify = false;
    closeModal();
    banner("b-drinks", "🍻", `<b>${count} drinks sent to ${esc(TEAMS[target].name)}.</b><br>They'll get the news. Enjoy your double bogey responsibly.`);
  };
}

// ───────────────────────── media ─────────────────────────
function promptMedia(h, event) {
  const root = $("modal-root");
  root.innerHTML = `
    <div class="modal-back" id="mb">
      <div class="modal" style="text-align:center">
        <h3>${event === "eagle" ? "🦅 Eagle" : "🐦 Birdie"} proof required</h3>
        <div class="sub">Hole ${h} — upload the celebration pic or video for the record.</div>
        <div class="modal-actions">
          <button class="btn" id="mp-photo">📸 Photo</button>
          <button class="btn" id="mp-video">🎥 Video</button>
        </div>
        <button class="btn ghost" style="margin-top:10px;width:100%" id="mp-skip">We'll owe one</button>
      </div>
    </div>`;
  const go = (which) => { closeModal(); pendingUpload = { hole: h, event }; $(which).click(); };
  $("mp-photo").onclick = () => go("file-photo");
  $("mp-video").onclick = () => go("file-video");
  $("mp-skip").onclick = closeModal;
  $("mb").onclick = (e) => { if (e.target.id === "mb") closeModal(); };
}

let pendingUpload = null;
$("upload-photo-btn")?.addEventListener("click", () => { pendingUpload = null; $("file-photo").click(); });
$("upload-video-btn")?.addEventListener("click", () => { pendingUpload = null; $("file-video").click(); });
$("file-photo")?.addEventListener("change", (e) => handleFile(e, "photo"));
$("file-video")?.addEventListener("change", (e) => handleFile(e, "video"));

async function handleFile(e, type) {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  if (!myTeam) return toast("Spectators can't upload 👀");
  const ctx = pendingUpload || { hole: null, event: "other" };
  pendingUpload = null;
  try {
    toast("Processing…");
    let data, thumb;
    if (type === "photo") {
      data = await compressImage(file, 1400, 0.72);
      thumb = await compressImage(file, 260, 0.6);
    } else {
      if (file.size > 12 * 1024 * 1024) return toast("⚠️ Video too big (12 MB max) — keep it under ~15 seconds and try again.");
      data = await readAsDataURL(file);
      thumb = await videoThumb(data).catch(() => null);
    }
    const id = uid();
    sync.set(`mediaData/${id}`, { data });
    sync.set(`mediaMeta/${id}`, {
      team: myTeam, hole: ctx.hole, type, event: ctx.event, thumb: thumb || null, ts: Date.now(), size: file.size,
    });
    mediaCache[id] = data;
    toast(type === "photo" ? "📸 Photo posted!" : "🎥 Video posted!");
    switchTab("media");
  } catch (err) {
    console.error(err);
    toast("Upload failed — try again.");
  }
}
function readAsDataURL(file) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
}
function compressImage(file, maxDim, q) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      res(c.toDataURL("image/jpeg", q));
    };
    img.onerror = rej;
    img.src = URL.createObjectURL(file);
  });
}
function videoThumb(dataUrl) {
  return new Promise((res, rej) => {
    const v = document.createElement("video");
    v.muted = true; v.playsInline = true; v.preload = "auto";
    v.onloadeddata = () => { v.currentTime = 0.1; };
    v.onseeked = () => {
      try {
        const c = document.createElement("canvas");
        const scale = Math.min(1, 260 / Math.max(v.videoWidth, v.videoHeight));
        c.width = Math.round(v.videoWidth * scale);
        c.height = Math.round(v.videoHeight * scale);
        c.getContext("2d").drawImage(v, 0, 0, c.width, c.height);
        res(c.toDataURL("image/jpeg", 0.6));
      } catch (e) { rej(e); }
    };
    v.onerror = rej;
    v.src = dataUrl;
  });
}

function renderMedia() {
  const grid = $("media-grid");
  const items = Object.entries(state.mediaMeta).sort((a, b) => b[1].ts - a[1].ts);
  $("media-empty").style.display = items.length ? "none" : "block";
  grid.innerHTML = "";
  for (const [id, m] of items) {
    const t = TEAMS[m.team];
    const tile = document.createElement("div");
    tile.className = "media-tile";
    tile.innerHTML = `
      ${m.thumb ? `<img src="${m.thumb}" alt="">` : `<div style="display:flex;align-items:center;justify-content:center;height:100%;font-size:34px">${m.type === "video" ? "🎥" : "📸"}</div>`}
      ${m.type === "video" ? `<span class="vid-badge">▶</span>` : ""}
      <span class="tag">${esc(t ? t.name : m.team)}${m.hole ? ` · H${m.hole}` : ""}${m.event === "eagle" ? " 🦅" : m.event === "birdie" ? " 🐦" : ""}</span>`;
    tile.onclick = () => openMediaView(id, m);
    grid.appendChild(tile);
  }
}
async function openMediaView(id, m) {
  const t = TEAMS[m.team];
  const root = $("modal-root");
  root.innerHTML = `
    <div class="modal-back" id="mb">
      <div class="modal media-view">
        <h3>${m.event === "eagle" ? "🦅" : m.event === "birdie" ? "🐦" : "📸"} ${esc(t ? t.name : m.team)}${m.hole ? ` · Hole ${m.hole}` : ""}</h3>
        <div class="sub">${timeAgo(m.ts)}</div>
        <div id="media-slot" style="text-align:center;padding:30px 0;color:var(--ink-soft)">Loading…</div>
        <div class="modal-actions"><button class="btn ghost" id="cancel">Close</button></div>
      </div>
    </div>`;
  $("cancel").onclick = closeModal;
  $("mb").onclick = (e) => { if (e.target.id === "mb") closeModal(); };
  let data = mediaCache[id];
  if (!data) {
    const rec = await sync.get(`mediaData/${id}`);
    data = rec && rec.data;
    if (data) mediaCache[id] = data;
  }
  const slot = $("media-slot");
  if (!slot) return;
  if (!data) { slot.textContent = "Couldn't load media."; return; }
  slot.style.padding = "0";
  slot.innerHTML = m.type === "video" ? `<video src="${data}" controls playsinline autoplay></video>` : `<img src="${data}" alt="">`;
}

// ───────────────────────── requirements ─────────────────────────
function reqCounts(tid) {
  const t = TEAMS[tid];
  const counts = {};
  for (const p of t.players) counts[p] = { drives: 0, seconds: 0, putts: 0 };
  const scores = teamScores(tid);
  for (const h in scores) {
    const s = scores[h];
    const par3 = holeInfo(+h).par === 3;
    if (s.drive && !par3 && counts[s.drive]) counts[s.drive].drives++;
    if (s.second && counts[s.second]) counts[s.second].seconds++;
    if (s.putt && counts[s.putt]) counts[s.putt].putts++;
  }
  return counts;
}
function renderReqs() {
  const el = $("req-list");
  el.innerHTML = "";
  const order = myTeam ? [myTeam, ...TEAM_ORDER.filter((t) => t !== myTeam)] : TEAM_ORDER;
  for (const tid of order) {
    const t = TEAMS[tid];
    const counts = reqCounts(tid);
    const entered = Object.keys(teamScores(tid)).length;
    const title = document.createElement("div");
    title.className = "req-team-title";
    title.innerHTML = `<span class="team-dot" style="background:${t.color};display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:6px"></span>${esc(t.name)} · thru ${entered}`;
    el.appendChild(title);
    for (const p of t.players) {
      const c = counts[p];
      const card = document.createElement("div");
      card.className = "req-card";
      const cell = (k, v, req) => `<div class="req-cell ${v >= req ? "ok" : "need"}"><div class="k">${k}</div><div class="v">${v}/${req}${v >= req ? " ✓" : ""}</div></div>`;
      card.innerHTML = `<div class="req-name">${esc(p)}</div>
        <div class="req-rows">
          ${cell("Drives", c.drives, RULES.drivesRequired)}
          ${cell("2nd shots", c.seconds, RULES.secondsRequired)}
          ${cell("1st putts", c.putts, RULES.puttsRequired)}
        </div>`;
      el.appendChild(card);
    }
    if (tid === myTeam) {
      const missing = t.players.filter((p) => {
        const c = counts[p];
        return c.drives < RULES.drivesRequired || c.seconds < RULES.secondsRequired || c.putts < RULES.puttsRequired;
      });
      if (missing.length && entered >= 12) {
        const note = document.createElement("div");
        note.className = "demo-note";
        note.innerHTML = `⏳ <b>${18 - entered} holes left</b> — still need reqs from: ${missing.map(firstName).map(esc).join(", ")}`;
        el.appendChild(note);
      }
    }
  }
}

// ───────────────────────── leaderboard ─────────────────────────
let lbExpanded = {};
function lbStats(tid) {
  const scores = teamScores(tid);
  let toPar = 0, total = 0, thru = 0;
  for (const h in scores) { const s = scores[h]; total += s.s; toPar += s.s - holeInfo(+h).par; thru++; }
  return { toPar, total, thru };
}
function renderLeaderboard() {
  const el = $("lb-list");
  el.innerHTML = "";
  const rows = TEAM_ORDER.map((tid) => ({ tid, ...lbStats(tid) }))
    .sort((a, b) => (a.thru === 0) - (b.thru === 0) || a.toPar - b.toPar || b.thru - a.thru);
  let pos = 0, lastKey = null;
  rows.forEach((r, i) => {
    const key = r.thru === 0 ? "np" : `${r.toPar}`;
    if (key !== lastKey) { pos = i + 1; lastKey = key; }
    const t = TEAMS[r.tid];
    const card = document.createElement("div");
    card.className = "lb-card";
    const toParCls = r.toPar < 0 ? "under" : r.toPar > 0 ? "over" : "";
    card.innerHTML = `
      <div class="lb-head">
        <div class="lb-bar" style="background:${t.color}"></div>
        <div class="lb-pos">${r.thru ? pos : "–"}</div>
        <div style="flex:1">
          <div class="lb-name">${esc(t.name)}</div>
          <div class="lb-thru">${r.thru ? `thru ${r.thru} · ${r.total} strokes` : "not started"}</div>
        </div>
        <div class="lb-topar ${toParCls}">${r.thru ? fmtPar(r.toPar) : ""}</div>
      </div>
      <div class="lb-grid" style="display:${lbExpanded[r.tid] ? "block" : "none"}">${holeGrid(r.tid)}</div>`;
    card.querySelector(".lb-head").onclick = () => { lbExpanded[r.tid] = !lbExpanded[r.tid]; renderLeaderboard(); };
    el.appendChild(card);
  });
}
function holeGrid(tid) {
  const scores = teamScores(tid);
  const half = (from) => {
    const hs = COURSE.holes.slice(from, from + 9);
    let head = "<tr><th>Hole</th>", par = "<tr><th>Par</th>", sc = "<tr><th>Score</th>";
    let sumS = 0, sumP = 0, all = true;
    for (const info of hs) {
      head += `<th>${info.h}</th>`;
      par += `<td>${info.par}</td>`;
      const s = scores[info.h];
      if (s) {
        const d = s.s - info.par;
        const cls = d <= -2 ? "c-eagle" : d === -1 ? "c-birdie" : d >= 2 ? "c-double" : d === 1 ? "c-bogey" : "";
        sc += `<td class="${cls}">${s.s}</td>`;
        sumS += s.s; sumP += info.par;
      } else { sc += "<td>·</td>"; all = false; }
    }
    const label = from === 0 ? "OUT" : "IN";
    head += `<th>${label}</th></tr>`;
    par += `<td><b>${hs.reduce((a, x) => a + x.par, 0)}</b></td></tr>`;
    sc += `<td><b>${sumP ? sumS : "·"}</b></td></tr>`;
    return `<table>${head}${par}${sc}</table>`;
  };
  return half(0) + "<div style='height:8px'></div>" + half(9);
}

// ───────────────────────── feed + rules ─────────────────────────
function renderRules() {
  $("rules-panel").innerHTML = `
    <div class="rules-box">
      <h4>🍺 Drinking Rules</h4>
      🦅 <b>Eagle</b> — EVERYONE shotguns / takes a shot (all 16)<br>
      🐦 <b>Birdie</b> — 3 of 4 players finish current open drink, or 3/4 shots · upload pic/video<br>
      💀 <b>Double bogey</b> — send 3–4 drinks to a group of your choice
    </div>
    <div class="rules-box">
      <h4>⛳️ Scramble Requirements</h4>
      • 2 drives from each player (par 3s don't count)<br>
      • 2 second shots from each player (par 3s DO count)<br>
      • 2 first putts from each player (ball must be ON the green)
    </div>`;
}
const FEED_EMOJIS = ["🍺", "🔥", "😂", "💀", "👏", "🎯"];
const feedOpen = new Set(); // fids with comment box expanded

function renderFeed() {
  const el = $("feed-list");
  // don't clobber a comment mid-typing
  if (el.contains(document.activeElement) && document.activeElement.tagName === "INPUT") return;
  const items = [];
  for (const tid in state.scores) {
    for (const h in state.scores[tid]) {
      const s = state.scores[tid][h];
      const d = s.s - holeInfo(+h).par;
      if (d === 0 || d === 1 || d === 3) continue; // keep the feed for notable stuff
      items.push({ fid: `s-${tid}-${h}`, ts: s.ts || 0, cls: d <= -2 ? "f-eagle" : d === -1 ? "f-birdie" : "", html: feedScoreMsg(tid, +h, s.s, d) });
    }
  }
  for (const id in state.drinks) {
    const dr = state.drinks[id];
    items.push({ fid: `d-${id}`, ts: dr.ts, cls: "f-drinks", html: `🍻 <b>${esc(TEAMS[dr.from]?.name)}</b> doubled hole ${dr.hole} and sent <b>${dr.count} drinks</b> to <b>${esc(TEAMS[dr.to]?.name)}</b>. Bottoms up.` });
  }
  for (const id in state.mediaMeta) {
    const m = state.mediaMeta[id];
    items.push({ fid: `m-${id}`, ts: m.ts, cls: "", html: `${m.type === "video" ? "🎥" : "📸"} <b>${esc(TEAMS[m.team]?.name)}</b> posted ${m.event !== "other" ? `${m.event} proof` : "media"}${m.hole ? ` from hole ${m.hole}` : ""}.` });
  }
  items.sort((a, b) => b.ts - a.ts);
  el.innerHTML = items.length ? "" : `<div class="media-empty">Nothing yet. Go make some noise. 🏌️</div>`;
  for (const it of items.slice(0, 60)) {
    const div = document.createElement("div");
    div.className = `feed-item ${it.cls}`;
    div.innerHTML = `${it.html}<div class="when">${timeAgo(it.ts)}</div>${reactBarHtml(it.fid)}${feedOpen.has(it.fid) ? commentBoxHtml(it.fid) : ""}`;
    el.appendChild(div);
  }
}

function reactBarHtml(fid) {
  const rx = state.reactions[fid] || {};
  const btns = FEED_EMOJIS.map((e) => {
    const votes = Object.values(rx[e] || {}).filter(Boolean).length;
    const mine = !!(rx[e] && rx[e][DEVICE_ID]);
    return `<button class="react-btn ${mine ? "on" : ""}" data-fid="${fid}" data-emoji="${e}">${e}${votes ? `<span>${votes}</span>` : ""}</button>`;
  }).join("");
  const cmts = Object.values(state.comments[fid] || {}).filter(Boolean).length;
  return `<div class="react-bar">${btns}<button class="react-btn cmt-toggle ${feedOpen.has(fid) ? "on" : ""}" data-cmt="${fid}">💬${cmts ? `<span>${cmts}</span>` : ""}</button></div>`;
}
function commentBoxHtml(fid) {
  const list = Object.entries(state.comments[fid] || {}).filter(([, c]) => c).sort((a, b) => a[1].ts - b[1].ts);
  const rows = list.map(([, c]) => `<div class="cmt-row"><b>${esc(c.name)}</b> ${esc(c.text)}<span class="cmt-when">${timeAgo(c.ts)}</span></div>`).join("");
  const name = localStorage.getItem("bslbend-name") || "";
  return `<div class="cmt-box">${rows}
    <div class="cmt-input">
      <input type="text" class="cmt-name" placeholder="Name" value="${esc(name)}" maxlength="20">
      <input type="text" class="cmt-text" placeholder="Talk your trash…" maxlength="200" data-fid="${fid}">
      <button class="btn small cmt-post" data-fid="${fid}">Post</button>
    </div></div>`;
}

// feed interactions (delegated — survives re-renders); no login required
document.addEventListener("click", (e) => {
  const rb = e.target.closest(".react-btn[data-emoji]");
  if (rb) {
    const { fid, emoji } = rb.dataset;
    const mine = !!(state.reactions[fid]?.[emoji]?.[DEVICE_ID]);
    sync.set(`reactions/${fid}/${emoji}/${DEVICE_ID}`, mine ? null : true);
    return;
  }
  const ct = e.target.closest(".react-btn[data-cmt]");
  if (ct) {
    const fid = ct.dataset.cmt;
    feedOpen.has(fid) ? feedOpen.delete(fid) : feedOpen.add(fid);
    renderFeed();
    return;
  }
  const post = e.target.closest(".cmt-post");
  if (post) postComment(post.dataset.fid, post.closest(".cmt-box"));
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.target.classList?.contains("cmt-text")) {
    postComment(e.target.dataset.fid, e.target.closest(".cmt-box"));
  }
});
function postComment(fid, box) {
  const name = box.querySelector(".cmt-name").value.trim();
  const text = box.querySelector(".cmt-text").value.trim();
  if (!name) { toast("Add your name first 👋"); box.querySelector(".cmt-name").focus(); return; }
  if (!text) return;
  localStorage.setItem("bslbend-name", name);
  box.querySelector(".cmt-text").value = "";
  box.querySelector(".cmt-text").blur();
  sync.push(`comments/${fid}`, { name, text, ts: Date.now() });
}
function feedScoreMsg(tid, h, s, d) {
  const name = esc(TEAMS[tid]?.name || tid);
  if (d <= -3) return `⁉️ <b>${name}</b> made a ${s} on the par ${holeInfo(h).par} ${h}th. ALBATROSS?! Everyone drinks everything.`;
  if (d === -2) return `🦅 <b>${name}</b> EAGLED hole ${h}! All 16 players: shotgun or shot. Now.`;
  if (d === -1) return `🐦 <b>${name}</b> birdied hole ${h}. 3 of 4 finish your drinks — proof required.`;
  if (d === 2) return `💀 <b>${name}</b> double-bogeyed hole ${h}. Incoming drinks for somebody…`;
  return `😬 <b>${name}</b> went +${d} on hole ${h}. Rough.`;
}

// ───────────────────────── notifications (cross-device banners) ─────────────────────────
const FRESH_MS = 20 * 60 * 1000;
let suppressNotify = false; // true while writing our own event, so the local echo doesn't double-banner
function checkNotifications() {
  if (suppressNotify) return;
  const now = Date.now();
  // eagles + birdies from the scores tree
  for (const tid in state.scores) {
    for (const h in state.scores[tid]) {
      const s = state.scores[tid][h];
      if (!s.ts || now - s.ts > FRESH_MS) continue;
      const d = s.s - holeInfo(+h).par;
      const key = `score-${tid}-${h}-${s.ts}`;
      if (acked.has(key)) continue;
      if (d <= -2) {
        ack(key);
        banner("b-eagle", "🦅", `<b>${esc(TEAMS[tid].name)} EAGLED hole ${h}!</b><br>EVERYONE shotguns / takes a shot. All 16. No exceptions.`);
      } else if (d === -1 && tid === myTeam) {
        ack(key);
        banner("b-birdie", "🐦", `<b>Your team birdied hole ${h}!</b><br>3 of 4 players finish your drink — or take a shot.`);
      } else if (Math.abs(d) >= 2 || d === -1) {
        ack(key); // other teams' birdies/doubles: feed only
      }
    }
  }
  // incoming drinks
  for (const id in state.drinks) {
    const dr = state.drinks[id];
    if (!dr.ts || now - dr.ts > FRESH_MS) continue;
    const key = `drink-${id}`;
    if (acked.has(key)) continue;
    ack(key);
    if (dr.to === myTeam) {
      banner("b-drinks", "🍺", `<b>INCOMING: ${esc(TEAMS[dr.from].name)} sent you ${dr.count} drinks!</b><br>They doubled hole ${dr.hole} and chose violence. Drink up.`);
    } else if (dr.from === myTeam) {
      banner("b-info", "🍻", `Your team sent ${dr.count} drinks to ${esc(TEAMS[dr.to].name)} (hole ${dr.hole}).`);
    }
  }
}

// ───────────────────────── banners / toast ─────────────────────────
function banner(cls, emoji, html) {
  const el = document.createElement("div");
  el.className = `banner ${cls}`;
  el.innerHTML = `<span class="big">${emoji}</span><span class="msg">${html}</span><button>OK</button>`;
  el.querySelector("button").onclick = () => el.remove();
  $("banners").appendChild(el);
  if (navigator.vibrate) navigator.vibrate([80, 40, 80]);
  setTimeout(() => el.remove(), 30000);
}
function toast(msg) {
  const el = document.createElement("div");
  el.className = "banner b-info";
  el.innerHTML = `<span class="msg">${esc(msg)}</span>`;
  $("banners").appendChild(el);
  setTimeout(() => el.remove(), 2600);
}

boot();
