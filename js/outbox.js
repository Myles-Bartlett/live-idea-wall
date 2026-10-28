/* ============================================================
   Outbox: posts new ideas, and never loses one.

   Every idea goes into a queue saved on this device (localStorage) BEFORE
   it is sent. It leaves the queue only once Supabase has it. If the Wi-Fi
   drops, it waits and tries again: when the browser comes back online,
   every 15 seconds, and whenever a page using this file opens.

   An optional follow-up email queues right behind its idea and goes to the
   private `followups` table, never to the public `ideas` table.

   Each idea gets its id on this device, so a retry of an idea that did in
   fact arrive is recognised as a duplicate and counted as sent.
   ============================================================ */

const Outbox = (() => {
  const KEY = "ideawall:outbox:v1";
  const TIMEOUT_MS = 8000;      // give up on one attempt after this long
  const RETRY_MS = 15000;

  // Database answers that mean "this will never be accepted", so retrying
  // is pointless: a failed check, a missing required value, text too long,
  // a bad id, a missing parent idea, or a security rule saying no.
  // Anything else (network trouble, a database not yet updated) is retried,
  // so an idea is kept rather than thrown away.
  const PERMANENT = new Set(["23514", "23502", "22001", "22P02", "23503", "42501"]);

  const listeners = new Set();
  const rejected = new Set();   // idea ids the database refused
  let flushing = null;
  // If this browser will not save to the device (some private modes), the
  // queue lives in memory instead: it still retries while the page is open.
  let storageOk = true, memory = [];

  // Queue items are { table, row }. Older items were bare idea rows.
  const normal = item => item.table ? item : { table: "ideas", row: item };

  function load(){
    if (!storageOk) return memory.slice();
    try { return (JSON.parse(localStorage.getItem(KEY)) || []).map(normal); }
    catch (e) { storageOk = false; return memory.slice(); }
  }
  function save(list){
    memory = list.slice();
    if (storageOk){
      try { localStorage.setItem(KEY, JSON.stringify(list)); } catch (e) { storageOk = false; }
    }
    listeners.forEach(fn => fn(pendingIdeas(list)));
  }
  const pendingIdeas = list => list.filter(i => i.table === "ideas").length;
  const sameItem = (a, b) => a.table === b.table && (a.row.id || a.row.idea_id) === (b.row.id || b.row.idea_id);

  // Random id for a new idea (matches the database's uuid column).
  function newId(){
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
    const h = [...b].map(x => x.toString(16).padStart(2, "0")).join("");
    return h.slice(0, 8) + "-" + h.slice(8, 12) + "-" + h.slice(12, 16) + "-" + h.slice(16, 20) + "-" + h.slice(20);
  }

  // One attempt: "sent", "rejected", "offline" (no answer at all) or
  // "later" (the database answered with a problem worth retrying).
  async function attempt(item){
    const client = DB.client();
    if (!client) return "offline";
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const { error } = await client.from(item.table).insert(item.row).abortSignal(ctrl.signal);
      if (!error) return "sent";
      if (error.code === "23505") return "sent";   // already there from an earlier try
      console.warn("Idea wall: post failed", item.table, error);
      if (PERMANENT.has(error.code)) return "rejected";
      return typeof error.code === "string" && error.code.length >= 5 ? "later" : "offline";
    } catch (e) {
      return "offline";
    } finally {
      clearTimeout(timer);
    }
  }

  // Send everything waiting, oldest first. Stops at the first network
  // failure, since the rest would fail the same way. An item the database
  // answered "not now" stays queued and the rest still go.
  function flush(){
    if (flushing) return flushing;
    flushing = (async () => {
      let list = load(), skipped = [];
      while (list.length){
        const item = list.find(i => !skipped.some(k => sameItem(k, i)));
        if (!item) break;
        // a follow-up waits until its idea has gone
        if (item.table === "followups" && isQueued(item.row.idea_id)){ skipped.push(item); continue; }
        const result = await attempt(item);
        if (result === "offline") break;
        if (result === "later"){ skipped.push(item); continue; }
        let drop = [item];
        if (result === "rejected" && item.table === "ideas"){
          rejected.add(item.row.id);
          // its follow-up email has nothing to attach to
          drop = drop.concat(list.filter(i => i.table === "followups" && i.row.idea_id === item.row.id));
        }
        list = load().filter(i => !drop.some(d => sameItem(d, i)));
        save(list);
      }
    })().finally(() => { flushing = null; });
    return flushing;
  }

  // Queue an idea (and its optional follow-up email) and try to send now.
  // Resolves "sent" or "queued"; rejects if the database refused the idea.
  async function send(idea, followup){
    const items = [{ table: "ideas", row: idea }];
    if (followup) items.push({ table: "followups", row: followup });
    save(load().concat(items));
    await flush();
    if (rejected.has(idea.id)) throw new Error("rejected");
    return isQueued(idea.id) ? "queued" : "sent";
  }

  const isQueued = id => load().some(i => i.table === "ideas" && i.row.id === id);

  window.addEventListener("online", flush);
  setInterval(() => { if (load().length) flush(); }, RETRY_MS);
  if (load().length) setTimeout(flush, 500);

  return {
    send,
    flush,
    newId,
    isQueued,
    pending: () => pendingIdeas(load()),
    onChange: fn => listeners.add(fn)
  };
})();
