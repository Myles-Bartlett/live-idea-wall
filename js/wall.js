/* ============================================================
   The wall: draws the ideas from Store in the early test layout.

   Three views over the same ideas:
     columns: one column per opportunity area
     recent:  every idea, newest first, filling the whole wall
     top:     every idea, most supported first, the leaders enlarged
   plus a stacked/unstacked toggle and auto-rotate. Keys 1/2/3, S, A and
   the arrow keys drive it too.

   The current view lives in the URL hash (#v=columns&s=1&r=0), so a
   reload or a bookmark keeps it.
   ============================================================ */

/* ---------------- settings you might change ---------------- */

// Auto-rotate: how long each view holds before the wall moves to the next.
const ROTATE_SECONDS = 45;

// Views the auto-rotation cycles through, in order.
const ROTATION = ["columns", "recent", "top"];

// A column holding more than fits pages to its next set this often.
const PAGE_SECONDS = 14;

// The facilitators' notes along the bottom rotate this often.
const NOTE_SECONDS = 8;

/* ---------------- page elements and state ---------------- */

const boardEl      = document.getElementById("board");
const highlightEl  = document.getElementById("highlightText");
const statusEl     = document.getElementById("status");
const toastEl      = document.getElementById("toast");
const viewbarEl    = document.getElementById("viewbar");
const tallyBigEl   = document.getElementById("tallyBig");
const tallySmallEl = document.getElementById("tallySmall");
const tallyTodayEl = document.getElementById("tallyToday");

const offsets = new Map();     // area key -> index of the first note shown (paging)
let seen = null;               // root ids drawn last time; null before the first draw
let rotateTimer = null;
let pagePausedUntil = 0;
let renderQueued = false;
let noteIdx = 0;

/* ---------------- view state (kept in the URL hash) ---------------- */

function readState(){
  const h = new URLSearchParams((location.hash || "").replace(/^#/, ""));
  return {
    view: ROTATION.includes(h.get("v")) ? h.get("v") : "columns",
    stacked: h.get("s") !== "0",
    rotate:  h.get("r") === "1"
  };
}

function writeState(patch){
  const s = Object.assign(readState(), patch);
  const h = new URLSearchParams();
  h.set("v", s.view);
  h.set("s", s.stacked ? "1" : "0");
  h.set("r", s.rotate ? "1" : "0");
  // replaceState avoids piling up history entries on a kiosk screen
  history.replaceState(null, "", location.pathname + location.search + "#" + h.toString());
  return s;
}

function setView(view, fromRotation){
  const s = writeState({ view: view });
  if (!fromRotation) restartRotation(s);
  render();
  wakeViewbar();
}

/* ---------------- small helpers ---------------- */

function escapeHtml(s){
  return String(s == null ? "" : s).replace(/[&<>"']/g, m => ({
    "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"
  }[m]));
}

function plural(n, one, many){ return n + " " + (n === 1 ? one : many); }

function showToast(message, isError){
  toastEl.textContent = message;
  toastEl.classList.toggle("error", !!isError);
  toastEl.classList.add("show");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toastEl.classList.remove("show"), 2600);
}

/* ---------------- note rendering ---------------- */

// Support shows as a row of dots (up to 10, then "+"), not a growing number.
function dotsHtml(n){
  if (!n) return "";
  let h = '<span class="dots" role="img" aria-label="' + plural(n, "supporter", "supporters") + '">';
  for (let i = 0; i < Math.min(n, 10); i++) h += "<i></i>";
  if (n > 10) h += "<em>+</em>";
  return h + "</span>";
}

// s = a stack from Stacks.build. opts.rank adds a rank badge (top view).
function renderNote(s, opts){
  opts = opts || {};
  const lead = s.root;
  const area = AREA[s.area];
  const by = lead.name || (s.size > 1 ? s.size + " people said this" : "");
  const isNew = seen === null || !seen.has(lead.id);

  const classes = "note" +
    (s.size > 1 ? " stacked" : "") +
    (opts.rank ? " ranked" : "") +
    (s.isFresh ? " fresh" : "") +
    (isNew ? " arrive" : "");

  return (
    '<div class="' + classes + '" data-area="' + s.area + '" data-id="' + escapeHtml(lead.id) + '" data-size="' + s.size + '">' +
      (opts.rank ? '<span class="rank">' + opts.rank + '</span>' : '') +
      (s.isFresh ? '<span class="new-tag">New</span>' : '') +
      '<span class="idea">' + escapeHtml(lead.text) + '</span>' +
      (by ? '<span class="from">' + escapeHtml(by) + '</span>' : '') +
      '<div class="note-meta">' +
        dotsHtml(s.support) +
        (s.size > 1 ? '<span class="depth" aria-label="' + s.size + ' ideas in this stack">×' + s.size + '</span>' : '') +
        '<span class="area">' + escapeHtml(lead.sample ? "Sample · " + area.short : area.short) + '</span>' +
      '</div>' +
    '</div>'
  );
}

