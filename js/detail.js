/* ============================================================
   Pop-ups on the wall: an idea's details (with Support and Build on this
   idea) and Find my idea. Uses openSheet, lastModel, spotlit and the
   helpers in js/wall.js.
   ============================================================ */

/* ---------------- support ---------------- */

// One support per idea per device. A personal phone keeps that for good.
// The Hub is shared by everyone at the booth, so there it only blocks the
// same idea for 30 seconds: enough to stop a double tap counting twice.
const SUPPORT_COOLDOWN_MS = 30 * 1000;
const SUPPORT_KEY = "ideawall:supported:v1";
const supportedHere = new Map();   // backup for browsers that block storage

function supportedMap(){
  try { return JSON.parse(localStorage.getItem(SUPPORT_KEY)) || {}; } catch (e) { return {}; }
}
function setSupported(id, when){
  if (when) supportedHere.set(id, when); else supportedHere.delete(id);
  try {
    const m = supportedMap();
    if (when) m[id] = when; else delete m[id];
    localStorage.setItem(SUPPORT_KEY, JSON.stringify(m));
  } catch (e) {}
}
function supportBlocked(id){
  const t = Math.max(supportedMap()[id] || 0, supportedHere.get(id) || 0);
  if (!t) return false;
  return isPersonalScreen() || Date.now() - t < SUPPORT_COOLDOWN_MS;
}

// Adds one support through the database's support_idea() function (the
// only way the public can change votes). Resolves true if it counted.
async function supportIdea(id){
  if (supportBlocked(id)) return false;
  setSupported(id, Date.now());            // first, so a quick double tap cannot count twice
  const idea = Store.ideas().find(i => i.id === id);
  if (Store.isDemo()){
    Store.patchLocal(id, { votes: (idea ? idea.votes : 0) + 1 });
    return true;
  }
  try {
    const { data, error } = await DB.client().rpc("support_idea", { idea_id: id });
    if (error || data == null) throw error || new Error("idea not found");
    Store.patchLocal(id, { votes: data });  // Realtime confirms it a moment later
    return true;
  } catch (e) {
    console.warn("Idea wall: support failed", e);
    setSupported(id, 0);
    return false;
  }
}

/* ---------------- idea details ---------------- */

function memberHtml(m){
  const bits = [m.name, m.feeling ? "Feels " + FEELING[m.feeling].name.toLowerCase() : ""].filter(Boolean);
  return '<li><p>' + escapeHtml(m.text) + '</p>' +
    (bits.length ? '<small>' + escapeHtml(bits.join(" · ")) + '</small>' : '') +
    Facil.memberButtons(m) + '</li>';
}

