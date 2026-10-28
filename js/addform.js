/* ============================================================
   The "Add your idea" form, then a confirmation screen.

   Used full page on phones and tablets (add.html) and in a pop-up on the
   wall (index.html). One screen: the idea and its area, then three
   optional extras (a feeling, a name, a private email for a follow-up).
   Contributing should take under 60 seconds.

   AddForm.mount(container, options) draws it. Options:
     parent        {id, text, area} to "build on" an idea, or null
     source        saved with the idea: "phone", "kiosk" or "hub"
     rememberName  prefill the name and email next time (personal phones only)
     keepDraft     keep a half-typed idea if the page closes
     post          async (row, followup) => "sent" | "queued"   (default: Outbox.send)
     supportHref   where "Support other ideas" goes (omit to hide it)
     onClose       shows Cancel / "Back to the wall" and is called by them
     resetAfter    seconds after posting before the screen clears itself
     idleReset     seconds of no typing before a half-filled form clears
   ============================================================ */

const AddForm = (() => {
  const SOFT_CAP = 200;   // the counter nudges past this
  const HARD_CAP = 280;   // the database refuses longer
  const MIN = 3;
  const DRAFT_KEY = "ideawall:draft:v1";
  const NAME_KEY = "ideawall:name:v1";
  const EMAIL_KEY = "ideawall:email:v1";
  // Simple shape check; the database checks again.
  const EMAIL_OK = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

  function esc(s){
    return String(s == null ? "" : s).replace(/[&<>"']/g, m => ({
      "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"
    }[m]));
  }
  function read(key){ try { return localStorage.getItem(key); } catch (e) { return null; } }
  function write(key, value){
    try { if (value == null) localStorage.removeItem(key); else localStorage.setItem(key, value); } catch (e) {}
  }
  const tidy = s => String(s || "").replace(/\s+/g, " ").trim();

  function mount(container, options){
    const o = Object.assign({
      parent: null, source: "web", rememberName: true, keepDraft: true,
      post: (row, followup) => Outbox.send(row, followup), supportHref: null, onClose: null,
      resetAfter: 0, idleReset: 0
    }, options);

    let timers = [];
    const later = (fn, ms) => timers.push(setTimeout(fn, ms));
    const clearTimers = () => { timers.forEach(clearTimeout); timers = []; };

    /* ---------------- the form ---------------- */

    function showForm(){
      clearTimers();
      let draft = {};
      try { if (o.keepDraft && !o.parent) draft = JSON.parse(read(DRAFT_KEY) || "null") || {}; } catch (e) {}
      let area = o.parent ? o.parent.area : (draft.area || "");
      let feeling = FEELING[draft.feeling] ? draft.feeling : "";
      const name = o.rememberName ? (draft.name || read(NAME_KEY) || "") : "";
      const email = o.rememberName ? (draft.email || read(EMAIL_KEY) || "") : "";
      const feelingChip = f => '<button type="button" class="af-feel" data-feeling="' + f.key +
        '" aria-pressed="' + (f.key === feeling) + '">' + esc(f.name) + '</button>';

      container.innerHTML =
        '<form class="af" novalidate>' +
          '<h2 class="af-title" id="afTitle">' + (o.parent ? "Build on this idea" : "Add your idea") + '</h2>' +
          (o.parent ? '<blockquote class="af-quote" data-area="' + o.parent.area + '">' + esc(o.parent.text) + '</blockquote>' : '') +

          '<div class="af-field">' +
            '<label class="af-label" for="afText">' + (o.parent ? "Your response" : "Your idea") + '</label>' +
            '<textarea id="afText" maxlength="' + HARD_CAP + '" rows="4" ' +
              'placeholder="One idea, in a sentence or two" aria-describedby="afCount afTextErr"></textarea>' +
            '<div class="af-counter" id="afCount" aria-live="polite"></div>' +
            '<p class="af-error" id="afTextErr" hidden></p>' +
          '</div>' +

          '<fieldset class="af-field">' +
            '<legend class="af-label">Which area does it fit best?</legend>' +
            '<div class="af-chips">' +
              AREAS.map(a => '<button type="button" class="af-chip" data-area="' + a.key + '" aria-pressed="' +
                (a.key === area) + '">' + esc(a.name) + '</button>').join("") +
            '</div>' +
            '<p class="af-error" id="afAreaErr" hidden></p>' +
          '</fieldset>' +

          '<fieldset class="af-field">' +
            '<legend class="af-label">How do you feel about it? <span class="af-optional">(optional)</span></legend>' +
            '<div class="af-feel-group" role="group" aria-label="Positive feelings">' +
              '<span class="af-feel-tone">Positive</span>' +
              FEELINGS.filter(f => f.tone === "positive").map(feelingChip).join("") +
            '</div>' +
            '<div class="af-feel-group" role="group" aria-label="Negative feelings">' +
              '<span class="af-feel-tone">Negative</span>' +
              FEELINGS.filter(f => f.tone === "negative").map(feelingChip).join("") +
            '</div>' +
          '</fieldset>' +

          '<div class="af-field">' +
            '<label class="af-label" for="afName">Your name and college <span class="af-optional">(optional)</span></label>' +
            '<input id="afName" type="text" maxlength="80" autocomplete="name" ' +
              'placeholder="Leave blank to post anonymously">' +
            '<p class="af-help">Shown on the wall with your idea.</p>' +
          '</div>' +

          '<div class="af-field">' +
            '<label class="af-label" for="afEmail">Email for a follow-up <span class="af-optional">(optional)</span></label>' +
            '<input id="afEmail" type="email" maxlength="254" autocomplete="email" inputmode="email" ' +
              'autocapitalize="off" spellcheck="false" placeholder="you@example.com" aria-describedby="afEmailHelp afEmailErr">' +
            '<p class="af-help" id="afEmailHelp">Private: never shown on the wall. Sheridan uses it only to follow up about your idea.</p>' +
            '<p class="af-error" id="afEmailErr" hidden></p>' +
          '</div>' +

          '<p class="af-error" id="afPostErr" role="alert" hidden></p>' +
          '<button type="submit" class="af-post">Post to the wall</button>' +
          (o.onClose ? '<button type="button" class="af-secondary" data-close>Cancel</button>' : '') +
        '</form>';

      const form = container.querySelector("form");
      const text = form.querySelector("#afText");
      const nameEl = form.querySelector("#afName");
      const emailEl = form.querySelector("#afEmail");
      const count = form.querySelector("#afCount");
      const postBtn = form.querySelector(".af-post");
      text.value = o.parent ? "" : (draft.text || "");
      nameEl.value = name;
      emailEl.value = email;

      const err = (id, msg) => {
        const el = form.querySelector("#" + id);
        el.textContent = msg || "";
        el.hidden = !msg;
      };

      const saveDraft = () => {
        if (!o.keepDraft || o.parent) return;
        const d = { text: text.value, area, feeling,
                    name: o.rememberName ? nameEl.value : "", email: o.rememberName ? emailEl.value : "" };
        write(DRAFT_KEY, d.text || d.area || d.feeling ? JSON.stringify(d) : null);
      };

      const updateCount = () => {
        const n = text.value.trim().length;
        if (n > SOFT_CAP){
          count.textContent = n + " / " + HARD_CAP + ": shorter ideas read better from across the room";
          count.classList.add("warn");
        } else {
          count.textContent = n + " / " + SOFT_CAP;
          count.classList.remove("warn");
        }
      };

      // A kiosk clears a half-filled form someone walked away from.
      let idleTimer = null;
      const touched = () => {
        if (!o.idleReset) return;
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => { if (container.contains(form)) showForm(); }, o.idleReset * 1000);
        timers.push(idleTimer);
      };

      text.addEventListener("input", () => { updateCount(); err("afTextErr"); saveDraft(); touched(); });
      nameEl.addEventListener("input", () => { saveDraft(); touched(); });
      emailEl.addEventListener("input", () => { err("afEmailErr"); saveDraft(); touched(); });
      // tap a feeling to choose it, tap it again to clear it
      form.querySelectorAll(".af-feel").forEach(chip => chip.addEventListener("click", () => {
        feeling = feeling === chip.dataset.feeling ? "" : chip.dataset.feeling;
        form.querySelectorAll(".af-feel").forEach(c => c.setAttribute("aria-pressed", c.dataset.feeling === feeling ? "true" : "false"));
        saveDraft(); touched();
      }));
      form.querySelectorAll(".af-chip").forEach(chip => chip.addEventListener("click", () => {
        area = chip.dataset.area;
        form.querySelectorAll(".af-chip").forEach(c => c.setAttribute("aria-pressed", c === chip ? "true" : "false"));
        err("afAreaErr");
        saveDraft(); touched();
      }));
      form.querySelectorAll("[data-close]").forEach(b => b.addEventListener("click", () => { clearTimers(); o.onClose(); }));

      form.addEventListener("submit", async e => {
        e.preventDefault();
        const ideaText = tidy(text.value);
        let firstBad = null;
        if (ideaText.length < MIN){ err("afTextErr", "Add a few words about your idea."); firstBad = firstBad || text; }
        if (!area){ err("afAreaErr", "Choose the area it fits best. Not sure? Pick “Something else”."); firstBad = firstBad || form.querySelector(".af-chip"); }
        const emailText = emailEl.value.trim();
        if (emailText && (!EMAIL_OK.test(emailText) || emailText.length > 254)){
          err("afEmailErr", "That email doesn’t look right. Check it, or leave it blank.");
          firstBad = firstBad || emailEl;
        }
        if (firstBad){ firstBad.focus(); return; }

        const personName = tidy(nameEl.value).slice(0, 80);
        const row = {
          id: Outbox.newId(),
          text: ideaText.slice(0, HARD_CAP),
          area: area,
          name: personName || null,
          parent_id: o.parent ? o.parent.id : null,
          source: o.source
        };
        if (feeling) row.feeling = feeling;
        const followup = emailText ? { idea_id: row.id, email: emailText } : null;

        postBtn.disabled = true;
        postBtn.textContent = "Posting…";
        err("afPostErr");
        try {
          const result = await o.post(row, followup);
          write(DRAFT_KEY, null);
          if (o.rememberName){ write(NAME_KEY, personName || null); write(EMAIL_KEY, emailText || null); }
          showDone(row, result, followup);
        } catch (e) {
          postBtn.disabled = false;
          postBtn.textContent = "Post to the wall";
          err("afPostErr", "That didn’t post. Check your idea and try again.");
        }
      });

      updateCount();
      touched();
      // Phones: no autofocus, so the keyboard does not cover the question.
      if (o.onClose) setTimeout(() => text.focus(), 60);
    }

    /* ---------------- confirmation ---------------- */

    function showDone(row, result, followup){
      clearTimers();
      const a = AREA[row.area];
      const sent = result === "sent";
      container.innerHTML =
        '<div class="af-done" data-area="' + row.area + '" role="status">' +
          '<div class="af-tick" aria-hidden="true"></div>' +
          '<h2 class="af-title" tabindex="-1">' + (sent ? "Your idea is on the wall" : "Saved on this device") + '</h2>' +
          (sent
            ? '<p class="af-where">Look for the outlined note in <strong>' + esc(a.name) + '</strong>.</p>'
            : '<p class="af-where">The connection dropped, so your idea is waiting here. It will post to ' +
              '<strong>' + esc(a.name) + '</strong> on its own as soon as the connection is back. ' +
              'Please keep this page open.</p>') +
          '<blockquote class="af-quote" data-area="' + row.area + '">' + esc(row.text) + '</blockquote>' +
          (followup ? '<p class="af-help">We’ll follow up at ' + esc(followup.email) + '.</p>' : '') +
          '<div class="af-actions">' +
            (o.supportHref ? '<a class="af-post" href="' + esc(o.supportHref) + '">Support other ideas</a>' : '') +
            (o.onClose ? '<button type="button" class="af-post" data-close>Back to the wall</button>' : '') +
            '<button type="button" class="af-secondary" data-again>Add another idea</button>' +
          '</div>' +
          (o.resetAfter ? '<p class="af-countdown" aria-live="off"></p>' : '') +
        '</div>';

      container.querySelector("[data-again]").addEventListener("click", showForm);
      container.querySelectorAll("[data-close]").forEach(b => b.addEventListener("click", () => { clearTimers(); o.onClose(); }));
      container.querySelector(".af-title").focus();

      // A queued idea that sends while this screen is up: say so.
      if (!sent && typeof Outbox !== "undefined"){
        const done = container.querySelector(".af-done");
        Outbox.onChange(() => {
          if (!container.contains(done) || Outbox.isQueued(row.id)) return;
          done.querySelector(".af-title").textContent = "Your idea is on the wall";
          done.querySelector(".af-where").innerHTML = "Look for the outlined note in <strong>" + esc(a.name) + "</strong>.";
        });
      }

      if (o.resetAfter){
        const countdown = container.querySelector(".af-countdown");
        let left = o.resetAfter;
        const tick = () => {
          if (left <= 0){ if (o.onClose) o.onClose(); else showForm(); return; }
          countdown.textContent = "This screen clears in " + left + " s";
          left--;
          later(tick, 1000);
        };
        tick();
      }
    }

    showForm();
    return { reset: showForm, destroy: clearTimers };
  }

  return { mount };
})();
