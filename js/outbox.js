/* ============================================================
   Outbox: posts new ideas, and never loses one.

   Every idea goes into a queue saved on this device (localStorage) BEFORE
   it is sent. It leaves the queue only once Supabase has it. If the Wi-Fi
   drops, it waits and tries again: when the browser comes back online,
   every 15 seconds, and whenever a page using this file opens.

   Each idea gets its id on this device, so a retry of an idea that did in
   fact arrive is recognised as a duplicate and counted as sent.
   ============================================================ */

const Outbox = (() => {
  const KEY = "ideawall:outbox:v1";
  const TIMEOUT_MS = 8000;      // give up on one attempt after this long
  const RETRY_MS = 15000;

  const listeners = new Set();
  const rejected = new Set();   // ids the database refused (not worth retrying)
  let flushing = null;
  // If this browser will not save to the device (some private modes), the
  // queue lives in memory instead: it still retries while the page is open.
  let storageOk = true, memory = [];

  function load(){
    if (!storageOk) return memory.slice();
    try { return JSON.parse(localStorage.getItem(KEY)) || []; }
    catch (e) { storageOk = false; return memory.slice(); }
  }
  function save(list){
    memory = list.slice();
    if (storageOk){
      try { localStorage.setItem(KEY, JSON.stringify(list)); } catch (e) { storageOk = false; }
    }
    listeners.forEach(fn => fn(list.length));
  }

  // Random id for a new idea (matches the database's uuid column).
  function newId(){
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
    const h = [...b].map(x => x.toString(16).padStart(2, "0")).join("");
    return h.slice(0, 8) + "-" + h.slice(8, 12) + "-" + h.slice(12, 16) + "-" + h.slice(16, 20) + "-" + h.slice(20);
  }

  // One attempt. "sent", "retry" (network trouble) or "rejected" (the
  // database answered no, e.g. text too short, so retrying will not help).
  async function attempt(row){
    const client = DB.client();
    if (!client) return "retry";
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const { error } = await client.from("ideas").insert(row).abortSignal(ctrl.signal);
      if (!error) return "sent";
      if (error.code === "23505") return "sent";   // already there from an earlier try
      const fromDatabase = typeof error.code === "string" &&
        (error.code.length === 5 || error.code.startsWith("PGRST"));
      console.warn("Idea wall: post failed", error);
      return fromDatabase ? "rejected" : "retry";
    } catch (e) {
      return "retry";
    } finally {
      clearTimeout(timer);
    }
  }

  // Send everything waiting, oldest first. Stops at the first network
  // failure, since the rest would fail the same way.
  function flush(){
    if (flushing) return flushing;
    flushing = (async () => {
      let list = load();
      while (list.length){
        const row = list[0];
        const result = await attempt(row);
        if (result === "retry") break;
        if (result === "rejected") rejected.add(row.id);
        list = load().filter(r => r.id !== row.id);
        save(list);
      }
    })().finally(() => { flushing = null; });
    return flushing;
  }

  // Queue an idea and try to send it now.
  // Resolves "sent" or "queued"; rejects if the database refused it.
  async function send(row){
    save(load().concat([row]));
    await flush();
    if (rejected.has(row.id)) throw new Error("rejected");
    return load().some(r => r.id === row.id) ? "queued" : "sent";
  }

  window.addEventListener("online", flush);
  setInterval(() => { if (load().length) flush(); }, RETRY_MS);
  if (load().length) setTimeout(flush, 500);

  return {
    send,
    flush,
    newId,
    pending: () => load().length,
    isQueued: id => load().some(r => r.id === id),
    onChange: fn => listeners.add(fn)
  };
})();