// id: any idea's id; the pop-up shows the whole stack it belongs to.
function openDetail(id){
  if (!lastModel) return;
  const rootId = lastModel.rootOf[id] || id;
  const s = lastModel.stacks.find(x => x.root.id === rootId);
  if (!s) return;
  const lead = s.root, area = AREA[s.area];
  const others = s.members.filter(m => m !== lead);
  const similar = others.filter(m => !m.parentId && !m.stackId);
  const replies = others.filter(m => m.parentId && !m.stackId);
  const grouped = others.filter(m => m.stackId);
  const byBits = [lead.name, lead.feeling ? "Feels " + FEELING[lead.feeling].name.toLowerCase() : ""].filter(Boolean);
  const blocked = supportBlocked(rootId);

  const supportLine = n => n ? plural(n, "person supports", "people support") + " this" : "No supporters yet";

  const sheet = openSheet(
    '<div class="detail" data-area="' + s.area + '">' +
      '<button type="button" class="sheet-close" data-close aria-label="Close">×</button>' +
      '<p class="detail-area"><span class="swatch"></span>' + escapeHtml(area.name) +
        (lead.sample ? ' · Sample idea' : '') + '</p>' +
      '<h2 class="detail-text" id="sheetTitle">' + escapeHtml(lead.text) + '</h2>' +
      (byBits.length ? '<p class="detail-by">' + escapeHtml(byBits.join(" · ")) + '</p>' : '') +
      '<div class="detail-support"><span class="detail-dots">' + dotsHtml(s.support) + '</span>' +
        '<span class="detail-count">' + supportLine(s.support) + '</span></div>' +
      '<div class="af-actions">' +
        '<button type="button" class="af-post" id="supportBtn"' + (blocked ? ' disabled' : '') + '>' +
          (blocked ? "Support counted" : "Support this idea") + '</button>' +
        '<button type="button" class="af-secondary" id="buildBtn">Build on this idea</button>' +
      '</div>' +
      (similar.length ? '<h3 class="detail-h">' + (similar.length === 1 ? "1 more person said something similar"
        : similar.length + " more people said something similar") + '</h3><ul class="members">' + similar.map(memberHtml).join("") + '</ul>' : '') +
      (replies.length ? '<h3 class="detail-h">Built on this idea (' + replies.length + ')</h3><ul class="members">' +
        replies.map(memberHtml).join("") + '</ul>' : '') +
      (grouped.length ? '<h3 class="detail-h">Grouped here by a facilitator (' + grouped.length + ')</h3><ul class="members">' +
        grouped.map(memberHtml).join("") + '</ul>' : '') +
      Facil.detailTools(s) +
    '</div>'
  );
  Facil.wireDetail(sheet, s);

  const btn = sheet.querySelector("#supportBtn");
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    btn.textContent = "Counting…";
    const ok = await supportIdea(rootId);
    if (!ok){
      btn.disabled = supportBlocked(rootId);
      btn.textContent = btn.disabled ? "Support counted" : "Support this idea";
      if (!btn.disabled) showToast("That support didn’t count. Check the connection and try again.", true);
      return;
    }
    btn.textContent = "Thanks: support counted";
    sheet.querySelector(".detail-dots").innerHTML = dotsHtml(s.support + 1);
    sheet.querySelector(".detail-count").textContent = supportLine(s.support + 1);
    // the Hub lets the next person support it after the cooldown
    if (!isPersonalScreen()) setTimeout(() => {
      if (sheet.contains(btn)){ btn.disabled = false; btn.textContent = "Support this idea"; }
    }, SUPPORT_COOLDOWN_MS);
  });

  sheet.querySelector("#buildBtn").addEventListener("click", () =>
    openAdd({ id: rootId, text: lead.text, area: s.area }));

  sheet.querySelector(".sheet-close").focus();
}

/* ---------------- find my idea ---------------- */

function openFind(){
  const sheet = openSheet(
    '<div class="find">' +
      '<button type="button" class="sheet-close" data-close aria-label="Close">×</button>' +
      '<h2 class="af-title" id="sheetTitle">Find my idea</h2>' +
      '<label class="af-label" for="findQ">Type a word from your idea, or your name</label>' +
      '<div class="af"><input id="findQ" type="text" autocomplete="off" spellcheck="false" enterkeyhint="search"></div>' +
      '<ul class="find-results" id="findR" aria-live="polite"></ul>' +
    '</div>'
  );
  const q = sheet.querySelector("#findQ");
  const out = sheet.querySelector("#findR");

  const run = () => {
    const t = q.value.trim().toLowerCase();
    if (t.length < 2){ out.innerHTML = '<li class="find-hint">Results appear as you type.</li>'; return; }
    const hits = Store.ideas()
      .filter(i => !i.hidden && (i.text.toLowerCase().includes(t) || i.name.toLowerCase().includes(t)))
      .sort((a, b) => b.ts - a.ts)
      .slice(0, 20);
    out.innerHTML = hits.length ? hits.map(i =>
      '<li><button type="button" data-open="' + escapeHtml(i.id) + '" data-area="' + i.area + '">' +
        escapeHtml(i.text) +
        '<small>' + escapeHtml(AREA[i.area].name + (i.name ? " · " + i.name : "")) + '</small>' +
      '</button></li>').join("")
      : '<li class="find-hint">No ideas match that yet. Try another word.</li>';
  };
  q.addEventListener("input", run);
  run();

  out.addEventListener("click", e => {
    const b = e.target.closest("[data-open]");
    if (!b) return;
    const rootId = (lastModel && lastModel.rootOf[b.dataset.open]) || b.dataset.open;
    const s = lastModel && lastModel.stacks.find(x => x.root.id === rootId);
    // outline it on the wall, at the top of its column, for two minutes
    spotlit.set(rootId, Date.now());
    if (s) offsets.set(s.area, 0);
    render();
    openDetail(rootId);
  });

  setTimeout(() => q.focus(), 60);
}
