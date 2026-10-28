/* Optional feeling a contributor can attach to an idea: four positive and
   four negative words. `key` must match the `feeling` check in
   supabase/schema.sql. Shown as a small marker on the note. */
const FEELINGS = [
  { key: "hopeful",    name: "Hopeful",    tone: "positive" },
  { key: "excited",    name: "Excited",    tone: "positive" },
  { key: "confident",  name: "Confident",  tone: "positive" },
  { key: "proud",      name: "Proud",      tone: "positive" },
  { key: "worried",    name: "Worried",    tone: "negative" },
  { key: "frustrated", name: "Frustrated", tone: "negative" },
  { key: "uncertain",  name: "Uncertain",  tone: "negative" },
  { key: "impatient",  name: "Impatient",  tone: "negative" }
];

const FEELING = Object.fromEntries(FEELINGS.map(f => [f.key, f]));
