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
// Both expose: on(path, cb) for live data, set(path, val), push(path, val) -> id, get(path) -> Promise,
// transact(path, fn) -> Promise<committed> (fn gets the current value; return undefined to abort), newKey()
class FirebaseAdapter {
  constructor(cfg, root = "") {
    firebase.initializeApp(cfg);
    this.db = firebase.database();
    this.live = true;
    this.root = root;
  }
  _ref(path) { return this.db.ref(this.root + path); }
  on(path, cb) { this._ref(path).on("value", (s) => cb(s.val())); }
  set(path, val) { return this._ref(path).set(val); }
  push(path, val) { const r = this._ref(path).push(); r.set(val); return r.key; }
  async get(path) { const s = await this._ref(path).get(); return s.val(); }
  async transact(path, fn) { const r = await this._ref(path).transaction(fn); return r.committed; }
  newKey() { return this.db.ref().push().key; }
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
  async transact(path, fn) { const next = fn(this._get(path)); if (next === undefined) return false; this.set(path, next); return true; }
  newKey() { return uid(); }
  onConnection(cb) { cb(false); }
}

// ───────────────────────── state ─────────────────────────
let sync;
let myTeam = null; // team id or null (spectator)
const state = { scores: {}, drinks: {}, mediaMeta: {}, reactions: {}, comments: {}, market: {} };
// ?sandbox=<name> points the whole app at an isolated practice copy of the database.
const SANDBOX = (location.search.match(/[?&]sandbox=([\w-]{1,40})/) || [])[1] || null;
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
    sync = new FirebaseAdapter(window.FIREBASE_CONFIG, SANDBOX ? `sandbox_${SANDBOX}/` : "");
  } else {
    sync = new LocalAdapter();
    $("demo-note").style.display = "block";
  }
  const dot = $("sync-dot");
  if (sync.live) {
    const liveLabel = SANDBOX ? "SANDBOX" : "LIVE";
    sync.onConnection((ok) => { dot.className = ok ? "live" : ""; $("sync-label").textContent = ok ? liveLabel : "offline"; dot.id = "sync-dot"; });
    dot.classList.add("live"); $("sync-label").textContent = liveLabel;
    if (SANDBOX) {
      $("demo-note").innerHTML = `🧪 <b>Sandbox “${esc(SANDBOX)}”</b> — a practice copy. Scores and bets here never touch the real event.`;
      $("demo-note").style.display = "block";
    }
  } else { dot.classList.add("demo"); $("sync-label").textContent = "DEMO"; }

  sync.on("scores", (v) => { state.scores = v || {}; onData(); });
  sync.on("drinks", (v) => { state.drinks = v || {}; onData(); });
  sync.on("mediaMeta", (v) => { state.mediaMeta = v || {}; onData(); });
  sync.on("reactions", (v) => { state.reactions = v || {}; onData(); });
  sync.on("comments", (v) => { state.comments = v || {}; onData(); });
  sync.on("market", (v) => { state.market = v || {}; onData(); });

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
  updateQuote();
  checkNotifications();
}
function renderAll() {
  renderHoles();
  renderLeaderboard();
  renderReqs();
  renderMarket();
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
      else if (diff === 1) cls += " s-bogey";
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
        <div class="pick-label">${isPar3 ? "Tee shot — count as whose DRIVE…" : "Whose drive did you use?"}</div>
        <div class="chips" id="chips-drive"></div>
        <div class="pick-label">${isPar3 ? "…OR as whose 2ND SHOT? (one or the other, not both)" : "Whose 2nd shot?"}</div>
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
  // Par 3: the tee shot satisfies EITHER a drive OR a 2nd-shot credit — never both.
  const setDrive = (v) => { drive = v; if (isPar3 && v) { second = null; mkChips("chips-second", "seconds", () => second, setSecond, false); } };
  const setSecond = (v) => { second = v; if (isPar3 && v) { drive = null; mkChips("chips-drive", "drives", () => drive, setDrive, false); } };
  mkChips("chips-drive", "drives", () => drive, setDrive, false);
  mkChips("chips-second", "seconds", () => second, setSecond, false);
  mkChips("chips-putt", "putts", () => putt, (v) => (putt = v), true);

  $("cancel").onclick = closeModal;
  $("mb").onclick = (e) => { if (e.target.id === "mb") closeModal(); };
  $("save").onclick = () => {
    if (isPar3) {
      if (!drive && !second) return toast("Pick who the tee shot counts for — drive OR 2nd shot ⛳️");
      if (drive && second) return toast("Par 3: the tee shot counts as a drive OR a 2nd shot, not both");
    } else {
      if (!drive) return toast("Pick whose drive you used ⛳️");
      if (!second) return toast("Pick whose 2nd shot you used");
    }
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
function closeModal() { $("modal-root").innerHTML = ""; tradeCtx = null; }

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
      if (file.size > 50 * 1024 * 1024) return toast("⚠️ Video too big (50 MB max) — trim it down and try again.");
      data = await readAsDataURL(file);
      thumb = await videoThumb(data).catch(() => null);
    }
    const id = uid();
    // Firebase RTDB caps a single write at 16 MB, so large media is split into
    // chunks written separately and stitched back together on playback.
    const CHUNK = 6 * 1024 * 1024;
    if (data.length > CHUNK) {
      const n = Math.ceil(data.length / CHUNK);
      for (let i = 0; i < n; i++) {
        toast(`Uploading… ${i + 1}/${n}`);
        await sync.set(`mediaData/${id}/c${String(i).padStart(3, "0")}`, data.slice(i * CHUNK, (i + 1) * CHUNK));
      }
      await sync.set(`mediaData/${id}/n`, n);
    } else {
      sync.set(`mediaData/${id}`, { data });
    }
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
    if (rec && rec.data) data = rec.data;
    else if (rec && rec.n) data = Array.from({ length: rec.n }, (_, i) => rec[`c${String(i).padStart(3, "0")}`] || "").join("");
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
    if (s.drive && counts[s.drive]) counts[s.drive].drives++; // par-3 tee shot may be credited here
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
  const wctx = marketContext(), wst = wctx.statuses.winner;
  const winOdds = (tid) => (wst.state === "resolved" ? "" : ` · 📈 ${fmtPct(wctx.prices.winner[TEAM_ORDER.indexOf(tid)])} to win`);
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
          <div class="lb-thru">${r.thru ? `thru ${r.thru} · ${r.total} strokes` : "not started"}${winOdds(r.tid)}</div>
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
  const mctx = marketContext();
  for (const t of mctx.trades) {
    if (Math.abs(t.c) < 50) continue; // small bets live in the Market tab only
    const mk = MKT_BY_ID[t.m];
    items.push({ fid: `t-${t.id}`, ts: t.ts, cls: "f-market", html: `📈 <b>${esc(bettorName(t.who))}</b> ${t.sh > 0 ? `put <b>${fmtB(t.c)}</b> on` : `cashed out <b>${fmtB(-t.c)}</b> of`} <b>${esc(outcomeName(mk, t.o))}</b> (${esc(mk.short)}) · odds ${fmtPct(t.pb)} → ${fmtPct(t.pa)}` });
  }
  for (const mk of MARKET.markets) {
    const st = mctx.statuses[mk.id];
    if (st.state === "resolved") items.push({ fid: `r-${mk.id}`, ts: st.ts || 0, cls: "f-market", html: `🏁 <b>${esc(mk.short)} market settled:</b> ${st.winners.map((o) => `<b>${esc(outcomeName(mk, o))}</b>`).join(" & ")}. Winning shares paid out.` });
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

// ───────────────────────── prediction market (play money) ─────────────────────────
// LMSR market maker: every share pays 🪙1 if its outcome wins, so prices are the crowd's
// implied odds (they always sum to 100%). Buying pushes a price up, selling pushes it down.
// Only the trade log is stored — prices, wallets and settlement are derived from trades +
// posted scores, so a corrected score re-settles everything automatically.
const MKT_BY_ID = Object.fromEntries(MARKET.markets.map((m) => [m.id, m]));
const COIN = MARKET.symbol;
const fmtB = (n) => `${COIN}${Math.round(n).toLocaleString()}`;
const signed = (n) => `${n >= 0 ? "+" : "−"}${fmtB(Math.abs(n))}`;
const fmtPct = (p) => (p < 0.005 ? "<1%" : p > 0.995 ? ">99%" : `${Math.round(p * 100)}%`);
const fmtCents = (p) => `${Math.min(99, Math.max(1, Math.round(p * 100)))}¢`;
const fmtSh = (n) => (n >= 100 ? Math.round(n).toLocaleString() : n.toFixed(1));

function lmsrPrices(q, b) {
  const x = q.map((v) => v / b), mx = Math.max(...x);
  const e = x.map((v) => Math.exp(v - mx)), z = e.reduce((s, v) => s + v, 0);
  return e.map((v) => v / z);
}
function lmsrCost(q, b) {
  const x = q.map((v) => v / b), mx = Math.max(...x);
  return b * (mx + Math.log(x.reduce((s, v) => s + Math.exp(v - mx), 0)));
}
// closed form of C(q + Δ·eᵢ) − C(q) = spend
const lmsrSharesFor = (q, b, i, spend) => b * Math.log1p(Math.expm1(spend / b) / lmsrPrices(q, b)[i]);
function lmsrProceeds(q, b, i, shares) { const q2 = q.slice(); q2[i] -= shares; return lmsrCost(q, b) - lmsrCost(q2, b); }
function lmsrAfter(q, b, i, dShares) { const q2 = q.slice(); q2[i] += dShares; return lmsrPrices(q2, b)[i]; }

const mktOutcomes = (mk) => (mk.type === "eagle" ? ["yes", "no"] : TEAM_ORDER);
const outcomeName = (mk, o) => (mk.type === "eagle" ? (o === "yes" ? "Yes" : "No") : TEAMS[o]?.name || o);
const outcomeShort = (mk, o) => outcomeName(mk, o).replace(/^Team /, "");
const outcomeColor = (mk, o) => (mk.type === "eagle" ? (o === "yes" ? "#15803d" : "#b91c1c") : TEAMS[o]?.color || "#999");
const winsPhrase = (mk, o) => (mk.type === "eagle" ? (o === "yes" ? "if anyone eagles" : "if nobody eagles") : `if ${outcomeShort(mk, o)} wins`);

const bettorId = (tid, name) => `${tid}|${name}`;
const bettorName = (id) => String(id).split("|")[1] || id;
const bettorTeam = (id) => String(id).split("|")[0];
const allBettors = () => TEAM_ORDER.flatMap((t) => TEAMS[t].players.map((p) => bettorId(t, p)));
let bettor = (() => { try { return JSON.parse(localStorage.getItem("bslbend-bettor") || "null"); } catch { return null; } })();
function myBettor() {
  return myTeam && bettor && bettor.team === myTeam && TEAMS[myTeam].players.includes(bettor.name) ? bettorId(myTeam, bettor.name) : null;
}

function tradeList(src) {
  return Object.entries(src?.trades || {}).map(([id, t]) => ({ id, ...t }))
    .filter((t) => MKT_BY_ID[t.m])
    .sort((a, b) => (a.ts || 0) - (b.ts || 0) || (a.id < b.id ? -1 : 1));
}
function marketQ(mk, trades) {
  const outs = mktOutcomes(mk), q = outs.map(() => 0);
  for (const t of trades) if (t.m === mk.id) { const i = outs.indexOf(t.o); if (i >= 0) q[i] += t.sh; }
  return q;
}

// ── settlement (derived from posted scores) ──
function rangeComplete(tid, [from, to]) { for (let h = from; h <= to; h++) if (!state.scores[tid]?.[h]) return false; return true; }
function rangeTotal(tid, from, to) { let t = 0; for (let h = from; h <= to; h++) t += state.scores[tid][h].s; return t; }
// Lowest total wins; ties go to matching cards (last 9, 6, 3, 1 holes of the range); still tied → split.
function countbackWinners([from, to]) {
  const len = to - from + 1;
  let alive = TEAM_ORDER.slice();
  for (const w of [...new Set([len, 9, 6, 3, 1])].filter((w) => w <= len)) {
    const tot = alive.map((t) => rangeTotal(t, to - w + 1, to));
    const best = Math.min(...tot);
    alive = alive.filter((_, i) => tot[i] === best);
    if (alive.length === 1) break;
  }
  return alive;
}
// open → locked (first team finished the range) → resolved (everyone finished, or an eagle for YES)
function marketStatus(mk) {
  const range = mk.holes;
  if (mk.type === "eagle") {
    let eagleTs = null;
    for (const tid of TEAM_ORDER) for (const h in state.scores[tid] || {}) {
      const s = state.scores[tid][h];
      if (holeInfo(+h) && s.s - holeInfo(+h).par <= -2) eagleTs = Math.min(eagleTs ?? Infinity, s.ts || 0);
    }
    if (eagleTs !== null) return { state: "resolved", winners: ["yes"], ts: eagleTs };
  }
  if (TEAM_ORDER.every((t) => rangeComplete(t, range))) {
    let ts = 0;
    for (const t of TEAM_ORDER) for (let h = range[0]; h <= range[1]; h++) ts = Math.max(ts, state.scores[t][h].ts || 0);
    return { state: "resolved", winners: mk.type === "eagle" ? ["no"] : countbackWinners(range), ts };
  }
  if (TEAM_ORDER.some((t) => rangeComplete(t, range))) return { state: "locked" };
  return { state: "open" };
}
const payoutPerShare = (st, o) => (st.state === "resolved" && st.winners.includes(o) ? 1 / st.winners.length : 0);

function marketContext(trades = tradeList(state.market)) {
  const statuses = {}, qs = {}, prices = {};
  for (const mk of MARKET.markets) {
    statuses[mk.id] = marketStatus(mk);
    qs[mk.id] = marketQ(mk, trades);
    prices[mk.id] = lmsrPrices(qs[mk.id], mk.b);
  }
  return { trades, statuses, qs, prices };
}
// cash = bankroll − spent + sold + settled winnings. Open positions are valued at what selling them
// right now would return (not shares × price, which would show a phantom gain right after buying);
// in a closed market, at shares × last price.
function walletOf(who, ctx) {
  let cash = MARKET.bankroll;
  const hold = {}, basis = {};
  for (const t of ctx.trades) {
    if (t.who !== who) continue;
    cash -= t.c;
    const k = `${t.m}|${t.o}`, h = hold[k] || 0;
    if (t.sh > 0) { hold[k] = h + t.sh; basis[k] = (basis[k] || 0) + t.c; }
    else { basis[k] = (basis[k] || 0) * (h > 0 ? Math.max(0, 1 + t.sh / h) : 0); hold[k] = h + t.sh; }
  }
  let value = 0;
  const positions = [];
  for (const k in hold) {
    if (hold[k] < 1e-4) continue;
    const [m, o] = k.split("|"), mk = MKT_BY_ID[m], st = ctx.statuses[m];
    const pos = { m, o, sh: hold[k], cost: basis[k] || 0 };
    if (st.state === "resolved") { pos.paid = pos.sh * payoutPerShare(st, o); cash += pos.paid; }
    else {
      const i = mktOutcomes(mk).indexOf(o);
      pos.price = ctx.prices[m][i];
      pos.value = st.state === "open" ? lmsrProceeds(ctx.qs[m], mk.b, i, pos.sh) : pos.sh * pos.price;
      value += pos.value;
    }
    positions.push(pos);
  }
  return { cash, value, net: cash + value, hold, positions };
}
function priceHistory(mk, trades) {
  const outs = mktOutcomes(mk), q = outs.map(() => 0);
  const hist = [lmsrPrices(q, mk.b)], meta = [null];
  for (const t of trades) {
    if (t.m !== mk.id) continue;
    const i = outs.indexOf(t.o);
    if (i < 0) continue;
    q[i] += t.sh;
    hist.push(lmsrPrices(q, mk.b));
    meta.push(t);
  }
  return { hist, meta };
}
function teamRangeLine(tid, [from, to]) {
  let toPar = 0, thru = 0;
  for (let h = from; h <= to; h++) { const s = state.scores[tid]?.[h]; if (s) { toPar += s.s - holeInfo(h).par; thru++; } }
  if (!thru) return "not started";
  return thru === to - from + 1 ? `${fmtPar(toPar)} · finished` : `${fmtPar(toPar)} thru ${thru}`;
}

// ── market tab ──
const chartStore = {}; // marketId → { mk, hist, meta, series, outs } for the scrub layer
let howOpen = false;
function renderMarket() {
  const el = $("market-list");
  if (!el) return;
  const ctx = marketContext(), me = myBettor();
  el.innerHTML = walletHtml(ctx, me) + MARKET.markets.map((mk) => marketCardHtml(mk, ctx, me)).join("")
    + standingsHtml(ctx, me) + activityHtml(ctx) + howItWorksHtml();
  el.querySelectorAll(".mk-plot").forEach(bindScrub);
}
function walletHtml(ctx, me) {
  if (!myTeam) return `<div class="demo-note">👀 You're spectating — odds update live. Log in with your team password to bet.</div>`;
  if (!me) {
    const t = TEAMS[myTeam];
    return `<div class="mk-wallet">
      <div class="mk-title">Who's betting on this phone?</div>
      <div class="mk-fine" style="margin:4px 0 10px">Everyone on ${esc(t.name)} gets ${fmtB(MARKET.bankroll)} ${esc(MARKET.currency)} (play money). Honor system — pick yourself.</div>
      <div class="chips">${t.players.map((p) => `<button class="chip" data-bettor="${esc(p)}">${esc(p)}</button>`).join("")}</div>
    </div>`;
  }
  const w = walletOf(me, ctx), pl = w.net - MARKET.bankroll;
  const rows = w.positions.map((p) => {
    const mk = MKT_BY_ID[p.m], name = `<b>${esc(outcomeName(mk, p.o))}</b> <span class="sm">· ${esc(mk.short)}</span>`;
    if (p.paid !== undefined) {
      return `<div class="mk-pos"><div class="grow">${name}<div class="sm">${fmtSh(p.sh)} shares · ${p.paid > 0 ? `won <b class="up">${fmtB(p.paid)}</b>` : "expired worthless"}</div></div></div>`;
    }
    const gain = p.value - p.cost, open = ctx.statuses[p.m].state === "open";
    return `<div class="mk-pos"><div class="grow">${name}<div class="sm">${fmtSh(p.sh)} sh @ ${fmtCents(p.cost / p.sh)} → pays <b>${fmtB(p.sh)}</b> ${esc(winsPhrase(mk, p.o))}</div>
      <div class="sm">${open ? "cash-out now" : "est. value"} ${fmtB(p.value)} <span class="${gain >= 0.5 ? "up" : gain <= -0.5 ? "down" : ""}">${Math.abs(gain) < 0.5 ? "±0" : signed(gain)}</span></div></div>
      ${open ? `<button class="mk-sell" data-trade="${p.m}|${p.o}|sell">Sell</button>` : `<span class="sm">🔒</span>`}</div>`;
  }).join("");
  return `<div class="mk-wallet">
    <div class="mk-wallet-top"><span>Betting as <b>${esc(bettorName(me))}</b></span><button class="mk-link" data-switch-bettor>not you?</button></div>
    <div class="mk-nums">
      <div><div class="k">Cash</div><div class="v">${fmtB(w.cash)}</div></div>
      <div><div class="k">In bets</div><div class="v">${fmtB(w.value)}</div></div>
      <div><div class="k">Net worth</div><div class="v">${fmtB(w.net)}</div><small class="${pl >= 0.5 ? "up" : pl <= -0.5 ? "down" : ""}">${Math.abs(pl) < 0.5 ? "even" : signed(pl)}</small></div>
    </div>
    ${rows ? `<div class="mk-positions">${rows}</div>` : `<div class="mk-fine">No bets yet — tap a price below to buy in.</div>`}
  </div>`;
}
function marketCardHtml(mk, ctx, me) {
  const st = ctx.statuses[mk.id], outs = mktOutcomes(mk), prices = ctx.prices[mk.id];
  const trades = ctx.trades.filter((t) => t.m === mk.id);
  const vol = trades.reduce((s, t) => s + Math.abs(t.c), 0), nBettors = new Set(trades.map((t) => t.who)).size;
  const pill = st.state === "open" ? `<span class="mk-pill live">● LIVE</span>`
    : st.state === "locked" ? `<span class="mk-pill locked">🔒 CLOSED</span>` : `<span class="mk-pill resolved">✓ SETTLED</span>`;
  const w = me ? walletOf(me, ctx) : null;
  const rows = outs.map((o, i) => {
    const held = w?.hold[`${mk.id}|${o}`] || 0;
    const sub = [mk.type === "team" ? teamRangeLine(o, mk.holes) : "", held > 1e-4 ? `you: ${fmtSh(held)} sh` : ""].filter(Boolean).join(" · ");
    let pct = fmtPct(prices[i]), right;
    if (st.state === "resolved") {
      const won = st.winners.includes(o);
      pct = won ? `${Math.round(100 / st.winners.length)}%` : "0%";
      right = `<div class="mk-won${won ? "" : " lost"}">${won ? (st.winners.length > 1 ? "🏆 SPLIT" : "🏆 WON") : "—"}</div>`;
    } else {
      const lbl = st.state === "open" ? `${mk.type === "eagle" ? outcomeName(mk, o) : "Buy"} ${fmtCents(prices[i])}` : "Closed";
      right = `<button class="mk-buy${mk.type === "eagle" && o === "no" ? " no" : ""}" data-trade="${mk.id}|${o}"${st.state === "open" ? "" : " disabled"}>${lbl}</button>`;
    }
    return `<div class="mk-row"><span class="mk-sw" style="background:${outcomeColor(mk, o)}"></span>
      <div class="mk-o"><div class="mk-oname">${esc(outcomeName(mk, o))}</div>${sub ? `<div class="mk-octx">${esc(sub)}</div>` : ""}</div>
      <div class="mk-pct">${pct}</div>${right}</div>`;
  }).join("");
  const per = st.state === "resolved" ? 1 / st.winners.length : 1;
  const note = st.state === "locked" ? `<div class="mk-fine"><b>Betting closed</b> — the first group finished. Settles when everyone's done.</div>`
    : st.state === "resolved" ? `<div class="mk-fine"><b>Settled: ${st.winners.map((o) => esc(outcomeName(mk, o))).join(" & ")}.</b> Winning shares paid ${per === 1 ? `${COIN}1` : `${COIN}${per.toFixed(2)}`} each.</div>` : "";
  return `<div class="mk-card">
    <div class="mk-title">${esc(mk.title)}</div>
    <div class="mk-meta">${pill}<span>${fmtB(vol)} traded</span><span>· ${nBettors} bettor${nBettors === 1 ? "" : "s"}</span></div>
    ${chartHtml(mk, ctx)}${rows}${note}
    <div class="mk-fine">${esc(mk.desc)}</div>
  </div>`;
}

// odds-over-time chart: one line per outcome (binary markets plot YES only), direct labels at the right
function chartHtml(mk, ctx) {
  const { hist, meta } = priceHistory(mk, ctx.trades), outs = mktOutcomes(mk);
  const series = mk.type === "eagle" ? [0] : outs.map((_, i) => i);
  chartStore[mk.id] = { mk, hist, meta, series, outs };
  const n = hist.length, W = 300, H = 100;
  const pts = (i) => (n === 1 ? [[0, hist[0][i]], [W, hist[0][i]]] : hist.map((v, k) => [(k / (n - 1)) * W, v[i]]))
    .map(([x, p]) => `${x.toFixed(1)},${(H - p * H).toFixed(1)}`).join(" ");
  const grid = [25, 50, 75].map((y) => `<line x1="0" x2="${W}" y1="${y}" y2="${y}"/>`).join("");
  const lines = series.map((i) => `<polyline points="${pts(i)}" stroke="${outcomeColor(mk, outs[i])}"/>`).join("");
  return `<div class="mk-chart">
      <div class="mk-plot" data-mid="${mk.id}">
        <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><g class="mk-grid">${grid}</g>${lines}</svg>
        <div class="mk-xhair"></div>
      </div>
      <div class="mk-labels" id="labs-${mk.id}">${labelsHtml(mk.id, n - 1)}</div>
    </div>
    <div class="mk-cap" id="cap-${mk.id}">${esc(captionFor(mk.id, n - 1))}</div>`;
}
function labelsHtml(mid, k) {
  const { mk, hist, series, outs } = chartStore[mid], v = hist[k];
  const ys = spreadLabels(series.map((i) => (1 - v[i]) * 100), 16);
  return series.map((i, j) => `<div class="mk-lab" style="top:${ys[j].toFixed(1)}%"><i style="background:${outcomeColor(mk, outs[i])}"></i>${esc(outcomeShort(mk, outs[i]))}<b>${fmtPct(v[i])}</b></div>`).join("");
}
// nudge direct labels apart so near-equal odds don't overprint
function spreadLabels(ys, gap) {
  const order = ys.map((_, i) => i).sort((a, b) => ys[a] - ys[b]), out = ys.slice();
  for (let k = 1; k < order.length; k++) out[order[k]] = Math.max(out[order[k]], out[order[k - 1]] + gap);
  const over = out[order[order.length - 1]] - 100;
  if (over > 0) for (const i of order) out[i] -= over;
  for (let k = order.length - 2; k >= 0; k--) out[order[k]] = Math.min(out[order[k]], out[order[k + 1]] - gap);
  return out;
}
function captionFor(mid, k) {
  const { mk, meta, hist } = chartStore[mid], t = meta[k];
  if (!t) return hist.length === 1 ? "No bets yet — odds start even. Be the first." : "Market opened at even odds";
  const verb = t.sh > 0 ? `bet ${fmtB(t.c)} on` : `cashed out ${fmtB(-t.c)} of`;
  return `${k === hist.length - 1 ? "Latest: " : ""}${firstName(bettorName(t.who))} ${verb} ${outcomeShort(mk, t.o)} · ${timeAgo(t.ts)}`;
}
// drag across the chart to see the odds after any bet
function bindScrub(plot) {
  const mid = plot.dataset.mid;
  const show = (k) => {
    const cd = chartStore[mid], last = cd.hist.length - 1, xh = plot.querySelector(".mk-xhair");
    xh.style.display = k === null ? "none" : "block";
    if (k !== null) xh.style.left = `${(k / last) * 100}%`;
    $(`labs-${mid}`).innerHTML = labelsHtml(mid, k ?? last);
    $(`cap-${mid}`).textContent = captionFor(mid, k ?? last);
  };
  const move = (e) => {
    const n = chartStore[mid]?.hist.length || 0;
    if (n < 2) return;
    const r = plot.getBoundingClientRect();
    show(Math.round(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * (n - 1)));
  };
  plot.addEventListener("pointermove", move);
  plot.addEventListener("pointerdown", move);
  plot.addEventListener("pointerleave", () => show(null));
  plot.addEventListener("pointercancel", () => show(null));
  plot.addEventListener("pointerup", (e) => { if (e.pointerType !== "mouse") show(null); });
}
function standingsHtml(ctx, me) {
  const rows = allBettors().map((w) => ({ w, ...walletOf(w, ctx) })).sort((a, b) => b.net - a.net);
  const active = new Set(ctx.trades.map((t) => t.who));
  return `<div class="mk-section-title">💰 Bettor standings</div><div class="mk-card mk-standings">${rows.map((r) => {
    const pl = r.net - MARKET.bankroll, rank = 1 + rows.filter((x) => Math.round(x.net) > Math.round(r.net)).length;
    return `<div class="mk-st-row${r.w === me ? " me" : ""}">
      <span class="mk-rank">${rank}</span><span class="mk-dot" style="background:${TEAMS[bettorTeam(r.w)].color}"></span>
      <span class="mk-st-name">${esc(bettorName(r.w))}${active.has(r.w) ? "" : ` <span class="sm">· no bets</span>`}</span>
      <span class="mk-st-net">${fmtB(r.net)}</span>
      <span class="mk-st-pl ${pl >= 0.5 ? "up" : pl <= -0.5 ? "down" : ""}">${Math.abs(pl) < 0.5 ? "—" : signed(pl)}</span>
    </div>`;
  }).join("")}</div>`;
}
function activityHtml(ctx) {
  const recent = ctx.trades.slice(-15).reverse();
  if (!recent.length) return "";
  return `<div class="mk-section-title">📈 Recent bets</div><div class="mk-card">${recent.map((t) => {
    const mk = MKT_BY_ID[t.m];
    return `<div class="mk-act"><span class="mk-dot" style="background:${TEAMS[bettorTeam(t.who)]?.color}"></span>
      <b>${esc(firstName(bettorName(t.who)))}</b> ${t.sh > 0 ? `bet <b>${fmtB(t.c)}</b> on` : `cashed out <b>${fmtB(-t.c)}</b> of`}
      <b>${esc(outcomeName(mk, t.o))}</b> · ${esc(mk.short)} <span class="mk-move">${fmtPct(t.pb)} → ${fmtPct(t.pa)}</span><span class="when">${timeAgo(t.ts)}</span></div>`;
  }).join("")}</div>`;
}
function howItWorksHtml() {
  return `<details class="mk-card mk-howto"${howOpen ? " open" : ""}><summary>How the betting works</summary>
    <p>Every share pays <b>${COIN}1</b> if its outcome wins and nothing if it loses — so a price is the crowd's odds. A team at 34¢ has a 34% chance according to everyone's money.</p>
    <p>Buying pushes that price up and selling pushes it down: the more people pile onto a team, the more it costs to join them. Cash out anytime before betting closes.</p>
    <p>Everyone starts with <b>${fmtB(MARKET.bankroll)}</b> ${esc(MARKET.currency)} — play money only. Markets settle automatically from the posted scores. Richest bettor at the end gets bragging rights.</p>
  </details>`;
}

// ── trade ticket ──
let tradeCtx = null, tradeBusy = false;
function openTrade(m, o, side = "buy") {
  const mk = MKT_BY_ID[m];
  if (!mk) return;
  if (!myBettor()) { switchTab("market"); toast(myTeam ? "Pick who's betting first 👆" : "Log in with your team to bet"); return; }
  tradeCtx = { m, o, side };
  $("modal-root").innerHTML = `
    <div class="modal-back" id="mb"><div class="modal">
      <h3>${esc(outcomeName(mk, o))}</h3>
      <div class="sub">${esc(mk.short)} · <span id="tq-now"></span></div>
      <div class="seg" id="tq-seg"><button data-side="buy">Buy</button><button data-side="sell">Sell</button></div>
      <div class="pick-label" id="tq-label"></div>
      <input id="tq-amt" class="mk-amt" type="number" inputmode="decimal" min="0" placeholder="0" autocomplete="off">
      <div class="chips" id="tq-chips"></div>
      <div class="mk-quote" id="tq-quote"></div>
      <div class="modal-actions"><button class="btn ghost" id="cancel">Cancel</button><button class="btn" id="tq-go">Place bet</button></div>
    </div></div>`;
  $("cancel").onclick = closeModal;
  $("mb").onclick = (e) => { if (e.target.id === "mb") closeModal(); };
  $("tq-seg").onclick = (e) => {
    const b = e.target.closest("button[data-side]");
    if (b && !b.disabled) { tradeCtx.side = b.dataset.side; $("tq-amt").value = ""; updateQuote(true); }
  };
  $("tq-amt").oninput = () => updateQuote();
  $("tq-chips").onclick = (e) => { const c = e.target.closest("[data-amt]"); if (c) { $("tq-amt").value = c.dataset.amt; updateQuote(); } };
  $("tq-go").onclick = placeTrade;
  updateQuote(true);
}
function ticketAmount(held) {
  const raw = parseFloat($("tq-amt").value) || 0;
  return tradeCtx.side === "sell" && Math.abs(raw - held) < 1e-3 ? held : raw;
}
// live quote — re-runs on every keystroke and whenever anyone else trades
function updateQuote(rebuildChips) {
  if (!tradeCtx || !$("tq-quote")) return;
  const me = myBettor();
  if (!me) return closeModal();
  const { m, o } = tradeCtx, mk = MKT_BY_ID[m], i = mktOutcomes(mk).indexOf(o);
  const ctx = marketContext(), st = ctx.statuses[m], q = ctx.qs[m], p = ctx.prices[m][i];
  const w = walletOf(me, ctx), held = w.hold[`${m}|${o}`] || 0;
  if (tradeCtx.side === "sell" && held < 1e-4) { tradeCtx.side = "buy"; rebuildChips = true; }
  const buy = tradeCtx.side === "buy";
  $("tq-now").textContent = `${fmtPct(p)} chance · pays ${COIN}1/share ${winsPhrase(mk, o)}`;
  for (const b of $("tq-seg").children) {
    b.classList.toggle("on", b.dataset.side === tradeCtx.side);
    if (b.dataset.side === "sell") b.disabled = held < 1e-4;
  }
  $("tq-label").textContent = buy ? `Bet amount · cash ${fmtB(w.cash)}` : `Shares to sell · you hold ${fmtSh(held)}`;
  if (rebuildChips) {
    const opts = buy
      ? [10, 25, 50, 100, 250].filter((v) => v <= w.cash).map((v) => [v, fmtB(v)]).concat(w.cash >= 1 ? [[Math.floor(w.cash), "Max"]] : [])
      : [[held * 0.25, "25%"], [held * 0.5, "50%"], [held, "All"]];
    $("tq-chips").innerHTML = opts.map(([v, l]) => `<button class="chip" data-amt="${+v.toFixed(4)}">${l}</button>`).join("");
  }
  const amt = ticketAmount(held);
  const row = (k, v, cls = "") => `<div class="qr ${cls}"><span>${k}</span><b>${v}</b></div>`;
  let html = "", label, ok = st.state === "open" && amt > 0;
  if (st.state !== "open") { html = row("Betting is closed on this market", ""); label = "Betting closed"; ok = false; }
  else if (buy) {
    const sh = amt > 0 ? lmsrSharesFor(q, mk.b, i, amt) : 0, pa = lmsrAfter(q, mk.b, i, sh);
    if (amt > w.cash + 1e-6) { ok = false; html += row("Not enough cash", fmtB(w.cash), "bad"); }
    html += row("Shares", amt > 0 ? fmtSh(sh) : "—") + row("Avg price", amt > 0 ? fmtCents(amt / sh) : "—")
      + row("Odds after your bet", amt > 0 ? `${fmtPct(p)} → ${fmtPct(pa)}` : fmtPct(p))
      + row(`Payout ${winsPhrase(mk, o)}`, amt > 0 ? `${fmtB(sh)} (${signed(sh - amt)})` : "—", "big");
    label = amt > 0 ? `Bet ${fmtB(amt)} on ${outcomeShort(mk, o)}` : "Enter an amount";
  } else {
    const n = Math.min(amt, held), got = n > 0 ? lmsrProceeds(q, mk.b, i, n) : 0, pa = lmsrAfter(q, mk.b, i, -n);
    const basis = (w.positions.find((x) => x.m === m && x.o === o)?.cost || 0) * (held > 0 ? n / held : 0);
    if (amt > held + 1e-6) { ok = false; html += row("You only hold", fmtSh(held), "bad"); }
    html += row("You receive", n > 0 ? fmtB(got) : "—", "big") + row("Profit on these shares", n > 0 ? signed(got - basis) : "—")
      + row("Odds after", n > 0 ? `${fmtPct(p)} → ${fmtPct(pa)}` : fmtPct(p));
    label = n > 0 ? `Sell ${fmtSh(n)} shares for ${fmtB(got)}` : "Enter shares to sell";
  }
  $("tq-quote").innerHTML = html;
  $("tq-go").textContent = tradeBusy ? "Placing…" : label;
  $("tq-go").disabled = !ok || tradeBusy;
}
// Runs as a database transaction so simultaneous bets are priced one after another and
// nobody can overspend; aborts if the odds moved >3% against you since the quote.
async function placeTrade() {
  if (!tradeCtx || tradeBusy) return;
  const who = myBettor();
  if (!who) return;
  const { m, o, side } = tradeCtx, mk = MKT_BY_ID[m], i = mktOutcomes(mk).indexOf(o);
  const ctx0 = marketContext(), held0 = walletOf(who, ctx0).hold[`${m}|${o}`] || 0;
  const amt = ticketAmount(held0);
  if (amt <= 0) return;
  const quoted = side === "buy" ? lmsrSharesFor(ctx0.qs[m], mk.b, i, amt) : lmsrProceeds(ctx0.qs[m], mk.b, i, Math.min(amt, held0));
  const key = sync.newKey();
  ack(`trade-${key}`); // no "someone bet" toast for our own trade
  let fail = null, fill = null;
  tradeBusy = true;
  updateQuote();
  const committed = await sync.transact("market", (cur) => {
    fail = null; fill = null;
    const c = marketContext(tradeList(cur));
    if (c.statuses[m].state !== "open") { fail = "Betting on this market just closed."; return; }
    const q = c.qs[m], w = walletOf(who, c), pb = lmsrPrices(q, mk.b)[i];
    let sh, cost;
    if (side === "buy") {
      if (amt > w.cash + 1e-6) { fail = `Not enough ${MARKET.currency} — you have ${fmtB(w.cash)}.`; return; }
      sh = lmsrSharesFor(q, mk.b, i, amt);
      cost = amt;
      if (sh < quoted * 0.97) { fail = "The odds moved while you were deciding — check the new price."; return; }
    } else {
      const held = w.hold[`${m}|${o}`] || 0, n = Math.abs(amt - held) < 1e-3 ? held : amt;
      if (n > held + 1e-6) { fail = "You don't hold that many shares anymore."; return; }
      const got = lmsrProceeds(q, mk.b, i, n);
      if (got < quoted * 0.97) { fail = "The odds moved while you were deciding — check the new price."; return; }
      sh = -n;
      cost = -got;
    }
    fill = { sh, cost, pa: lmsrAfter(q, mk.b, i, sh) };
    const trade = { m, o, who, sh: +sh.toFixed(6), c: +cost.toFixed(6), pb: +pb.toFixed(4), pa: +fill.pa.toFixed(4), ts: Date.now() };
    return { ...(cur || {}), trades: { ...(cur?.trades || {}), [key]: trade } };
  }).catch((e) => { console.error(e); fail = "Couldn't reach the market — check your signal and try again."; return false; });
  tradeBusy = false;
  if (committed && fill) {
    closeModal();
    toast(fill.sh > 0
      ? `✅ ${fmtSh(fill.sh)} shares of ${outcomeShort(mk, o)} @ ${fmtCents(fill.cost / fill.sh)} · odds now ${fmtPct(fill.pa)}`
      : `✅ Sold ${fmtSh(-fill.sh)} shares for ${fmtB(-fill.cost)} · odds now ${fmtPct(fill.pa)}`);
  } else {
    if (fail) toast(fail);
    updateQuote(true);
  }
}
document.addEventListener("click", (e) => {
  const tr = e.target.closest("[data-trade]");
  if (tr) { const [m, o, side] = tr.dataset.trade.split("|"); openTrade(m, o, side || "buy"); return; }
  const pick = e.target.closest("[data-bettor]");
  if (pick && myTeam) {
    bettor = { team: myTeam, name: pick.dataset.bettor };
    localStorage.setItem("bslbend-bettor", JSON.stringify(bettor));
    toast(`Betting as ${pick.dataset.bettor} · ${fmtB(MARKET.bankroll)} to play with 🍀`);
    renderMarket();
    return;
  }
  if (e.target.closest("[data-switch-bettor]")) { bettor = null; localStorage.removeItem("bslbend-bettor"); renderMarket(); return; }
  if (e.target.closest(".mk-howto summary")) howOpen = !howOpen;
});

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
  const mctx = marketContext(), me = myBettor();
  let bigBet = null;
  for (const t of mctx.trades) {
    if (!t.ts || now - t.ts > 3 * 60 * 1000 || acked.has(`trade-${t.id}`)) continue;
    ack(`trade-${t.id}`);
    if (t.who !== me && Math.abs(t.c) >= 100) bigBet = t; // only the newest, so opening the app mid-round isn't a toast storm
  }
  if (bigBet) {
    const mk = MKT_BY_ID[bigBet.m];
    toast(`📈 ${firstName(bettorName(bigBet.who))} ${bigBet.sh > 0 ? `put ${fmtB(bigBet.c)} on` : "cashed out of"} ${outcomeShort(mk, bigBet.o)} (${mk.short}) · now ${fmtPct(bigBet.pa)}`);
  }
  if (me) {
    for (const mk of MARKET.markets) {
      const st = mctx.statuses[mk.id];
      if (st.state !== "resolved" || !st.ts || now - st.ts > FRESH_MS) continue;
      const key = `settle-${mk.id}-${st.winners.join(",")}-${me}`;
      if (acked.has(key)) continue;
      ack(key);
      const mine = walletOf(me, mctx).positions.filter((p) => p.m === mk.id);
      if (!mine.length) continue;
      const won = mine.reduce((s, p) => s + (p.paid || 0), 0);
      banner("b-info", won > 0 ? "💰" : "💸", `<b>${esc(mk.short)} settled: ${st.winners.map((o) => esc(outcomeName(mk, o))).join(" & ")}</b><br>${won > 0 ? `You collected ${fmtB(won)}.` : "Your shares expired worthless. Better luck next market."}`);
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