/* ---------------- density: keep notes readable, fill the wall ---------------- */

// Bigger screens get bigger type: the Hub reads from across an aisle.
function screenScale(){
  return Math.min(1.6, Math.max(1, window.innerWidth / 1500));
}

function setDensity(view, columnCount, noteCount){
  const root = document.documentElement;
  let fs;
  if (view === "columns"){
    root.style.setProperty("--cols", columnCount);
    // deepest column decides the type size
    fs = noteCount >= 14 ? 11 : noteCount >= 10 ? 12 : noteCount >= 6 ? 13 : 14;
    boardEl.dataset.density = noteCount >= 24 ? "2" : noteCount >= 12 ? "1" : "0";
  } else {
    // a flowing wall: more, narrower columns as the idea count grows
    const cols = noteCount <= 12 ? 3
               : noteCount <= 24 ? 4
               : noteCount <= 40 ? 5
               : noteCount <= 64 ? 6 : 7;
    root.style.setProperty("--mcols", Math.max(2, Math.min(cols, Math.floor(window.innerWidth / 230))));
    fs = noteCount >= 55 ? 11.5 : noteCount >= 35 ? 12.5 : 14;
    boardEl.dataset.density = noteCount >= 100 ? "2" : noteCount >= 42 ? "1" : "0";
  }
  root.style.setProperty("--note-fs", (fs * screenScale()).toFixed(1) + "px");
}

/* ---------------- the three views ---------------- */

function renderColumns(stacks, settings){
  // "Something else" can be switched off by facilitators, and an empty one
  // is never drawn (it would only take room from the six areas).
  const shown = AREAS.filter(a => a.key !== "other" ||
    (settings.showOther && stacks.some(s => s.area === "other")));
  let deepest = 0;

  const html = shown.map(a => {
    const mine = stacks.filter(s => s.area === a.key).sort(Stacks.rank);
    const count = mine.reduce((n, s) => n + s.size, 0);
    deepest = Math.max(deepest, mine.length);

    // a note that just landed here is shown from the top of the column
    if (seen && mine.some(s => !seen.has(s.root.id))) offsets.set(a.key, 0);

    const notes = mine.map(s => renderNote(s)).join("");
    return (
      '<section class="column" data-area="' + a.key + '" aria-label="' + escapeHtml(a.name) + '">' +
        '<div class="col-head">' +
          '<span class="swatch"></span><span class="label">' + escapeHtml(a.name) + '</span>' +
          '<span class="count">' + plural(count, "idea", "ideas") + '</span>' +
        '</div>' +
        '<div class="col-body" data-area="' + a.key + '">' +
          (notes || '<div class="col-empty">No ideas here yet.<br>Yours could be the first.</div>') +
        '</div>' +
      '</section>'
    );
  }).join("");

  setDensity("columns", shown.length, deepest);
  return html;
}

function renderFlow(stacks, mode){
  const sorted = stacks.slice();
  if (mode === "top"){
    sorted.sort((a, b) => (b.support - a.support) || (b.size - a.size) || (b.latest - a.latest));
  } else {
    sorted.sort((a, b) => b.latest - a.latest);
  }
  setDensity(mode, 0, sorted.length);
  return sorted.map((s, i) => renderNote(s, {
    rank: (mode === "top" && i < 3 && s.support > 0) ? (i + 1) : null
  })).join("");
}

/* ---------------- render ---------------- */

// Many changes can arrive at once; draw at most once per frame.
function render(){
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => { renderQueued = false; draw(); });
}

