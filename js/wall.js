/* ============================================================
   The wall: draws the ideas from Store in the early test layout.

   Four views over the same ideas:
     columns: one column per opportunity area
     recent:  every idea, newest first, filling the whole wall
     top:     every idea, most supported first, the leaders enlarged
     latest:  only the most recent idea, large
   plus filters (one area, one feeling), a stacked/unstacked toggle and
   auto-rotate. Keys 1-4, S, A and the arrow keys drive it too.

   The current view lives in the URL hash (#v=columns&s=1&r=0&a=talent&f=positive),
   so a reload or a bookmark keeps it.
   ============================================================ */

/* ---------------- settings you might change ---------------- */

// Auto-rotate: how long each view holds before the wall moves to the next.
const ROTATE_SECONDS = 45;

// Views the auto-rotation cycles through, in order.
const ROTATION = ["columns", "recent", "top", "latest"];

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
let lastModel = null;
let latestShownId = null;      // the idea the Latest view showed last time          // the latest stacks, for the pop-ups (js/detail.js)
const spotlit = new Map();     // root id -> time "Find my idea" picked it

// A phone or small tablet held by one person, rather than the shared Hub.
// Phones get a scrolling layout; the Hub never scrolls.
const isPersonalScreen = () => window.matchMedia("(max-width: 900px)").matches;
const isPhoneLayout = () => window.matchMedia("(max-width: 760px)").matches;

/* ---------------- view state (kept in the URL hash) ---------------- */

