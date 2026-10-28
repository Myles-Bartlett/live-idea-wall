/* One Supabase connection per page, shared by the wall (js/store.js) and
   the posting queue (js/outbox.js). Uses the public settings in config.js.
   DB.client() is null if config.js or the Supabase library did not load. */
const DB = (() => {
  let client;

  function get(){
    if (client !== undefined) return client;
    const cfg = window.WALL_CONFIG || {};
    if (!window.supabase || !cfg.supabaseUrl || !cfg.supabaseKey || cfg.supabaseUrl.includes("YOUR-PROJECT")){
      console.error("Idea wall: Supabase library or config.js missing");
      client = null;
    } else {
      client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey);
    }
    return client;
  }

  return { client: get };
})();