function draw(){
  const s = readState();
  const settings = Store.settings();
  const visible = Store.ideas().filter(i => !i.hidden);
  const model = Stacks.build(visible, Store.fresh);
  const stacks = s.stacked ? model.stacks : Stacks.explode(model.stacks, Store.fresh);

  boardEl.dataset.view = s.view;
  boardEl.classList.remove("has-more");

  if (Store.status() === "error"){
    boardEl.innerHTML = '<p class="board-message">The wall can’t reach its database.<br>' +
      'Check config.js and the internet connection.</p>';
  } else if (s.view === "columns"){
    boardEl.innerHTML = renderColumns(stacks, settings);
  } else if (visible.length === 0){
    boardEl.innerHTML = '<p class="board-message">Waiting for the first idea…</p>';
  } else {
    boardEl.innerHTML = renderFlow(stacks, s.view);
  }

  seen = new Set(stacks.map(x => x.root.id));

  // view bar state
  viewbarEl.querySelectorAll(".vbtn[data-view]").forEach(b => {
    b.setAttribute("aria-pressed", b.dataset.view === s.view ? "true" : "false");
  });
  const stackBtn = document.getElementById("stackBtn");
  stackBtn.setAttribute("aria-pressed", s.stacked ? "true" : "false");
  stackBtn.firstChild.textContent = s.stacked ? "Stacked" : "Unstacked";
  document.getElementById("rotateBtn").setAttribute("aria-pressed", s.rotate ? "true" : "false");

  // running total, and how many came in today
  const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
  const today = visible.filter(i => i.ts >= midnight.getTime()).length;
  tallyBigEl.textContent = visible.length;
  tallySmallEl.textContent = visible.length === 1 ? "idea so far" : "ideas so far";
  tallyTodayEl.textContent = today + " added today";
  tallyTodayEl.hidden = !(today > 0 && today < visible.length);

  if (s.view === "columns") fitColumns(); else fitFlow();
}

/* Nobody scrolls a wall. In the Areas view a column holding more ideas than
   fit shows as many as fit and then CYCLES: every PAGE_SECONDS it moves to
   the next set, wrapping around, so every idea gets its turn on screen.
   The "+N more" chip is also a button: tap it to move on straight away. */

function fitOneColumn(body){
  const notes = Array.from(body.querySelectorAll(".note"));
  const oldChip = body.querySelector(".more-chip");
  if (oldChip) oldChip.remove();
  if (notes.length === 0) return;

  const key = body.dataset.area;
  let offset = offsets.get(key) || 0;
  if (offset >= notes.length) offset = 0;

  // everything fits: nothing to page
  notes.forEach(n => { n.style.display = ""; });
  if (offset === 0 && body.scrollHeight <= body.clientHeight){
    offsets.set(key, 0);
    return;
  }

  // Too many. Put the chip in first so its room is counted, then add notes
  // from the offset until the next one would not fit. Paging runs forward
  // and then starts over rather than wrapping mid-page, which would put the
  // tail of the column above its head.
  notes.forEach(n => { n.style.display = "none"; });
  const chip = document.createElement("button");
  chip.type = "button";
  chip.className = "more-chip";
  body.appendChild(chip);

  let shown = 0;
  for (let i = offset; i < notes.length; i++){
    notes[i].style.display = "";
    if (shown > 0 && body.scrollHeight > body.clientHeight){   // always keep at least one
      notes[i].style.display = "none";
      break;
    }
    shown++;
  }

  // count ideas, not notes, so a stack of 3 counts as 3 like the column heading
  let hiddenIdeas = 0;
  notes.forEach((n, i) => {
    if (i < offset || i >= offset + shown) hiddenIdeas += parseInt(n.dataset.size, 10) || 1;
  });

  offsets.set(key, offset);
  chip.dataset.step = shown;
  chip.textContent = "+" + hiddenIdeas + " more ↻";
  chip.setAttribute("aria-label", hiddenIdeas + " more ideas in this column. Show the next set.");
  chip.addEventListener("click", e => {
    e.stopPropagation();
    advanceColumn(body);
    pagePausedUntil = Date.now() + PAGE_SECONDS * 1000;
  });
}

function advanceColumn(body){
  const chip = body.querySelector(".more-chip");
  const count = body.querySelectorAll(".note").length;
  if (!chip || count === 0) return;
  const key = body.dataset.area;
  const next = (offsets.get(key) || 0) + (parseInt(chip.dataset.step, 10) || 1);
  offsets.set(key, next >= count ? 0 : next);   // page forward, then back to the top
  fitOneColumn(body);
  replayArrival(body);
}

function fitColumns(){
  boardEl.querySelectorAll(".col-body").forEach(fitOneColumn);
}

// Notes revealed by paging fade in like new ones.
function replayArrival(body){
  body.querySelectorAll(".note").forEach(n => {
    if (n.style.display === "none") return;
    n.classList.remove("arrive");
    void n.offsetWidth;            // restart the animation
    n.classList.add("arrive");
  });
}

function startPaging(){
  setInterval(() => {
    if (boardEl.dataset.view !== "columns") return;
    if (Date.now() < pagePausedUntil) return;
    boardEl.querySelectorAll(".col-body").forEach(body => {
      if (body.querySelector(".more-chip")) advanceColumn(body);
    });
  }, PAGE_SECONDS * 1000);
}

/* Same idea for the flowing views: show as many notes as fit, so nothing is
   sliced in half, and say how many did not. Extra notes in a multi-column
   layout spill sideways into columns off the right edge, so width counts
   as overflow too. */