function readState(){
  const h = new URLSearchParams((location.hash || "").replace(/^#/, ""));
  const f = h.get("f");
  return {
    view: ROTATION.includes(h.get("v")) ? h.get("v") : "columns",
    stacked: h.get("s") !== "0",
    rotate:  h.get("r") === "1",
    area:    AREA[h.get("a")] ? h.get("a") : "",
    feel:    (FEELING[f] || f === "positive" || f === "negative") ? f : ""
  };
}

function writeState(patch){
  const s = Object.assign(readState(), patch);
  const h = new URLSearchParams();
  h.set("v", s.view);
  h.set("s", s.stacked ? "1" : "0");
  h.set("r", s.rotate ? "1" : "0");
  if (s.area) h.set("a", s.area);
  if (s.feel) h.set("f", s.feel);
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
    (s.found ? " found" : "") +
    (s.size > 1 ? " stacked" : "") +
    (opts.rank ? " ranked" : "") +
    (s.isFresh ? " fresh" : "") +
    (isNew ? " arrive" : "");

  return (
    '<div class="' + classes + '" data-area="' + s.area + '" data-id="' + escapeHtml(lead.id) + '" data-size="' + s.size + '"' +
      ' role="button" tabindex="0">' +
      (opts.rank ? '<span class="rank">' + opts.rank + '</span>' : '') +
      (s.isFresh ? '<span class="new-tag">' + (s.found ? "Found" : "New") + '</span>' : '') +
      '<span class="idea">' + escapeHtml(lead.text) + '</span>' +
      (by ? '<span class="from">' + escapeHtml(by) + '</span>' : '') +
      '<div class="note-meta">' +
        dotsHtml(s.support) +
        (s.size > 1 ? '<span class="depth" aria-label="' + s.size + ' ideas in this stack">×' + s.size + '</span>' : '') +
        (lead.feeling ? '<span class="feeling" aria-label="Feels ' + FEELING[lead.feeling].name.toLowerCase() + '">' +
          escapeHtml(FEELING[lead.feeling].name) + '</span>' : '') +
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
  if (isPhoneLayout()){
    // phones scroll, so every note shows in full at a comfortable size
    root.style.setProperty("--mcols", 1);
    root.style.setProperty("--note-fs", "15px");
    boardEl.dataset.density = "0";
    return;
  }
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
  } else if (mode === "area"){
    sorted.sort(Stacks.rank);   // same order as that area's column
  } else {
    sorted.sort((a, b) => b.latest - a.latest);
  }
  setDensity(mode, 0, sorted.length);
  return sorted.map((s, i) => renderNote(s, {
    rank: (mode === "top" && i < 3 && s.support > 0) ? (i + 1) : null
  })).join("");
}

/* ---------------- filters and the Latest view ---------------- */

// state.feel is one feeling word, "positive", "negative", or "" for all.
function matchesFilters(idea, state){
  if (state.area && idea.area !== state.area) return false;
  if (!state.feel) return true;
  if (!idea.feeling) return false;
  return FEELING[state.feel] ? idea.feeling === state.feel : FEELING[idea.feeling].tone === state.feel;
}

function filterLabel(state){
  const bits = [];
  if (state.area) bits.push(AREA[state.area].name);
  if (state.feel) bits.push(FEELING[state.feel] ? FEELING[state.feel].name : state.feel + " feelings");
  return bits.join(" · ");
}

function timeAgo(ts){
  const min = Math.floor((Date.now() - ts) / 60000);
  if (min < 1) return "just now";
  if (min < 60) return min + " min ago";
  const h = Math.floor(min / 60);
  return h < 24 ? plural(h, "hour", "hours") + " ago" : plural(Math.floor(h / 24), "day", "days") + " ago";
}

// Only the most recent idea (that matches the filters), large.
function renderLatest(ideas, model, state){
  const idea = ideas.slice().sort((a, b) => b.ts - a.ts)[0];
  if (!idea) return null;
  const area = AREA[idea.area];
  const stack = model.stacks.find(x => x.root.id === (model.rootOf[idea.id] || idea.id));
  const isNew = latestShownId !== idea.id;
  latestShownId = idea.id;
  const label = filterLabel(state);
  const parent = idea.parentId && Store.ideas().find(i => i.id === idea.parentId && !i.hidden);
  return (
    '<div class="note latest-note' + (isNew ? ' arrive' : '') + '" data-area="' + idea.area + '" data-id="' +
      escapeHtml(idea.id) + '" data-size="1" role="button" tabindex="0">' +
      '<p class="latest-label">Most recent idea' + (label ? ' · ' + escapeHtml(label) : '') + ' · ' + timeAgo(idea.ts) + '</p>' +
      (parent ? '<p class="latest-parent">Building on: “' + escapeHtml(parent.text) + '”</p>' : '') +
      '<p class="latest-text">' + escapeHtml(idea.text) + '</p>' +
      (idea.name ? '<p class="latest-by">' + escapeHtml(idea.name) + '</p>' : '') +
      '<div class="note-meta">' +
        dotsHtml(stack ? stack.support : idea.votes) +
        (stack && stack.size > 1 ? '<span class="depth">×' + stack.size + '</span>' : '') +
        (idea.feeling ? '<span class="feeling">' + escapeHtml(FEELING[idea.feeling].name) + '</span>' : '') +
        '<span class="area">' + escapeHtml(idea.sample ? "Sample · " + area.short : area.name) + '</span>' +
      '</div>' +
    '</div>'
  );
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
  lastModel = model;
  // Filters narrow what is drawn; the pop-ups still see every idea.
  const filtering = !!(s.area || s.feel);
  const shownIdeas = filtering ? visible.filter(i => matchesFilters(i, s)) : visible;
  const shownModel = filtering ? Stacks.build(shownIdeas, Store.fresh) : model;
  const stacks = s.stacked ? shownModel.stacks : Stacks.explode(shownModel.stacks, Store.fresh);

  // An idea picked in "Find my idea" is outlined and sits at the top for a while, like a new one.
  const now = Date.now();
  for (const x of stacks){
    const t = spotlit.get(x.root.id);
    if (t && now - t < Stacks.FRESH_MS){ x.isFresh = true; x.freshAt = Math.max(x.freshAt, t); x.found = true; }
  }

  // One area picked in the Areas view: that area fills the wall as tiles.
  const layout = (s.view === "columns" && s.area) ? "area" : s.view;
  boardEl.dataset.view = layout;
  boardEl.classList.remove("has-more");

  const empty = filtering
    ? '<p class="board-message">No ideas match ' + escapeHtml(filterLabel(s)) + ' yet.</p>'
    : '<p class="board-message">Waiting for the first idea…</p>';
  if (Store.status() === "error"){
    boardEl.innerHTML = '<p class="board-message">The wall can’t reach its database.<br>' +
      'Check config.js and the internet connection.</p>';
  } else if (layout === "columns"){
    boardEl.innerHTML = renderColumns(stacks, settings);
  } else if (layout === "latest"){
    boardEl.innerHTML = renderLatest(shownIdeas, model, s) || empty;
  } else if (stacks.length === 0){
    boardEl.innerHTML = empty;
  } else {
    boardEl.innerHTML = renderFlow(stacks, layout);
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
  areaFilterEl.value = s.area;
  feelFilterEl.value = s.feel;
  areaFilterEl.classList.toggle("on", !!s.area);
  feelFilterEl.classList.toggle("on", !!s.feel);
  clearFiltersEl.hidden = !filtering;

  // running total, and how many came in today
  const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
  const today = visible.filter(i => i.ts >= midnight.getTime()).length;
  tallyBigEl.textContent = visible.length;
  tallySmallEl.textContent = visible.length === 1 ? "idea so far" : "ideas so far";
  tallyTodayEl.textContent = today + " added today";
  tallyTodayEl.hidden = !(today > 0 && today < visible.length);

  if (isPhoneLayout() || layout === "latest") return;   // phones scroll; Latest is one note
  if (layout === "columns") fitColumns(); else fitFlow();
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

const areaFilterEl = document.getElementById("areaFilter");
const feelFilterEl = document.getElementById("feelFilter");
const clearFiltersEl = document.getElementById("clearFilters");
areaFilterEl.innerHTML = '<option value="">All areas</option>' +
  AREAS.map(a => '<option value="' + a.key + '">' + escapeHtml(a.name) + '</option>').join("");
feelFilterEl.innerHTML = '<option value="">All feelings</option>' +
  '<option value="positive">Positive feelings</option><option value="negative">Negative feelings</option>' +
  '<optgroup label="One feeling">' +
  FEELINGS.map(f => '<option value="' + f.key + '">' + escapeHtml(f.name) + '</option>').join("") + '</optgroup>';
const setFilters = patch => { writeState(patch); render(); wakeViewbar(); };
areaFilterEl.addEventListener("change", () => setFilters({ area: areaFilterEl.value }));
feelFilterEl.addEventListener("change", () => setFilters({ feel: feelFilterEl.value }));
clearFiltersEl.addEventListener("click", () => setFilters({ area: "", feel: "" }));

document.addEventListener("keydown", e => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.target.closest && e.target.closest("input, textarea, select")) return;
  if (!document.getElementById("scrim").hidden) return;   // the pop-up is open
  const k = e.key.toLowerCase();
  const cur = readState().view;
  if (k === "1") setView("columns");
  else if (k === "2") setView("recent");
  else if (k === "3") setView("top");
  else if (k === "4") setView("latest");
  else if (k === "s") toggleStacked();
  else if (k === "a") toggleRotate();
  else if (k === "arrowright") setView(ROTATION[(ROTATION.indexOf(cur) + 1) % ROTATION.length]);
  else if (k === "arrowleft") setView(ROTATION[(ROTATION.indexOf(cur) - 1 + ROTATION.length) % ROTATION.length]);
});

let resizeTimer = null;
window.addEventListener("resize", () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(render, 150); });
// so a facilitator can also drive the wall by editing the address bar
window.addEventListener("hashchange", () => { restartRotation(readState()); render(); });

/* ---------------- pop-ups ---------------- */

const scrimEl = document.getElementById("scrim");
const sheetEl = document.getElementById("sheet");

// On the shared Hub a pop-up someone walked away from closes by itself.
const SHEET_IDLE_SECONDS = 90;

let sheetForm = null, sheetIdle = null, sheetOpener = null;

// Show html in the pop-up. labelId names the element that titles it.
function openSheet(html, labelId){
  if (scrimEl.hidden) sheetOpener = document.activeElement;
  if (sheetForm){ sheetForm.destroy(); sheetForm = null; }
  sheetEl.innerHTML = html;
  sheetEl.setAttribute("aria-labelledby", labelId || "sheetTitle");
  scrimEl.hidden = false;
  sheetEl.scrollTop = 0;
  sheetEl.querySelectorAll("[data-close]").forEach(b => b.addEventListener("click", closeSheet));
  keepSheetAwake();
  return sheetEl;
}

function keepSheetAwake(){
  clearTimeout(sheetIdle);
  if (!isPersonalScreen()) sheetIdle = setTimeout(closeSheet, SHEET_IDLE_SECONDS * 1000);
}

function closeSheet(){
  clearTimeout(sheetIdle);
  if (sheetForm) sheetForm.destroy();
  sheetForm = null;
  scrimEl.hidden = true;
  sheetEl.innerHTML = "";
  const back = sheetOpener && document.contains(sheetOpener) ? sheetOpener : document.getElementById("addBtn");
  sheetOpener = null;
  back.focus({ preventScroll: true });
}

["pointerdown", "keydown", "input"].forEach(ev => sheetEl.addEventListener(ev, keepSheetAwake, { passive: true }));
scrimEl.addEventListener("click", e => { if (e.target === scrimEl) closeSheet(); });
document.addEventListener("keydown", e => { if (e.key === "Escape" && !scrimEl.hidden) closeSheet(); });

/* ---------------- "Add your idea" / "Build on this idea" ---------------- */

// parent: {id, text, area} to build on an idea, or nothing for a new one.
// The Hub is shared: no remembered names or drafts, and the pop-up closes
// itself shortly after posting so the next person starts fresh.
function openAdd(parent){
  const personal = isPersonalScreen();
  openSheet("", "afTitle");
  sheetForm = AddForm.mount(sheetEl, {
    parent: parent || null,
    source: personal ? "phone" : "hub",
    rememberName: personal,
    keepDraft: false,
    resetAfter: personal ? 0 : 12,
    idleReset: personal ? 0 : 120,
    onClose: closeSheet,
    // demo mode keeps everything in this browser
    post: Store.isDemo()
      ? row => { Store.demoAdd(row); return Promise.resolve("sent"); }
      : (row, followup) => Outbox.send(row, followup)
  });
}

document.getElementById("addBtn").addEventListener("click", () => openAdd());
document.getElementById("findBtn").addEventListener("click", () => openFind());

// Tap (or Enter on) any note to open its details.
boardEl.addEventListener("click", e => {
  const note = e.target.closest(".note");
  if (note) openDetail(note.dataset.id);
});
boardEl.addEventListener("keydown", e => {
  const note = e.target.closest(".note");
  if (note && (e.key === "Enter" || e.key === " ")){ e.preventDefault(); openDetail(note.dataset.id); }
});

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
