/* The seven opportunity areas, in the order the wall draws its columns.
   `key` must match the `area` check in supabase/schema.sql.
   Each area's colour lives in css/base.css (--c-<key>). */
const AREAS = [
  { key: "talent",       name: "Talent",                  short: "Talent" },
  { key: "innovation",   name: "Innovation",              short: "Innovation" },
  { key: "productivity", name: "Productivity",            short: "Productivity" },
  { key: "community",    name: "Community Resilience",    short: "Community" },
  { key: "industry",     name: "Industry Transformation", short: "Industry" },
  { key: "students",     name: "Student Success",         short: "Students" },
  { key: "other",        name: "Something else",          short: "Something else" }
];

const AREA = Object.fromEntries(AREAS.map(a => [a.key, a]));
