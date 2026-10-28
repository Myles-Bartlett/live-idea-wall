/* ============================================================
   Store: the one place that talks to Supabase.

   Keeps every idea and the settings row in memory and tells the page when
   anything changes. Three ways data arrives, so no screen drifts out of date:
     1. a full fetch on load, on reconnect, and every 60 s as a safety net
     2. live "postgres_changes" events from Supabase Realtime
     3. demo mode (index.html?demo or ?demo=400) uses sample ideas instead
        and never touches the database
   ============================================================ */

const Store = (() => {
  const PAGE_SIZE = 1000;          // Supabase returns at most 1000 rows per request
  const REFRESH_MS = 60 * 1000;    // safety-net refetch
  const RETRY_MS = 5 * 1000;       // after a failed fetch

  let ideas = new Map();           // id -> idea (see fromRow)
  let settings = { notes: [], summary: "", showOther: true, view: "wall" };
  let status = "connecting";       // connecting | live | reconnecting | offline | demo | error
  let loaded = false;              // first full fetch done?
  const fresh = new Map();         // id -> time it first appeared on this screen

  let client = null, channel = null, retryTimer = null;
  const changeListeners = new Set(), statusListeners = new Set();

  /* ---------------- shapes ---------------- */

  // Database row -> the shape the rest of the code uses.
  function fromRow(r){
    return {
      id: r.id,
      ts: Date.parse(r.created_at) || Date.now(),
      text: r.text || "",
      area: AREA[r.area] ? r.area : "other",
      name: r.name || "",
      parentId: r.parent_id || null,
      votes: r.votes || 0,
      hidden: !!r.hidden,
      solo: !!r.solo,
      sample: !!r.is_sample,
      source: r.source || "",
      feeling: FEELING[r.feeling] ? r.feeling : null
    };
  }

  function settingsFromRow(r){
    return {
      notes: Array.isArray(r.notes) ? r.notes : [],
      summary: r.summary || "",
      showOther: r.show_other !== false,
      view: r.view === "summary" ? "summary" : "wall"
    };
  }

  // Anything we had not seen after the first load counts as new on this screen.
  function noteArrival(id){
    if (loaded && !ideas.has(id) && !fresh.has(id)) fresh.set(id, Date.now());
  }

  /* ---------------- telling the page ---------------- */

  function changed(){ changeListeners.forEach(fn => fn()); }

  function setStatus(next){
    if (status === next) return;
    status = next;
    statusListeners.forEach(fn => fn(status));
  }

  /* ---------------- full fetch ---------------- */

  async function refresh(){
    if (!client) return;
    clearTimeout(retryTimer);
    try {
      const rows = [];
      for (let from = 0; ; from += PAGE_SIZE){
        const { data, error } = await client.from("ideas").select("*")
          .order("created_at").range(from, from + PAGE_SIZE - 1);
        if (error) throw error;
        rows.push(...data);
        if (data.length < PAGE_SIZE) break;
      }
      const { data: s, error: sErr } = await client.from("settings").select("*").eq("id", 1).maybeSingle();
      if (sErr) throw sErr;

      const next = new Map();
      for (const r of rows){ noteArrival(r.id); next.set(r.id, fromRow(r)); }
      ideas = next;
      if (s) settings = settingsFromRow(s);
      loaded = true;
      changed();
    } catch (err) {
      console.warn("Idea wall: fetch failed, retrying", err);
      setStatus(navigator.onLine ? "reconnecting" : "offline");
      retryTimer = setTimeout(refresh, RETRY_MS);
    }
  }

  /* ---------------- live updates ---------------- */

  function onIdeaEvent(payload){
    if (payload.eventType === "DELETE"){
      if (payload.old && payload.old.id) ideas.delete(payload.old.id);
    } else if (payload.new && payload.new.id){
      noteArrival(payload.new.id);
      ideas.set(payload.new.id, fromRow(payload.new));
    }
    changed();
  }

  function onSettingsEvent(payload){
    if (payload.new && payload.new.id === 1){ settings = settingsFromRow(payload.new); changed(); }
  }

  function subscribe(){
    if (channel) client.removeChannel(channel);
    channel = client.channel("wall")
      .on("postgres_changes", { event: "*", schema: "public", table: "ideas" }, onIdeaEvent)
      .on("postgres_changes", { event: "*", schema: "public", table: "settings" }, onSettingsEvent)
      .subscribe(state => {
        if (state === "SUBSCRIBED"){
          setStatus("live");
          refresh();   // catch anything that happened while we were not listening
        } else if (state === "CHANNEL_ERROR" || state === "TIMED_OUT" || state === "CLOSED"){
          setStatus(navigator.onLine ? "reconnecting" : "offline");
        }
      });
  }

  /* ---------------- demo mode ---------------- */

  function startDemo(count, live){
    Samples.rows(count).forEach(r => ideas.set(r.id, fromRow(r)));
    settings.notes = ["Demo mode: these are sample ideas, not saved anywhere.",
                      "Tap any note to read it in full, support it, or build on it."];
    loaded = true;
    setStatus("demo");
    changed();
    if (!live) return;
    // ?demo&live drops in a new sample idea every 8 seconds
    let n = count;
    setInterval(() => {
      const r = Samples.rows(n + 1)[n];
      r.created_at = new Date().toISOString();
      noteArrival(r.id);
      ideas.set(r.id, fromRow(r));
      n++;
      changed();
    }, 8000);
  }

  /* ---------------- start ---------------- */

  function start(){
    const params = new URLSearchParams(location.search);
    if (params.has("demo")){
      startDemo(parseInt(params.get("demo"), 10) || SAMPLE_IDEAS.length, params.has("live"));
      return;
    }

    client = DB.client();
    if (!client){ setStatus("error"); return; }
    refresh();
    subscribe();

    setInterval(() => {
      // if live updates have been down a while, start them again from scratch
      if (status !== "live") subscribe();
      refresh();
    }, REFRESH_MS);
    window.addEventListener("online", () => { refresh(); subscribe(); });
    window.addEventListener("offline", () => setStatus("offline"));
    document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
  }

  // Demo mode only: an idea posted from the wall's form lands in memory.
  function demoAdd(row){
    const full = Object.assign({ created_at: new Date().toISOString(), votes: 0, hidden: false,
                                 solo: false, is_sample: true }, row);
    noteArrival(full.id);
    ideas.set(full.id, fromRow(full));
    changed();
  }

  // Show a change on this screen straight away (e.g. a support), before the
  // live update from Supabase confirms it.
  function patchLocal(id, patch){
    const idea = ideas.get(id);
    if (!idea) return;
    Object.assign(idea, patch);
    changed();
  }

  return {
    start,
    demoAdd,
    patchLocal,
    isDemo: () => status === "demo",
    onChange: fn => changeListeners.add(fn),
    onStatus: fn => statusListeners.add(fn),
    ideas: () => [...ideas.values()],
    settings: () => settings,
    status: () => status,
    fresh,
    client: () => client
  };
})();
