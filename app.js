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
  updateBetQuote();
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
    maybePromptContest(h);
  };
}
function closeModal() { $("modal-root").innerHTML = ""; betCtx = null; }

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
  const wctx = marketContext(), wst = wctx.statuses.winner, wpot = wctx.pots.winner;
  const winOdds = (tid) => (wst.state === "resolved" || !wpot.total ? "" : ` · 📈 ${fmtPct(shareOf(wpot, tid))} of the pot`);
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
  for (const b of mctx.bets) {
    if (b.amt < 3) continue; // small bets live in the Market tab only
    const mk = MKT_BY_ID[b.m];
    items.push({ fid: `t-${b.id}`, ts: b.ts, cls: "f-market", html: `📈 <b>${esc(bettorName(b.who))}</b> put <b>${fmtB(b.amt * 100)}</b> on <b>${esc(outcomeName(mk, b.o))}</b> (${esc(mk.short)}) · ${fmtPct(b.pb)} → ${fmtPct(b.pa)} of the pot` });
  }
  for (const mk of MARKET.markets) {
    const st = mctx.statuses[mk.id], pot = mctx.pots[mk.id];
    if (st.state !== "resolved" || !pot.total) continue;
    const what = mctx.refund[mk.id] ? "nobody backed the winner, so every bet was refunded"
      : `${st.winners.map((o) => `<b>${esc(outcomeName(mk, o))}</b>`).join(" & ")} backers split the ${fmtB(pot.total)} pot`;
    items.push({ fid: `r-${mk.id}`, ts: st.ts || 0, cls: "f-market", html: `🏁 <b>${esc(mk.short)} pool settled:</b> ${what}.` });
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

// ───────────────────────── side-bet pools (play money, zero-sum) ─────────────────────────
// Pari-mutuel: each market's bets form one pot, split at settlement among whoever backed the
// winner in proportion to their stakes. There's no house, so every Bend Buck won is one someone
// else lost. Only bets and contest results are stored; odds, wallets and payouts are derived from
// them plus the posted scores, so a corrected score or result re-settles on its own. Money is
// handled in integer cents so every pot splits back out exactly.
const MKT_BY_ID = Object.fromEntries(MARKET.markets.map((m) => [m.id, m]));
const COIN = MARKET.symbol;
const BANKROLL_C = MARKET.bankroll * 100;
const fmtB = (c) => `${COIN}${c % 100 === 0 ? c / 100 : (c / 100).toFixed(2)}`;
const signed = (c) => (c === 0 ? "±0" : `${c > 0 ? "+" : "−"}${fmtB(Math.abs(c))}`);
const fmtPct = (p) => (p <= 0 ? "0%" : p < 0.005 ? "<1%" : p < 1 && p > 0.995 ? ">99%" : `${Math.round(p * 100)}%`);
const fmtX = (x) => `${x >= 10 ? Math.round(x) : x.toFixed(1)}x`;

const bettorId = (tid, name) => `${tid}|${name}`;
const bettorName = (id) => String(id).split("|")[1] || id;
const bettorTeam = (id) => String(id).split("|")[0];
const allBettors = () => TEAM_ORDER.flatMap((t) => TEAMS[t].players.map((p) => bettorId(t, p)));
const mktOutcomes = (mk) => (mk.type === "team" ? TEAM_ORDER : mk.type === "yesno" ? ["yes", "no"] : allBettors());
const outcomeName = (mk, o) => (mk.type === "team" ? TEAMS[o]?.name || o : mk.type === "yesno" ? (o === "yes" ? "Yes" : "No") : bettorName(o));
const outcomeShort = (mk, o) => (mk.type === "team" ? outcomeName(mk, o).replace(/^Team /, "") : mk.type === "contest" ? firstName(bettorName(o)) : outcomeName(mk, o));
const outcomeColor = (mk, o) => (mk.type === "team" ? TEAMS[o]?.color : mk.type === "yesno" ? (o === "yes" ? "#15803d" : "#b91c1c") : TEAMS[bettorTeam(o)]?.color) || "#999";
const winsPhrase = (mk, o) => (mk.type === "yesno" ? (o === "yes" ? "if anyone eagles" : "if nobody eagles") : `if ${outcomeShort(mk, o)} wins`);

let bettor = (() => { try { return JSON.parse(localStorage.getItem("bslbend-bettor") || "null"); } catch { return null; } })();
function myBettor() {
  return myTeam && bettor && bettor.team === myTeam && TEAMS[myTeam].players.includes(bettor.name) ? bettorId(myTeam, bettor.name) : null;
}

function betList(src = state.market?.bets) {
  return Object.entries(src || {}).map(([id, b]) => ({ id, ...b }))
    .filter((b) => MKT_BY_ID[b.m] && Number.isInteger(b.amt) && b.amt > 0)
    .sort((a, b) => (a.ts || 0) - (b.ts || 0) || (a.id < b.id ? -1 : 1));
}
function potOf(mk, bets) {
  const by = {};
  let total = 0;
  for (const b of bets) if (b.m === mk.id) { by[b.o] = (by[b.o] || 0) + b.amt * 100; total += b.amt * 100; }
  return { by, total };
}
const shareOf = (pot, o) => (pot.total ? (pot.by[o] || 0) / pot.total : 0);
const contestHole = (mk) => +state.market?.config?.[mk.id]?.hole || mk.hole;
const contestEntries = (mk) => state.market?.results?.[mk.id] || {};

// ── settlement (derived from posted scores + recorded contest results) ──
function rangeComplete(tid, [from, to]) { for (let h = from; h <= to; h++) if (!state.scores[tid]?.[h]) return false; return true; }
function rangeTotal(tid, from, to) { let t = 0; for (let h = from; h <= to; h++) t += state.scores[tid][h].s; return t; }
// Lowest total wins; ties go to matching cards (last 9, 6, 3, 1 holes); still tied → split.
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
const holesPlayed = (tid) => Object.keys(state.scores[tid] || {}).length;
const roundOver = () => TEAM_ORDER.every((t) => rangeComplete(t, [1, 18]));
function lastScoreTs() { let ts = 0; for (const t in state.scores) for (const h in state.scores[t]) ts = Math.max(ts, state.scores[t][h].ts || 0); return ts; }
// open → locked → resolved { winners, ts }; an empty winners list means no valid result (refund)
function marketStatus(mk) {
  if (mk.type === "contest") {
    const res = contestEntries(mk), h = contestHole(mk);
    if (TEAM_ORDER.every((t) => res[t]) || roundOver()) {
      const valid = TEAM_ORDER.filter((t) => res[t] && !res[t].none && res[t].player && res[t].value > 0);
      const best = valid.length ? (mk.best === "max" ? Math.max : Math.min)(...valid.map((t) => res[t].value)) : null;
      const ts = Math.max(0, ...TEAM_ORDER.map((t) => res[t]?.ts || 0), roundOver() ? lastScoreTs() : 0);
      return { state: "resolved", winners: valid.filter((t) => res[t].value === best).map((t) => bettorId(t, res[t].player)), ts };
    }
    const reached = Object.keys(res).length > 0 || TEAM_ORDER.some((t) => state.scores[t]?.[h] || holesPlayed(t) >= Math.max(1, h - 1));
    return { state: reached ? "locked" : "open" };
  }
  if (mk.type === "yesno") {
    let eagleTs = null;
    for (const tid of TEAM_ORDER) for (const h in state.scores[tid] || {}) {
      const s = state.scores[tid][h];
      if (holeInfo(+h) && s.s - holeInfo(+h).par <= -2) eagleTs = Math.min(eagleTs ?? Infinity, s.ts || 0);
    }
    if (eagleTs !== null) return { state: "resolved", winners: ["yes"], ts: eagleTs };
    if (roundOver()) return { state: "resolved", winners: ["no"], ts: lastScoreTs() };
  } else if (roundOver()) {
    return { state: "resolved", winners: countbackWinners([1, 18]), ts: lastScoreTs() };
  }
  return TEAM_ORDER.some((t) => holesPlayed(t) >= mk.closesAfterHoles) ? { state: "locked" } : { state: "open" };
}
// integer split proportional to weights; leftover cents go to the largest remainders (stable order)
function splitCents(total, weights) {
  const sum = weights.reduce((s, w) => s + w, 0);
  const raw = weights.map((w) => (total * w) / sum), base = raw.map(Math.floor);
  let left = total - base.reduce((s, v) => s + v, 0);
  const order = raw.map((r, i) => [r - base[i], i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (let k = 0; left > 0; k++, left--) base[order[k % order.length][1]]++;
  return base;
}
// Pot → backers of the winner pro rata. Dead heat: split equally across the tied outcomes that
// were backed. Nobody backed the winner (or no valid result): everyone gets their stake back.
function marketPayouts(mk, bets, st) {
  const out = {};
  if (st.state !== "resolved") return out;
  const mine = bets.filter((b) => b.m === mk.id);
  const add = (w, c) => { out[w] = (out[w] || 0) + c; };
  const backed = st.winners.filter((o) => mine.some((b) => b.o === o));
  if (!backed.length) { for (const b of mine) add(b.who, b.amt * 100); return out; }
  const pot = mine.reduce((s, b) => s + b.amt * 100, 0);
  splitCents(pot, backed.map(() => 1)).forEach((share, k) => {
    const stakes = {};
    for (const b of mine) if (b.o === backed[k]) stakes[b.who] = (stakes[b.who] || 0) + b.amt;
    const whos = Object.keys(stakes).sort();
    splitCents(share, whos.map((w) => stakes[w])).forEach((c, j) => add(whos[j], c));
  });
  return out;
}
function marketContext(bets = betList()) {
  const statuses = {}, pots = {}, payouts = {}, refund = {};
  for (const mk of MARKET.markets) {
    const st = (statuses[mk.id] = marketStatus(mk)), pot = (pots[mk.id] = potOf(mk, bets));
    payouts[mk.id] = marketPayouts(mk, bets, st);
    refund[mk.id] = st.state === "resolved" && pot.total > 0 && !st.winners.some((o) => pot.by[o]);
  }
  return { bets, statuses, pots, payouts, refund };
}
// cash = bankroll − stakes + settled payouts; stakes in unsettled pools are "in play"
function walletOf(who, ctx) {
  let cash = BANKROLL_C, inPlay = 0;
  const pos = new Map();
  for (const b of ctx.bets) {
    if (b.who !== who) continue;
    cash -= b.amt * 100;
    const k = `${b.m}::${b.o}`;
    if (!pos.has(k)) pos.set(k, { m: b.m, o: b.o, stake: 0 });
    pos.get(k).stake += b.amt * 100;
  }
  const positions = [...pos.values()], settled = [];
  for (const mk of MARKET.markets) {
    const stake = positions.filter((p) => p.m === mk.id).reduce((s, p) => s + p.stake, 0);
    if (!stake) continue;
    if (ctx.statuses[mk.id].state === "resolved") {
      const got = ctx.payouts[mk.id][who] || 0;
      cash += got;
      settled.push({ m: mk.id, stake, got });
    } else inPlay += stake;
  }
  for (const p of positions) {
    const pot = ctx.pots[p.m];
    p.open = ctx.statuses[p.m].state !== "resolved";
    p.projected = pot.by[p.o] ? Math.floor((pot.total * p.stake) / pot.by[p.o]) : 0;
  }
  return { cash, inPlay, net: cash + inPlay, positions, settled };
}
function oddsHistory(mk, bets) {
  const outs = mktOutcomes(mk), by = {};
  let total = 0;
  const hist = [outs.map(() => 1 / outs.length)], meta = [null];
  for (const b of bets) {
    if (b.m !== mk.id) continue;
    by[b.o] = (by[b.o] || 0) + b.amt;
    total += b.amt;
    hist.push(outs.map((o) => (by[o] || 0) / total));
    meta.push(b);
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
  if (!myTeam) return `<div class="demo-note">👀 You're spectating — pools update live. Log in with your team password to bet.</div>`;
  if (!me) {
    const t = TEAMS[myTeam];
    return `<div class="mk-wallet">
      <div class="mk-title">Who's betting on this phone?</div>
      <div class="mk-fine" style="margin:4px 0 10px">Everyone on ${esc(t.name)} gets ${fmtB(BANKROLL_C)} ${esc(MARKET.currency)}. Honor system — pick yourself.</div>
      <div class="chips">${t.players.map((p) => `<button class="chip" data-bettor="${esc(p)}">${esc(p)}</button>`).join("")}</div>
    </div>`;
  }
  const w = walletOf(me, ctx), pl = w.net - BANKROLL_C;
  const open = w.positions.filter((p) => p.open).map((p) => {
    const mk = MKT_BY_ID[p.m];
    return `<div class="mk-pos"><div class="grow"><b>${esc(outcomeName(mk, p.o))}</b> <span class="sm">· ${esc(mk.short)}</span>
      <div class="sm">${fmtB(p.stake)} bet · pays ~<b>${fmtB(p.projected)}</b> ${esc(winsPhrase(mk, p.o))} at today's pot</div></div></div>`;
  }).join("");
  const done = w.settled.map((s) => {
    const mk = MKT_BY_ID[s.m], net = s.got - s.stake;
    return `<div class="mk-pos"><div class="grow"><b>${esc(mk.short)}</b> <span class="sm">· settled</span>
      <div class="sm">${fmtB(s.stake)} bet → ${ctx.refund[s.m] ? "refunded" : s.got ? `won <b class="up">${fmtB(s.got)}</b>` : "lost"} <span class="${net > 0 ? "up" : net < 0 ? "down" : ""}">${signed(net)}</span></div></div></div>`;
  }).join("");
  return `<div class="mk-wallet">
    <div class="mk-wallet-top"><span>Betting as <b>${esc(bettorName(me))}</b></span><button class="mk-link" data-switch-bettor>not you?</button></div>
    <div class="mk-nums">
      <div><div class="k">Cash</div><div class="v">${fmtB(w.cash)}</div></div>
      <div><div class="k">In play</div><div class="v">${fmtB(w.inPlay)}</div></div>
      <div><div class="k">Net</div><div class="v">${fmtB(w.net)}</div><small class="${pl > 0 ? "up" : pl < 0 ? "down" : ""}">${pl === 0 ? "even" : signed(pl)}</small></div>
    </div>
    ${open || done ? `<div class="mk-positions">${open}${done}</div>` : `<div class="mk-fine">No bets yet — pick a market below.</div>`}
  </div>`;
}
function marketCardHtml(mk, ctx, me) {
  const st = ctx.statuses[mk.id], pot = ctx.pots[mk.id];
  const nBettors = new Set(ctx.bets.filter((b) => b.m === mk.id).map((b) => b.who)).size;
  const pill = st.state === "open" ? `<span class="mk-pill live">● OPEN</span>`
    : st.state === "locked" ? `<span class="mk-pill locked">🔒 CLOSED</span>` : `<span class="mk-pill resolved">✓ SETTLED</span>`;
  const hole = mk.type !== "contest" ? "" : `<span>· hole ${contestHole(mk)}</span>${myTeam === MARKET.organizer && st.state === "open" ? `<button class="mk-link" data-hole="${mk.id}">change</button>` : ""}`;
  return `<div class="mk-card">
    <div class="mk-title">${mk.icon} ${esc(mk.title)}</div>
    <div class="mk-meta">${pill}<span>${fmtB(pot.total)} pot</span><span>· ${nBettors} bettor${nBettors === 1 ? "" : "s"}</span>${hole}</div>
    ${mk.type === "contest" ? contestBodyHtml(mk, ctx, me) : chartHtml(mk, ctx) + mktOutcomes(mk).map((o) => rowHtml(mk, o, ctx, me, mk.type === "team" ? teamRangeLine(o, [1, 18]) : "")).join("")}
    ${settleNoteHtml(mk, ctx)}
    <div class="mk-fine">${esc(mk.desc)}</div>
  </div>`;
}
function rowHtml(mk, o, ctx, me, extra) {
  const st = ctx.statuses[mk.id], pot = ctx.pots[mk.id], on = pot.by[o] || 0;
  const mine = me ? walletOf(me, ctx).positions.find((p) => p.m === mk.id && p.o === o)?.stake || 0 : 0;
  let money = on ? `${fmtB(on)} bet · pays ${fmtX(pot.total / on)}` : "no bets yet";
  if (st.state === "resolved" && on) {
    const backedWinners = st.winners.filter((x) => pot.by[x]).length; // a dead heat splits the pot across them
    money = ctx.refund[mk.id] ? `${fmtB(on)} bet · refunded`
      : st.winners.includes(o) ? `${fmtB(on)} bet · paid ${fmtX(pot.total / backedWinners / on)}` : `${fmtB(on)} bet · lost`;
  }
  const sub = [extra, money, mine ? `you: ${fmtB(mine)}` : ""].filter(Boolean).join(" · ");
  let right;
  if (st.state === "resolved") {
    const won = st.winners.includes(o);
    right = `<div class="mk-won${won ? "" : " lost"}">${won ? (st.winners.length > 1 ? "🏆 SPLIT" : "🏆 WON") : "—"}</div>`;
  } else {
    const lbl = st.state !== "open" ? "Closed" : mk.type === "yesno" ? `Bet ${outcomeName(mk, o)}` : "Bet";
    right = `<button class="mk-buy${mk.type === "yesno" && o === "no" ? " no" : ""}" data-bet-m="${mk.id}" data-bet-o="${esc(o)}"${st.state === "open" ? "" : " disabled"}>${lbl}</button>`;
  }
  const team = mk.type === "contest" ? ` <span class="sm">· ${esc(TEAMS[bettorTeam(o)].name.replace(/^Team /, ""))}</span>` : "";
  const bar = mk.type === "contest" ? `<div class="mk-bar"><i style="width:${(shareOf(pot, o) * 100).toFixed(1)}%;background:${outcomeColor(mk, o)}"></i></div>` : "";
  return `<div class="mk-row"><span class="mk-sw" style="background:${outcomeColor(mk, o)}"></span>
    <div class="mk-o"><div class="mk-oname">${esc(outcomeName(mk, o))}${team}</div>${bar}${sub ? `<div class="mk-octx">${esc(sub)}</div>` : ""}</div>
    <div class="mk-pct">${pot.total ? fmtPct(shareOf(pot, o)) : "—"}</div>${right}</div>`;
}
function contestBodyHtml(mk, ctx, me) {
  const st = ctx.statuses[mk.id], pot = ctx.pots[mk.id], res = contestEntries(mk);
  const valid = TEAM_ORDER.filter((t) => res[t] && !res[t].none && res[t].value > 0)
    .sort((a, b) => (mk.best === "max" ? res[b].value - res[a].value : res[a].value - res[b].value));
  const top = valid.filter((t) => res[t].value === res[valid[0]]?.value);
  const n = TEAM_ORDER.filter((t) => res[t]).length;
  const lead = top.length
    ? `${st.state === "resolved" ? "🏆 Winner" : "Leading"}: <b>${top.map((t) => esc(res[t].player)).join(" & ")}</b> — ${res[top[0]].value} ${mk.unit}`
    : n ? "No valid result yet" : `Each group records its best after hole ${contestHole(mk)}`;
  const entries = TEAM_ORDER.map((t) => {
    const r = res[t];
    return `<span class="mk-entry${r ? "" : " wait"}"><i style="background:${TEAMS[t].color}"></i>${esc(TEAMS[t].name.replace(/^Team /, ""))}: ${r ? (r.none ? "none" : `${esc(firstName(r.player))} ${r.value} ${mk.unit}`) : "—"}</span>`;
  }).join("");
  const rows = mktOutcomes(mk).filter((o) => pot.by[o]).sort((a, b) => pot.by[b] - pot.by[a]).map((o) => rowHtml(mk, o, ctx, me, "")).join("");
  const actions = [
    st.state === "open" ? `<button class="btn small" data-pick="${mk.id}">＋ Bet on a player</button>` : "",
    myTeam && !roundOver() ? `<button class="btn small ghost" data-record="${mk.id}">📏 ${res[myTeam] ? "Edit" : "Record"} our best</button>` : "",
  ].join("");
  return `<div class="mk-contest"><div class="mk-lead">${lead}<span class="sm"> · ${n} of 4 groups in</span></div><div class="mk-entries">${entries}</div></div>
    ${rows || `<div class="mk-fine" style="margin:10px 0 4px">No bets yet — any of the 16 players can win this.</div>`}
    ${actions ? `<div class="mk-actions">${actions}</div>` : ""}`;
}
function settleNoteHtml(mk, ctx) {
  const st = ctx.statuses[mk.id], pot = ctx.pots[mk.id];
  if (st.state === "locked") return `<div class="mk-fine"><b>Betting closed.</b> ${mk.type === "contest" ? "Settles once all four groups record their best." : "Settles when every group finishes 18."}</div>`;
  if (st.state !== "resolved") return "";
  if (!pot.total) return `<div class="mk-fine"><b>Settled</b> — nobody bet on this one.</div>`;
  if (ctx.refund[mk.id]) return `<div class="mk-fine"><b>Refunded:</b> ${st.winners.length ? "nobody backed the winner" : "no valid result"}, so every bet came back.</div>`;
  const backers = new Set(ctx.bets.filter((b) => b.m === mk.id && st.winners.includes(b.o)).map((b) => b.who)).size;
  return `<div class="mk-fine"><b>Settled: ${st.winners.map((o) => esc(outcomeName(mk, o))).join(" & ")}.</b> The ${fmtB(pot.total)} pot went to ${backers} backer${backers === 1 ? "" : "s"}.</div>`;
}

// pot-share chart: one line per outcome (the yes/no pool plots YES only), direct labels at the right
function chartHtml(mk, ctx) {
  const { hist, meta } = oddsHistory(mk, ctx.bets), outs = mktOutcomes(mk);
  if (hist.length === 1) return `<div class="mk-cap" style="margin-top:10px">No bets yet — the pot is empty. Be the first.</div>`;
  const series = mk.type === "yesno" ? [0] : outs.map((_, i) => i);
  chartStore[mk.id] = { mk, hist, meta, series, outs };
  const n = hist.length, W = 300, H = 100;
  const pts = (i) => hist.map((v, k) => `${((k / (n - 1)) * W).toFixed(1)},${(H - v[i] * H).toFixed(1)}`).join(" ");
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
  return series.map((i, j) => `<div class="mk-lab" style="top:${ys[j].toFixed(1)}%"><i style="background:${outcomeColor(mk, outs[i])}"></i>${esc(outcomeShort(mk, outs[i]))}<b>${k ? fmtPct(v[i]) : "—"}</b></div>`).join("");
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
  const { mk, meta, hist } = chartStore[mid], b = meta[k];
  if (!b) return "Before the first bet";
  return `${k === hist.length - 1 ? "Latest: " : ""}${firstName(bettorName(b.who))} bet ${fmtB(b.amt * 100)} on ${outcomeShort(mk, b.o)} · ${timeAgo(b.ts)}`;
}
// drag across the chart to see the pot split after any bet
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
  const rows = allBettors().map((w) => ({ w, ...walletOf(w, ctx) })).sort((a, b) => b.net - a.net || a.w.localeCompare(b.w));
  const active = new Set(ctx.bets.map((b) => b.who));
  const total = rows.reduce((s, r) => s + r.net, 0), start = rows.length * BANKROLL_C;
  return `<div class="mk-section-title">💰 Bettor standings</div><div class="mk-card mk-standings">${rows.map((r) => {
    const pl = r.net - BANKROLL_C, rank = 1 + rows.filter((x) => x.net > r.net).length;
    return `<div class="mk-st-row${r.w === me ? " me" : ""}">
      <span class="mk-rank">${rank}</span><span class="mk-dot" style="background:${TEAMS[bettorTeam(r.w)].color}"></span>
      <span class="mk-st-name">${esc(bettorName(r.w))}${active.has(r.w) ? (r.inPlay ? ` <span class="sm">· ${fmtB(r.inPlay)} in play</span>` : "") : ` <span class="sm">· no bets</span>`}</span>
      <span class="mk-st-net">${fmtB(r.net)}</span>
      <span class="mk-st-pl ${pl > 0 ? "up" : pl < 0 ? "down" : ""}">${pl === 0 ? "—" : signed(pl)}</span>
    </div>`;
  }).join("")}
  <div class="mk-zero">${total === start ? "✓" : "⚠️"} All 16 players together: <b>${fmtB(total)}</b> — the same ${fmtB(start)} everyone started with. No house: every Bend Buck won came from someone else's losing bet.</div></div>`;
}
function activityHtml(ctx) {
  const recent = ctx.bets.slice(-15).reverse();
  if (!recent.length) return "";
  return `<div class="mk-section-title">📈 Recent bets</div><div class="mk-card">${recent.map((b) => {
    const mk = MKT_BY_ID[b.m];
    return `<div class="mk-act"><span class="mk-dot" style="background:${TEAMS[bettorTeam(b.who)]?.color}"></span>
      <b>${esc(firstName(bettorName(b.who)))}</b> bet <b>${fmtB(b.amt * 100)}</b> on <b>${esc(outcomeName(mk, b.o))}</b> · ${esc(mk.short)}
      <span class="mk-move">${fmtPct(b.pb)} → ${fmtPct(b.pa)}</span><span class="when">${timeAgo(b.ts)}</span></div>`;
  }).join("")}</div>`;
}
function howItWorksHtml() {
  return `<details class="mk-card mk-howto"${howOpen ? " open" : ""}><summary>How the betting works</summary>
    <p>Every bet on a market goes into one pot. When it settles, the pot is split among everyone who backed the winner, in proportion to what they bet. <b>No house</b> — every Bend Buck someone wins came from someone else's losing bet.</p>
    <p>The % is each pick's share of the pot, so it moves with every bet. Payouts aren't locked in: more money on your pick shrinks your cut, money on the others grows it. Bets are final.</p>
    <p>Everyone starts with <b>${fmtB(BANKROLL_C)}</b>. If nobody backed the winner — or a contest has no valid result — everyone in that pool gets their stake back. Ties split the pot.</p>
  </details>`;
}

// ── bet ticket, player picker, contest results ──
let betCtx = null, betBusy = false;
function openBet(m, o) {
  const mk = MKT_BY_ID[m];
  if (!mk) return;
  if (!myBettor()) { switchTab("market"); toast(myTeam ? "Pick who's betting first 👆" : "Log in with your team to bet"); return; }
  betCtx = { m, o };
  $("modal-root").innerHTML = `
    <div class="modal-back" id="mb"><div class="modal">
      <h3>${esc(outcomeName(mk, o))}</h3>
      <div class="sub">${mk.icon} ${esc(mk.short)} · <span id="bq-now"></span></div>
      <div class="pick-label" id="bq-label"></div>
      <input id="bq-amt" class="mk-amt" type="number" inputmode="numeric" min="1" step="1" placeholder="0" autocomplete="off">
      <div class="chips" id="bq-chips"></div>
      <div class="mk-quote" id="bq-quote"></div>
      <div class="mk-fine">Bets are final. Your payout depends on the final pot — more money on ${esc(outcomeShort(mk, o))} shrinks it, money on the others grows it.</div>
      <div class="modal-actions"><button class="btn ghost" id="cancel">Cancel</button><button class="btn" id="bq-go">Place bet</button></div>
    </div></div>`;
  $("cancel").onclick = closeModal;
  $("mb").onclick = (e) => { if (e.target.id === "mb") closeModal(); };
  $("bq-amt").oninput = () => updateBetQuote();
  $("bq-chips").onclick = (e) => { const c = e.target.closest("[data-amt]"); if (c) { $("bq-amt").value = c.dataset.amt; updateBetQuote(); } };
  $("bq-go").onclick = placeBet;
  updateBetQuote(true);
}
// live quote — re-runs on every keystroke and whenever anyone else bets
function updateBetQuote(rebuildChips) {
  if (!betCtx || !$("bq-quote")) return;
  const me = myBettor();
  if (!me) return closeModal();
  const { m, o } = betCtx, mk = MKT_BY_ID[m];
  const ctx = marketContext(), st = ctx.statuses[m], pot = ctx.pots[m], on = pot.by[o] || 0, w = walletOf(me, ctx);
  $("bq-now").textContent = pot.total ? `${fmtPct(shareOf(pot, o))} of a ${fmtB(pot.total)} pot` : "empty pot — be the first";
  $("bq-label").textContent = `Bet amount · cash ${fmtB(w.cash)}`;
  if (rebuildChips) {
    const max = Math.floor(w.cash / 100);
    $("bq-chips").innerHTML = [1, 2, 5].filter((v) => v < max).map((v) => `<button class="chip" data-amt="${v}">${fmtB(v * 100)}</button>`).join("")
      + (max >= 1 ? `<button class="chip" data-amt="${max}">Max ${fmtB(max * 100)}</button>` : "");
  }
  const raw = $("bq-amt").value, amt = Number(raw), valid = Number.isInteger(amt) && amt >= 1;
  const row = (k, v, cls = "") => `<div class="qr ${cls}"><span>${k}</span><b>${v}</b></div>`;
  let html = "", label = "Enter an amount", ok = st.state === "open" && valid;
  if (st.state !== "open") { html = row("Betting is closed on this market", ""); label = "Betting closed"; ok = false; }
  else if (raw !== "" && !valid) { html = row("Whole Bend Bucks only", "", "bad"); ok = false; }
  else {
    const a = valid ? amt * 100 : 0, potAfter = pot.total + a, onAfter = on + a;
    if (a > w.cash) { ok = false; html += row("Not enough cash", fmtB(w.cash), "bad"); }
    const pays = a ? Math.floor((potAfter * a) / onAfter) : 0;
    html += row("Pot after your bet", fmtB(potAfter))
      + row("Share on this pick", a ? `${fmtPct(pot.total ? on / pot.total : 0)} → ${fmtPct(onAfter / potAfter)}` : "—")
      + row(`Pays ${winsPhrase(mk, o)} (pot as it stands)`, a ? `${fmtB(pays)} (${signed(pays - a)})` : "—", "big");
    if (valid) label = `Bet ${fmtB(a)} on ${outcomeShort(mk, o)}`;
  }
  $("bq-quote").innerHTML = html;
  $("bq-go").textContent = betBusy ? "Placing…" : label;
  $("bq-go").disabled = !ok || betBusy;
}
// A database transaction, so simultaneous bets can't overspend a wallet or sneak in after close.
async function placeBet() {
  if (!betCtx || betBusy) return;
  const who = myBettor(), { m, o } = betCtx, mk = MKT_BY_ID[m], amt = Number($("bq-amt").value);
  if (!who || !Number.isInteger(amt) || amt < 1) return;
  const key = sync.newKey();
  ack(`bet-${key}`); // no "someone bet" toast for our own bet
  let fail = null, done = null;
  betBusy = true;
  updateBetQuote();
  const committed = await sync.transact("market/bets", (cur) => {
    fail = null; done = null;
    const c = marketContext(betList(cur));
    if (c.statuses[m].state !== "open") { fail = "Betting on this market just closed."; return; }
    const w = walletOf(who, c);
    if (amt * 100 > w.cash) { fail = `Not enough ${MARKET.currency} — you have ${fmtB(w.cash)}.`; return; }
    const pot = c.pots[m], on = pot.by[o] || 0;
    const pb = pot.total ? on / pot.total : 0, pa = (on + amt * 100) / (pot.total + amt * 100);
    done = { pa, pot: pot.total + amt * 100 };
    return { ...(cur || {}), [key]: { m, o, who, amt, pb: +pb.toFixed(4), pa: +pa.toFixed(4), ts: Date.now() } };
  }).catch((e) => { console.error(e); fail = "Couldn't reach the pool — check your signal and try again."; return false; });
  betBusy = false;
  if (committed && done) {
    closeModal();
    toast(`✅ ${fmtB(amt * 100)} on ${outcomeShort(mk, o)} · now ${fmtPct(done.pa)} of a ${fmtB(done.pot)} pot`);
  } else {
    if (fail) toast(fail);
    updateBetQuote(true);
  }
}
function openPlayerPicker(m) {
  const mk = MKT_BY_ID[m];
  if (!myBettor()) { toast(myTeam ? "Pick who's betting first 👆" : "Log in with your team to bet"); return; }
  const pot = marketContext().pots[m];
  $("modal-root").innerHTML = `
    <div class="modal-back" id="mb"><div class="modal">
      <h3>${mk.icon} ${esc(mk.short)}</h3>
      <div class="sub">Hole ${contestHole(mk)} · pick who you think wins</div>
      ${TEAM_ORDER.map((t) => `<div class="pick-label">${esc(TEAMS[t].name)}</div><div class="chips">${TEAMS[t].players.map((p) => {
        const o = bettorId(t, p);
        return `<button class="chip" data-bet-m="${m}" data-bet-o="${esc(o)}">${esc(p)}${pot.by[o] ? `<span class="cnt">${fmtPct(shareOf(pot, o))}</span>` : ""}</button>`;
      }).join("")}</div>`).join("")}
      <div class="modal-actions"><button class="btn ghost" id="cancel">Cancel</button></div>
    </div></div>`;
  $("cancel").onclick = closeModal;
  $("mb").onclick = (e) => { if (e.target.id === "mb") closeModal(); };
}
function openContestEntry(m) {
  const mk = MKT_BY_ID[m];
  if (!myTeam) { toast("Log in with your team to record results"); return; }
  const mine = contestEntries(mk)[myTeam];
  let pick = mine ? (mine.none ? "none" : mine.player) : null;
  $("modal-root").innerHTML = `
    <div class="modal-back" id="mb"><div class="modal">
      <h3>${mk.icon} ${esc(mk.short)}</h3>
      <div class="sub">Hole ${contestHole(mk)} · ${esc(TEAMS[myTeam].name)}'s best</div>
      <div class="pick-label">Whose shot?</div>
      <div class="chips" id="ce-who"></div>
      <div class="pick-label">${mk.best === "max" ? "Drive distance (yards)" : "Distance to the pin (feet — 7.5 = 7′6″)"}</div>
      <input id="ce-val" class="mk-amt" type="number" inputmode="decimal" min="0" step="any" placeholder="0" value="${mine && !mine.none ? mine.value : ""}">
      <div class="mk-fine">Every group records its best; the app compares them and settles the pool once all four are in.</div>
      <div class="modal-actions"><button class="btn ghost" id="cancel">Later</button><button class="btn" id="ce-save">Save</button></div>
    </div></div>`;
  const draw = () => {
    $("ce-who").innerHTML = TEAMS[myTeam].players.map((p) => `<button class="chip${pick === p ? " on" : ""}" data-p="${esc(p)}">${esc(p)}</button>`).join("")
      + `<button class="chip${pick === "none" ? " on" : ""}" data-p="none">${esc(mk.noneLabel)}</button>`;
    $("ce-val").disabled = pick === "none";
  };
  draw();
  $("ce-who").onclick = (e) => { const c = e.target.closest("[data-p]"); if (c) { pick = c.dataset.p; draw(); } };
  $("cancel").onclick = closeModal;
  $("mb").onclick = (e) => { if (e.target.id === "mb") closeModal(); };
  $("ce-save").onclick = () => {
    if (!pick) { toast("Pick whose shot it was — or nobody"); return; }
    const v = Math.round(parseFloat($("ce-val").value) * 10) / 10;
    if (pick !== "none" && !(v > 0)) { toast(`Enter the distance in ${mk.unit}`); return; }
    sync.set(`market/results/${m}/${myTeam}`, pick === "none" ? { none: true, ts: Date.now() } : { player: pick, value: v, ts: Date.now() });
    closeModal();
    toast(pick === "none" ? `${mk.short}: recorded — nobody from your group` : `${mk.short}: ${firstName(pick)} · ${v} ${mk.unit} recorded`);
  };
}
// after a team saves its score on a contest hole, ask for the contest result
function maybePromptContest(h) {
  const mk = MARKET.markets.find((x) => x.type === "contest" && contestHole(x) === h && !contestEntries(x)[myTeam]);
  if (!mk) return;
  if ($("modal-root").innerHTML) toast(`${mk.icon} ${mk.short} hole — record your group's best in the Market tab`);
  else openContestEntry(mk.id);
}
function changeContestHole(m) {
  const mk = MKT_BY_ID[m], v = prompt(`${mk.short}: which hole? (1–18)`, String(contestHole(mk)));
  if (v === null) return;
  const h = parseInt(v, 10);
  if (!(h >= 1 && h <= 18)) { toast("Pick a hole from 1 to 18"); return; }
  sync.set(`market/config/${m}/hole`, h);
  toast(`${mk.short} is now on hole ${h}`);
}
document.addEventListener("click", (e) => {
  const bt = e.target.closest("[data-bet-m]");
  if (bt) { openBet(bt.dataset.betM, bt.dataset.betO); return; }
  const pk = e.target.closest("[data-pick]");
  if (pk) { openPlayerPicker(pk.dataset.pick); return; }
  const rc = e.target.closest("[data-record]");
  if (rc) { openContestEntry(rc.dataset.record); return; }
  const ho = e.target.closest("[data-hole]");
  if (ho) { changeContestHole(ho.dataset.hole); return; }
  const pick = e.target.closest("[data-bettor]");
  if (pick && myTeam) {
    bettor = { team: myTeam, name: pick.dataset.bettor };
    localStorage.setItem("bslbend-bettor", JSON.stringify(bettor));
    toast(`Betting as ${pick.dataset.bettor} · ${fmtB(BANKROLL_C)} to play with 🍀`);
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
  for (const b of mctx.bets) {
    if (!b.ts || now - b.ts > 3 * 60 * 1000 || acked.has(`bet-${b.id}`)) continue;
    ack(`bet-${b.id}`);
    if (b.who !== me && b.amt >= 5) bigBet = b; // only the newest, so opening the app mid-round isn't a toast storm
  }
  if (bigBet) {
    const mk = MKT_BY_ID[bigBet.m];
    toast(`📈 ${firstName(bettorName(bigBet.who))} put ${fmtB(bigBet.amt * 100)} on ${outcomeShort(mk, bigBet.o)} (${mk.short}) · now ${fmtPct(bigBet.pa)} of the pot`);
  }
  if (me) {
    for (const mk of MARKET.markets) {
      const st = mctx.statuses[mk.id];
      if (st.state !== "resolved" || !st.ts || now - st.ts > FRESH_MS) continue;
      const key = `settle-${mk.id}-${st.winners.join(",")}-${me}`;
      if (acked.has(key)) continue;
      ack(key);
      const s = walletOf(me, mctx).settled.find((x) => x.m === mk.id);
      if (!s) continue;
      const head = `<b>${esc(mk.short)} settled${st.winners.length ? `: ${st.winners.map((o) => esc(outcomeName(mk, o))).join(" & ")}` : ""}</b>`;
      const body = mctx.refund[mk.id] ? `Nobody backed the winner — your ${fmtB(s.stake)} came back.`
        : s.got ? `You collected ${fmtB(s.got)} (${signed(s.got - s.stake)}).` : `Your ${fmtB(s.stake)} went into the winners' pot.`;
      banner("b-info", s.got > s.stake ? "💰" : s.got === s.stake ? "↩️" : "💸", `${head}<br>${body}`);
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
