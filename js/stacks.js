/* ============================================================
   Stacking: the software sorts and stacks, humans decide meaning.

   A stack is one idea (the "root") plus any ideas that join it:
     - near-duplicates in the same area join automatically, unless a
       facilitator split them out (solo)
     - "build on this idea" replies (parent_id) always join their parent's stack
     - ideas a facilitator dragged onto another (stack_id) join that stack
   Behaviour ported from reference/hub-edition.html.
   ============================================================ */

const Stacks = (() => {
  // A new idea keeps its outline and sits at the top of its column this long.
  const FRESH_MS = 2 * 60 * 1000;

  // Words too common in this question to say two ideas are alike.
  const STOP = new Set(("the and for with that this from into more their they them have will about " +
    "colleges college ontario should could would than then what which where while also just like " +
    "make need needs most other over such very each every through across between being been were " +
    "your ours want help create build year years next ten growth power").split(" "));

  function tokens(text){
    return new Set(String(text || "").toLowerCase().replace(/[’']/g, "").split(/[^a-z0-9]+/)
      .filter(w => w.length > 3 && !STOP.has(w))
      .map(w => w.replace(/(able|ing|ed|es|s)$/, "")));
  }

  // Alike if they share at least 3 meaningful words making up half the shorter
  // idea, or enough words overall (Jaccard 0.4). Two shared words minimum.
  function similar(a, b){
    let shared = 0;
    for (const w of a) if (b.has(w)) shared++;
    if (shared < 2) return false;
    const overlap = shared / Math.min(a.size, b.size);
    const jaccard = shared / (a.size + b.size - shared);
    return (shared >= 3 && overlap >= 0.5) || jaccard >= 0.4;
  }

  // ideas: visible ideas (hidden ones already removed).
  // fresh: Map of idea id -> time it first appeared on this screen.
  function build(ideas, fresh){
    const sorted = ideas.slice().sort((a, b) => a.ts - b.ts);
    const stacks = new Map();   // root id -> stack
    const rootOf = {};          // any idea id -> its stack's root id
    const tokenCache = {};

    const linkOf = i => i.stackId || i.parentId;   // the idea this one is attached to
    for (const idea of sorted.filter(i => !linkOf(i))){
      tokenCache[idea.id] = tokens(idea.text);
      let hit = null;
      if (!idea.solo){
        for (const s of stacks.values()){
          if (s.area === idea.area && !s.root.solo && similar(tokenCache[idea.id], tokenCache[s.root.id])){ hit = s; break; }
        }
      }
      if (hit){ hit.members.push(idea); rootOf[idea.id] = hit.root.id; }
      else { stacks.set(idea.id, { root: idea, area: idea.area, members: [idea] }); rootOf[idea.id] = idea.id; }
    }

    // Replies and grouped ideas join their stack. Repeat so a reply to a reply also lands.
    let rest = sorted.filter(i => linkOf(i)), placed = true;
    while (rest.length && placed){
      placed = false;
      const next = [];
      for (const idea of rest){
        const root = rootOf[linkOf(idea)];
        if (root){ stacks.get(root).members.push(idea); rootOf[idea.id] = root; placed = true; }
        else next.push(idea);
      }
      rest = next;
    }
    // One whose stack is hidden or gone stands on its own.
    for (const idea of rest){ stacks.set(idea.id, { root: idea, area: idea.area, members: [idea] }); rootOf[idea.id] = idea.id; }

    const now = Date.now();
    for (const s of stacks.values()) finish(s, fresh, now);
    return { stacks: [...stacks.values()], rootOf };
  }

  // Unstacked view: every idea becomes a stack of one.
  function explode(stacks, fresh){
    const now = Date.now();
    const out = [];
    for (const s of stacks){
      for (const m of s.members) out.push(finish({ root: m, area: s.area, members: [m] }, fresh, now));
    }
    return out;
  }

  function finish(s, fresh, now){
    if (!AREA[s.area]) s.area = "other";
    s.size = s.members.length;
    s.support = s.members.reduce((n, m) => n + (m.votes || 0), 0);
    s.latest = Math.max(...s.members.map(m => m.ts || 0));
    s.freshAt = Math.max(0, ...s.members.map(m => fresh.get(m.id) || 0));
    s.isFresh = now - s.freshAt < FRESH_MS;
    return s;
  }

  // Column order: just-arrived first (newest on top), then most supported,
  // then biggest stack, then newest.
  function rank(a, b){
    if (a.isFresh !== b.isFresh) return a.isFresh ? -1 : 1;
    if (a.isFresh) return b.freshAt - a.freshAt;
    return (b.support - a.support) || (b.size - a.size) || (b.latest - a.latest);
  }

  return { build, explode, rank, FRESH_MS };
})();