function fitFlow(){
  const notes = Array.from(boardEl.querySelectorAll(".note"));
  const overflows = () => boardEl.scrollHeight > boardEl.clientHeight + 1 ||
                          boardEl.scrollWidth > boardEl.clientWidth + 1;
  if (notes.length === 0 || !overflows()) return;

  // Too many. Leave room for the "+N more" pill, then find the most notes
  // that fit by halving the range (quick even with hundreds of ideas).
  boardEl.classList.add("has-more");
  const showFirst = k => notes.forEach((n, i) => { n.style.display = i < k ? "" : "none"; });
  let lo = 1, hi = notes.length - 1;
  while (lo < hi){
    const mid = Math.ceil((lo + hi) / 2);
    showFirst(mid);
    if (overflows()) hi = mid - 1; else lo = mid;
  }
  showFirst(lo);

  const hiddenIdeas = notes.slice(lo).reduce((t, n) => t + (parseInt(n.dataset.size, 10) || 1), 0);
  const pill = document.createElement("div");
  pill.className = "more-pill";
  pill.textContent = "+" + hiddenIdeas + " more on the wall";
  boardEl.appendChild(pill);
}

/* ---------------- facilitators' notes and connection state ---------------- */

function rotateNote(){
  const list = (Store.settings().notes || []).filter(Boolean);
  if (list.length === 0){ highlightEl.textContent = ""; return; }
  highlightEl.classList.add("fade");
  setTimeout(() => {
    noteIdx = noteIdx % list.length;
    highlightEl.textContent = list[noteIdx];
    noteIdx++;
    highlightEl.classList.remove("fade");
  }, 400);
}

const STATUS_TEXT = {
  connecting:   "Connecting…",
  live:         "Live",
  reconnecting: "Reconnecting…",
  offline:      "Offline",
  demo:         "Demo data",
  error:        "Not connected"
};

function showStatus(state){
  statusEl.dataset.state = state;
  statusEl.textContent = STATUS_TEXT[state] || state;
  if (state === "error") render();
}

/* ---------------- view bar, keyboard, rotation ---------------- */

function wakeViewbar(){
  viewbarEl.classList.add("awake");
  clearTimeout(wakeViewbar._t);
  wakeViewbar._t = setTimeout(() => viewbarEl.classList.remove("awake"), 4000);
}

function restartRotation(s){
  clearInterval(rotateTimer);
  rotateTimer = null;
  if (!s.rotate) return;
  rotateTimer = setInterval(() => {
    const cur = readState().view;
    setView(ROTATION[(ROTATION.indexOf(cur) + 1) % ROTATION.length], true);
  }, ROTATE_SECONDS * 1000);
}

function toggleStacked(){
  writeState({ stacked: !readState().stacked });
  render(); wakeViewbar();
}

function toggleRotate(){
  const s = writeState({ rotate: !readState().rotate });
  restartRotation(s); render(); wakeViewbar();
  showToast(s.rotate ? "Auto-rotating views every " + ROTATE_SECONDS + "s" : "Auto-rotate off", false);
}

viewbarEl.querySelectorAll(".vbtn[data-view]").forEach(btn => {
  btn.addEventListener("click", () => setView(btn.dataset.view));
});
document.getElementById("stackBtn").addEventListener("click", toggleStacked);
document.getElementById("rotateBtn").addEventListener("click", toggleRotate);

document.addEventListener("keydown", e => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.target.closest && e.target.closest("input, textarea")) return;
  const k = e.key.toLowerCase();
  const cur = readState().view;
  if (k === "1") setView("columns");
  else if (k === "2") setView("recent");
  else if (k === "3") setView("top");
  else if (k === "s") toggleStacked();
  else if (k === "a") toggleRotate();
  else if (k === "arrowright") setView(ROTATION[(ROTATION.indexOf(cur) + 1) % ROTATION.length]);
  else if (k === "arrowleft") setView(ROTATION[(ROTATION.indexOf(cur) - 1 + ROTATION.length) % ROTATION.length]);
});

let resizeTimer = null;
window.addEventListener("resize", () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(render, 150); });
// so a facilitator can also drive the wall by editing the address bar
window.addEventListener("hashchange", () => { restartRotation(readState()); render(); });

/* ---------------- start ---------------- */

Store.onChange(render);
Store.onStatus(showStatus);
showStatus(Store.status());
restartRotation(writeState({}));
startPaging();
// redraw now and then so "new" outlines expire after two minutes
setInterval(render, 15 * 1000);
setInterval(rotateNote, NOTE_SECONDS * 1000);
Store.onChange(() => { if (!highlightEl.textContent) rotateNote(); });
Store.start();
render();
