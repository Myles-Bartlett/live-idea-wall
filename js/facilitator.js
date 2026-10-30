/* ============================================================
   Facilitator mode: sign in, curate the wall, export.

   Sign in with a Supabase account (email + password) from the gear icon.
   Only accounts listed in the `facilitators` table get in; the database
   enforces that on every change, so this file only decides what to show.

   Signed in, a facilitator can:
     - tap a note: edit its text and area, hide it, move its stack, split it
     - drag a note onto another note to stack them, or onto a column to move it
     - open the panel: rotating notes, "Something else" column, hidden ideas,
       sample ideas, and export (CSV / JSON, with feelings and follow-up emails)
   Facilitator mode signs itself out after 10 idle minutes.

   Demo mode (?demo) skips sign-in and changes only this browser's copy.
   Uses openSheet, closeSheet, openDetail, showToast, lastModel and render
   from js/wall.js and js/detail.js.
   ============================================================ */

const Facil = (() => {
  const IDLE_SIGN_OUT_MS = 10 * 60 * 1000;
  const MODERATION = "Hide personal attacks and identifiable complaints about individuals. " +
                     "Do not hide criticism of policy.";

  let active = false;
  let who = "";
  let lastActivity = Date.now();
  const stripEl = document.getElementById("facilStrip");

  const client = () => DB.client();
  const demo = () => Store.isDemo();

  /* ---------------- entering and leaving ---------------- */

  function enter(label){
    active = true;
    who = label;
    lastActivity = Date.now();
    document.body.classList.add("facil");
    stripEl.hidden = false;
    stripEl.querySelector(".facil-who").textContent = label;
    render();
  }

  function leave(message){
    if (!active) return;
    active = false;
    document.body.classList.remove("facil");
    stripEl.hidden = true;
    closeSheet();
    render();
    if (message) showToast(message, false);
  }

  async function signOut(message){
    if (!demo() && client()) await client().auth.signOut();
    leave(message || "Signed out of facilitator mode.");
  }

  // Is this signed-in account on the facilitators list?
  async function checkFacilitator(user){
    const { data, error } = await client().from("facilitators").select("user_id").eq("user_id", user.id).maybeSingle();
    return !error && !!data;
  }

  // Already signed in from earlier on this screen? Pick the session back up.
  async function resume(){
    if (demo() || !client()) return;
    const { data } = await client().auth.getSession();
    const user = data && data.session && data.session.user;
    if (user && await checkFacilitator(user)) enter(user.email);
  }

  /* ---------------- sign in ---------------- */

  function openSignIn(){
    if (demo()){ enter("Demo facilitator"); openPanel(); return; }
    const sheet = openSheet(
      '<div class="find">' +
        '<button type="button" class="sheet-close" data-close aria-label="Close">×</button>' +
        '<h2 class="af-title" id="sheetTitle">Facilitator sign-in</h2>' +
        '<form class="af" id="signInForm" novalidate>' +
          '<div class="af-field"><label class="af-label" for="facEmail">Email</label>' +
            '<input id="facEmail" type="email" autocomplete="username" autocapitalize="off" spellcheck="false"></div>' +
          '<div class="af-field"><label class="af-label" for="facPass">Password</label>' +
            '<input id="facPass" type="password" autocomplete="current-password"></div>' +
          '<p class="af-error" id="facErr" role="alert" hidden></p>' +
          '<button type="submit" class="af-post">Sign in</button>' +
        '</form>' +
        '<p class="af-help">Only people added as facilitators can sign in. Facilitator mode signs itself out after 10 idle minutes.</p>' +
      '</div>'
    );
    const form = sheet.querySelector("#signInForm");
    const errEl = sheet.querySelector("#facErr");
    const fail = msg => { errEl.textContent = msg; errEl.hidden = false; };
    form.addEventListener("submit", async e => {
      e.preventDefault();
      const email = sheet.querySelector("#facEmail").value.trim();
      const password = sheet.querySelector("#facPass").value;
      if (!email || !password) return fail("Enter your email and password.");
      const btn = form.querySelector(".af-post");
      btn.disabled = true; btn.textContent = "Signing in…";
      const { data, error } = await client().auth.signInWithPassword({ email, password });
      btn.disabled = false; btn.textContent = "Sign in";
      if (error || !data.user) return fail("That email and password didn’t match.");
      if (!await checkFacilitator(data.user)){
        await client().auth.signOut();
        return fail("This account isn’t on the facilitator list yet. Ask Myles to add it.");
      }
      enter(data.user.email);
      openPanel();
    });
    setTimeout(() => sheet.querySelector("#facEmail").focus(), 60);
  }

  /* ---------------- changing ideas ---------------- */

  // patch uses database column names. Shows the change here at once; every
  // other screen gets it through Realtime. Resolves true if it saved.
  async function updateIdea(id, patch){
    if (!demo()){
      const { data, error } = await client().from("ideas").update(patch).eq("id", id).select("id");
      if (error || !data || !data.length){
        console.warn("Idea wall: update refused", error, patch);
        showToast(saveProblem(error), true);
        return false;
      }
    }
    Store.patchRow(id, patch);
    return true;
  }

  // A plain-English reason a change did not save.
  function saveProblem(error){
    if (!error) return "That didn’t save: the database says this account can’t change it. Try signing out and in again.";
    if (error.code === "23514") return "That change isn’t allowed (check the text length).";
    if (error.code === "42703" || error.code === "PGRST204")
      return "That didn’t save: the database is missing an update. Run supabase/003-facilitator-stacks.sql in Supabase.";
    if (!error.code) return "That didn’t save: no connection to the database. Check the internet and try again.";
    return "That didn’t save (" + error.code + "). Try signing out and in again.";
  }

  // Taking an idea out of its stack. Only mention stack_id when it is set,
  // so moving and splitting work even before update 3 has been run.
  function detach(idea, extra){
    const patch = Object.assign({ parent_id: null, solo: true }, extra || {});
    if (idea && idea.stackId) patch.stack_id = null;
    return patch;
  }
  const updateAll = (ids, patch) => Promise.all(ids.map(id => updateIdea(id, patch))).then(r => r.every(Boolean));

  const stackOf = id => {
    if (!lastModel) return null;
    const rootId = lastModel.rootOf[id] || id;
    return lastModel.stacks.find(s => s.root.id === rootId) || null;
  };

  // Move a whole stack to another area. Its members travel with it.
  async function moveStack(rootId, area){
    const s = stackOf(rootId);
    if (!s || s.area === area) return;
    if (await updateAll(s.members.map(m => m.id), { area })){
      offsets.set(area, 0);
      showToast("Moved to " + AREA[area].name + ".", false);
    }
  }

  // Take one idea out of its stack, and keep auto-stacking from pulling it back.
  const split = id => updateIdea(id, detach(Store.ideas().find(i => i.id === id)));

  // Put these ideas into the stack led by toRootId.
  async function mergeInto(ids, toRootId){
    const target = stackOf(toRootId);
    if (!target) return;
    const moving = ids.filter(id => id !== target.root.id);
    if (await updateAll(moving, { stack_id: target.root.id, area: target.area, solo: false })){
      showToast("Stacked. Tap the stack to split it again.", false);
    }
  }

  /* ---------------- tools in the idea pop-up (called by js/detail.js) ---------------- */

  function memberButtons(m){
    if (!active) return "";
    return '<span class="facil-row">' +
      '<button type="button" class="facil-btn" data-edit="' + escapeHtml(m.id) + '">Edit</button>' +
      '<button type="button" class="facil-btn" data-split="' + escapeHtml(m.id) + '">Split out</button>' +
      '<button type="button" class="facil-btn" data-hide="' + escapeHtml(m.id) + '">Hide</button>' +
    '</span>';
  }

  function detailTools(s){
    if (!active) return "";
    return '<section class="facil-tools" aria-label="Facilitator tools">' +
      '<h3 class="detail-h">Facilitator</h3>' +
      '<p class="af-help">' + MODERATION + '</p>' +
      '<div class="facil-row">' +
        '<button type="button" class="facil-btn" data-edit="' + escapeHtml(s.root.id) + '">Edit text and area</button>' +
        '<button type="button" class="facil-btn" data-hide="' + escapeHtml(s.root.id) + '">Hide this idea</button>' +
        (s.size > 1 ? '<button type="button" class="facil-btn" id="hideStack">Hide the whole stack</button>' : '') +
        (s.size > 1 ? '<button type="button" class="facil-btn" id="splitStack">Split the stack apart</button>' : '') +
      '</div>' +
      '<p class="af-help">Move ' + (s.size > 1 ? "this stack" : "this idea") + ' to:</p>' +
      '<div class="facil-row">' + AREAS.map(a =>
        '<button type="button" class="facil-chip" data-area="' + a.key + '" data-move="' + a.key + '" aria-pressed="' +
          (a.key === s.area) + '">' + escapeHtml(a.short) + '</button>').join("") +
      '</div>' +
    '</section>';
  }

  function wireDetail(sheet, s){
    if (!active) return;
    const reopen = () => { if (!scrimEl.hidden) openDetail(s.root.id); };
    sheet.querySelectorAll("[data-edit]").forEach(b => b.addEventListener("click", () => openEdit(b.dataset.edit)));
    sheet.querySelectorAll("[data-split]").forEach(b => b.addEventListener("click", async () => { await split(b.dataset.split); reopen(); }));
    sheet.querySelectorAll("[data-hide]").forEach(b => b.addEventListener("click", async () => {
      if (!await updateIdea(b.dataset.hide, { hidden: true })) return;
      showToast("Hidden. Show it again from the facilitator panel.", false);
      if (b.dataset.hide === s.root.id) closeSheet(); else reopen();
    }));
    const hideStack = sheet.querySelector("#hideStack");
    if (hideStack) hideStack.addEventListener("click", async () => {
      if (!await updateAll(s.members.map(m => m.id), { hidden: true })) return;
      closeSheet(); showToast("Stack hidden. Show it again from the facilitator panel.", false);
    });
    const splitStack = sheet.querySelector("#splitStack");
    if (splitStack) splitStack.addEventListener("click", async () => {
      await Promise.all(s.members.filter(m => m !== s.root).map(m => split(m.id)));
      closeSheet(); showToast("Stack split apart.", false);
    });
    sheet.querySelectorAll("[data-move]").forEach(b => b.addEventListener("click", async () => {
      await moveStack(s.root.id, b.dataset.move); closeSheet();
    }));
  }

  /* ---------------- edit text and area ---------------- */

  function openEdit(id){
    const idea = Store.ideas().find(i => i.id === id);
    if (!idea) return;
    const s = stackOf(id);
    const isLead = s && s.root.id === id;
    let area = idea.area;
    const sheet = openSheet(
      '<div class="find">' +
        '<button type="button" class="sheet-close" data-close aria-label="Close">×</button>' +
        '<h2 class="af-title" id="sheetTitle">Edit idea</h2>' +
        '<form class="af" id="editForm" novalidate>' +
          '<div class="af-field"><label class="af-label" for="editText">Idea text</label>' +
            '<textarea id="editText" maxlength="280" rows="4"></textarea>' +
            '<p class="af-help">Fix typos or trim it, but keep the contributor’s meaning.</p>' +
            '<p class="af-error" id="editErr" hidden></p></div>' +
          '<fieldset class="af-field"><legend class="af-label">Area</legend><div class="af-chips">' +
            AREAS.map(a => '<button type="button" class="af-chip" data-area="' + a.key + '" aria-pressed="' +
              (a.key === area) + '">' + escapeHtml(a.name) + '</button>').join("") + '</div>' +
            (s && s.size > 1 ? '<p class="af-help">' + (isLead
              ? "Changing the area moves the whole stack."
              : "Changing the area takes this idea out of its stack.") + '</p>' : '') +
          '</fieldset>' +
          '<button type="submit" class="af-post">Save changes</button>' +
          '<button type="button" class="af-secondary" id="editCancel">Cancel</button>' +
        '</form>' +
      '</div>'
    );
    const text = sheet.querySelector("#editText");
    text.value = idea.text;
    sheet.querySelectorAll(".af-chip").forEach(c => c.addEventListener("click", () => {
      area = c.dataset.area;
      sheet.querySelectorAll(".af-chip").forEach(x => x.setAttribute("aria-pressed", x === c ? "true" : "false"));
    }));
    const back = () => openDetail(s ? s.root.id : id);
    sheet.querySelector("#editCancel").addEventListener("click", back);
    sheet.querySelector("#editForm").addEventListener("submit", async e => {
      e.preventDefault();
      const newText = text.value.replace(/\s+/g, " ").trim();
      const err = sheet.querySelector("#editErr");
      if (newText.length < 3 || newText.length > 280){
        err.textContent = "Keep it between 3 and 280 characters."; err.hidden = false; return;
      }
      if (newText !== idea.text && !await updateIdea(id, { text: newText })) return;
      if (area !== idea.area){
        if (isLead) await moveStack(id, area);
        else await updateIdea(id, detach(idea, { area }));
      }
      showToast("Saved.", false);
      back();
    });
    setTimeout(() => text.focus(), 60);
  }

  /* ---------------- drag a note onto another (or onto a column) ---------------- */

  let drag = null, justDragged = false;

  function clearDropMarks(){
    document.querySelectorAll(".drop-target").forEach(el => el.classList.remove("drop-target"));
  }

  // What letting go here would do. Stacking needs the finger squarely on a
  // note (its middle part); anywhere else in a column moves to that area.
  function dropAction(x, y, d){
    const under = document.elementFromPoint(x, y);
    if (!under) return null;
    const from = stackOf(d.id);
    const note = under.closest(".note:not(.lifted)");
    if (note){
      const r = note.getBoundingClientRect();
      const middle = y > r.top + r.height * 0.2 && y < r.bottom - r.height * 0.2;
      const to = stackOf(note.dataset.id);
      if (middle && to && (!from || to.root.id !== from.root.id)) return { kind: "stack", el: note, to };
    }
    const column = under.closest(".column");
    if (column && from && column.dataset.area !== from.area) return { kind: "move", el: column, area: column.dataset.area };
    return null;
  }

  boardEl.addEventListener("pointerdown", e => {
    if (!active || e.button !== 0) return;
    const note = e.target.closest(".note");
    if (!note || note.classList.contains("latest-note")) return;
    drag = { id: note.dataset.id, el: note, x: e.clientX, y: e.clientY, moving: false, ghost: null, hint: null };
  });

  window.addEventListener("pointermove", e => {
    if (!drag) return;
    if (!drag.moving){
      if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 14) return;   // still a tap
      const r = drag.el.getBoundingClientRect();
      drag.moving = true;
      drag.ox = e.clientX - r.left; drag.oy = e.clientY - r.top;
      drag.ghost = drag.el.cloneNode(true);
      drag.ghost.classList.add("drag-ghost");
      drag.ghost.style.width = r.width + "px";
      document.body.appendChild(drag.ghost);
      drag.hint = document.createElement("div");
      drag.hint.className = "drag-hint";
      document.body.appendChild(drag.hint);
      drag.el.classList.add("lifted");
    }
    drag.ghost.style.transform = "translate(" + (e.clientX - drag.ox) + "px," + (e.clientY - drag.oy) + "px)";
    drag.hint.style.transform = "translate(" + (e.clientX + 18) + "px," + (e.clientY + 22) + "px)";
    clearDropMarks();
    const act = dropAction(e.clientX, e.clientY, drag);
    if (act) act.el.classList.add("drop-target");
    // say what will happen before the finger lifts
    drag.hint.textContent = !act ? "Drop on a column to move, or on the middle of a note to stack"
      : act.kind === "stack" ? "Stack with this idea"
      : "Move to " + AREA[act.area].name;
    drag.hint.classList.toggle("ready", !!act);
  });

  function endDrag(e, cancelled){
    if (!drag) return;
    const d = drag;
    drag = null;
    if (!d.moving) return;          // a tap: the click opens the pop-up as usual
    const act = cancelled ? null : dropAction(e.clientX, e.clientY, d);
    d.ghost.remove();
    d.hint.remove();
    d.el.classList.remove("lifted");
    clearDropMarks();
    justDragged = true;
    setTimeout(() => { justDragged = false; }, 60);

    const from = stackOf(d.id);
    const stacked = readState().stacked;
    // stacked view: the whole stack goes; unstacked view: just that idea
    if (act && act.kind === "stack"){
      mergeInto(stacked && from ? from.members.map(m => m.id) : [d.id], act.to.root.id);
    } else if (act && act.kind === "move"){
      if (stacked && from) moveStack(from.root.id, act.area);
      else updateIdea(d.id, detach(Store.ideas().find(i => i.id === d.id), { area: act.area }))
        .then(ok => { if (ok) showToast("Moved to " + AREA[act.area].name + ".", false); });
    }
    render();
  }
  window.addEventListener("pointerup", e => endDrag(e, false));
  window.addEventListener("pointercancel", e => endDrag(e, true));

  /* ---------------- the panel ---------------- */

  function openPanel(){
    if (!active){ openSignIn(); return; }
    const st = Store.settings();
    const all = Store.ideas();
    const hidden = all.filter(i => i.hidden).sort((a, b) => b.ts - a.ts);
    const samples = all.filter(i => i.sample).length;

    const sheet = openSheet(
      '<div class="find facil-panel">' +
        '<button type="button" class="sheet-close" data-close aria-label="Close">×</button>' +
        '<h2 class="af-title" id="sheetTitle">Facilitator panel</h2>' +
        '<p class="af-help">Signed in as <strong>' + escapeHtml(who) + '</strong>. ' +
          (demo() ? "Demo mode: changes stay in this browser." : "Changes reach every screen within a second or two.") + '</p>' +
        '<p class="facil-rule"><strong>Moderation:</strong> ' + MODERATION + '</p>' +

        '<h3 class="detail-h"><label for="notesT">Facilitators’ notes</label></h3>' +
        '<p class="af-help">One per line. They rotate along the bottom of the wall.</p>' +
        '<div class="af"><textarea id="notesT" rows="5"></textarea></div>' +
        '<button type="button" class="facil-btn" id="saveNotes">Save notes</button>' +

        '<h3 class="detail-h">“Something else” column</h3>' +
        '<label class="facil-switch"><input type="checkbox" id="showOther"' + (st.showOther ? " checked" : "") + '> ' +
          'Show the “Something else” column (once it has ideas)</label>' +

        '<h3 class="detail-h">Hidden ideas (' + hidden.length + ')</h3>' +
        (hidden.length ? '<ul class="members">' + hidden.slice(0, 50).map(i =>
          '<li><p>' + escapeHtml(i.text) + '</p><small>' + escapeHtml(AREA[i.area].name + (i.name ? " · " + i.name : "")) + '</small>' +
          '<span class="facil-row"><button type="button" class="facil-btn" data-unhide="' + escapeHtml(i.id) + '">Show again</button></span></li>'
        ).join("") + '</ul>' : '<p class="af-help">Nothing hidden.</p>') +

        '<h3 class="detail-h">Sample ideas</h3>' +
        '<p class="af-help">For rehearsals. Every sample is tagged “Sample” on the wall.</p>' +
        (samples
          ? '<button type="button" class="facil-btn" id="removeSamples">Remove all ' + samples + ' sample ideas</button>'
          : '<button type="button" class="facil-btn" id="loadSamples">Load ' + SAMPLE_IDEAS.length + ' sample ideas</button>') +

        '<h3 class="detail-h">Export</h3>' +
        '<p class="af-help">Every idea, including hidden ones, with feelings, support and follow-up emails. ' +
          'The emails are private: store the file carefully.</p>' +
        '<div class="facil-row">' +
          '<button type="button" class="facil-btn" id="exportCsv">Download CSV (Excel)</button>' +
          '<button type="button" class="facil-btn" id="exportJson">Download JSON</button>' +
        '</div>' +

        '<div class="af-actions"><button type="button" class="af-secondary" id="facilOut">Sign out of facilitator mode</button></div>' +
      '</div>'
    );

    sheet.querySelector("#notesT").value = (st.notes || []).join("\n");
    sheet.querySelector("#saveNotes").addEventListener("click", async () => {
      const notes = sheet.querySelector("#notesT").value.split("\n").map(l => l.trim()).filter(Boolean);
      if (await saveSettings({ notes })) showToast("Notes saved.", false);
    });
    sheet.querySelector("#showOther").addEventListener("change", e => saveSettings({ show_other: e.target.checked }));
    sheet.querySelectorAll("[data-unhide]").forEach(b => b.addEventListener("click", async () => {
      if (await updateIdea(b.dataset.unhide, { hidden: false })) openPanel();
    }));
    const load = sheet.querySelector("#loadSamples");
    if (load) load.addEventListener("click", async () => { load.disabled = true; await loadSamples(); openPanel(); });
    const remove = sheet.querySelector("#removeSamples");
    if (remove) remove.addEventListener("click", async () => {
      if (!confirm("Remove every sample idea from the wall? Real ideas are not touched.")) return;
      remove.disabled = true; await removeSamples(); openPanel();
    });
    sheet.querySelector("#exportCsv").addEventListener("click", () => exportIdeas("csv"));
    sheet.querySelector("#exportJson").addEventListener("click", () => exportIdeas("json"));
    sheet.querySelector("#facilOut").addEventListener("click", () => signOut());
  }

  async function saveSettings(patch){
    if (!demo()){
      const { data, error } = await client().from("settings").update(patch).eq("id", 1).select("id");
      if (error || !data || !data.length){
        showToast(saveProblem(error), true);
        return false;
      }
    }
    Store.patchSettingsLocal(patch);
    return true;
  }

  /* ---------------- sample ideas ---------------- */

  async function loadSamples(){
    const rows = SAMPLE_IDEAS.map(([area, text, name], i) => ({
      text, area, name: name || null, is_sample: true, source: "sample",
      feeling: i % 3 === 2 ? null : FEELINGS[(i * 5) % FEELINGS.length].key
    }));
    if (demo()){
      rows.forEach(r => Store.demoAdd(Object.assign({ id: Outbox.newId() }, r)));
    } else {
      const { error } = await client().from("ideas").insert(rows);
      if (error){ showToast("Samples didn’t load. You may need to sign in again.", true); return; }
    }
    showToast(rows.length + " sample ideas loaded.", false);
  }

  async function removeSamples(){
    const ids = Store.ideas().filter(i => i.sample).map(i => i.id);
    if (!demo()){
      const { error } = await client().from("ideas").delete().eq("is_sample", true);
      if (error){ showToast("Samples weren’t removed. You may need to sign in again.", true); return; }
    }
    ids.forEach(id => Store.removeLocal(id));
    showToast("Sample ideas removed.", false);
  }

  /* ---------------- export ---------------- */

  async function exportIdeas(format){
    const emails = {};
    if (!demo()){
      const { data, error } = await client().from("followups").select("idea_id, email");
      if (error){ showToast("Couldn’t read the follow-up emails. Exporting without them.", true); }
      else data.forEach(r => { emails[r.idea_id] = r.email; });
    }
    const rootOf = (lastModel && lastModel.rootOf) || {};
    const rows = Store.ideas().sort((a, b) => a.ts - b.ts).map(i => ({
      id: i.id,
      created_at: new Date(i.ts).toISOString(),
      area: AREA[i.area].name,
      text: i.text,
      name: i.name,
      feeling: i.feeling ? FEELING[i.feeling].name : "",
      feeling_tone: i.feeling ? FEELING[i.feeling].tone : "",
      support: i.votes,
      stack: rootOf[i.id] || i.id,
      reply_to: i.parentId || "",
      grouped_by_facilitator: i.stackId ? "yes" : "",
      hidden: i.hidden ? "yes" : "",
      sample: i.sample ? "yes" : "",
      source: i.source,
      followup_email: emails[i.id] || ""
    }));
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
    let body, type;
    if (format === "json"){
      body = JSON.stringify(rows, null, 2); type = "application/json";
    } else {
      const cols = Object.keys(rows[0] || { id: "" });
      const cell = v => '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"';
      // the leading BOM makes Excel read accents and curly quotes correctly
      body = "﻿" + [cols.join(",")].concat(rows.map(r => cols.map(c => cell(r[c])).join(","))).join("\r\n");
      type = "text/csv";
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([body], { type }));
    a.download = "idea-wall-" + stamp + "." + format;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  /* ---------------- start ---------------- */

  document.getElementById("gearBtn").addEventListener("click", () => active ? openPanel() : openSignIn());
  stripEl.querySelector("#stripPanel").addEventListener("click", openPanel);
  stripEl.querySelector("#stripOut").addEventListener("click", () => signOut());

  ["pointerdown", "keydown"].forEach(ev => window.addEventListener(ev, () => { lastActivity = Date.now(); }, { passive: true }));
  setInterval(() => {
    if (active && Date.now() - lastActivity > IDLE_SIGN_OUT_MS) signOut("Signed out of facilitator mode after 10 idle minutes.");
  }, 30 * 1000);

  if (client() && !demo()){
    client().auth.onAuthStateChange(event => { if (event === "SIGNED_OUT") leave(); });
  }
  // wait for Store to know whether this is demo mode
  setTimeout(resume, 0);

  return {
    active: () => active,
    dragging: () => !!(drag && drag.moving),
    justDragged: () => justDragged,
    detailTools,
    memberButtons,
    wireDetail
  };
})();
