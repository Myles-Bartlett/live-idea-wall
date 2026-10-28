/* Sample ideas, clearly tagged as samples.
   Used by demo mode (index.html?demo) to try the wall without touching the
   database, and later by the facilitator panel's "Load sample ideas". */
const SAMPLE_IDEAS = [
  ["talent", "Paid co-op for part-time students, not just full-time cohorts", "Priya R."],
  ["talent", "Let industry practitioners teach one course without quitting their day job", "Tom B."],
  ["talent", "Stackable micro-credentials that count toward a full diploma later", ""],
  ["talent", "Apprenticeship seats matched to regional labour shortages every year", "Dana M."],
  ["talent", "Fast-track credential recognition for internationally trained newcomers", ""],
  ["talent", "Paid co-op placements for part-time and mature students", "Luis G."],
  ["talent", "A province-wide upskilling pass for mid-career workers", ""],
  ["innovation", "Shared applied research labs that small companies can book by the day", "Aisha K."],
  ["innovation", "Student consulting teams solving real problems for local SMEs", ""],
  ["innovation", "A cross-college prototype fund with a two-week decision turnaround", "Ben T."],
  ["innovation", "Open makerspaces in every college, open evenings to the community", ""],
  ["innovation", "Shared applied research labs open to small businesses across colleges", ""],
  ["innovation", "Faculty sabbaticals spent inside industry partners", "Grace L."],
  ["productivity", "Teach practical AI tools in every program, not just tech ones", ""],
  ["productivity", "Automation clinics that help small manufacturers adopt robotics", "Sam O."],
  ["productivity", "Short courses on lean operations for small business owners", ""],
  ["productivity", "Digital skills bootcamps for workers whose jobs are changing", "Nadia F."],
  ["community", "Mental health first aid training open to every student and neighbour", ""],
  ["community", "Colleges as climate emergency hubs for their towns", "Eric W."],
  ["community", "Affordable student housing built with municipalities", ""],
  ["community", "Rural satellite campuses run with local libraries", "Jo P."],
  ["community", "Community food programs run by culinary students", ""],
  ["industry", "Retrofit and heat pump training to meet the housing build-out", "Kim D."],
  ["industry", "EV and battery supply chain programs built with automakers", ""],
  ["industry", "Clean construction skills for the next generation of builders", "Ray S."],
  ["industry", "Joint college-industry councils that refresh curriculum every year", ""],
  ["industry", "Battery and EV programs co-designed with the auto sector", "Mei H."],
  ["industry", "Advanced manufacturing centres shared by colleges in each region", ""],
  ["students", "Mentorship from alumni for every first-year student", "Chris A."],
  ["students", "Mental health support available evenings and weekends", ""],
  ["students", "Free transit passes so students can reach placements", "Fatima Z."],
  ["students", "One support desk for money, housing and wellness questions", ""],
  ["students", "Alumni mentors matched with every first-year student", ""],
  ["students", "Flexible schedules for students who work full time", "Owen J."],
  ["other", "Make credit transfer between colleges and universities automatic", ""],
  ["other", "A single application portal for all college programs", "Lena V."]
];

const Samples = (() => {
  const DAY = 24 * 60 * 60 * 1000;

  // Rows shaped like the `ideas` table, so the wall treats them like real ones.
  // Past the hand-written list, ideas repeat with a number and are kept apart
  // (solo) so a 400-idea test really has 400 notes to fit.
  function rows(count){
    const now = Date.now();
    const out = [];
    for (let i = 0; i < count; i++){
      const [area, text, name] = SAMPLE_IDEAS[i % SAMPLE_IDEAS.length];
      const round = Math.floor(i / SAMPLE_IDEAS.length);
      out.push({
        id: "sample-" + i,
        created_at: new Date(now - DAY * 1.5 + (DAY * 1.5) * (i / count)).toISOString(),
        text: round ? text + " (#" + (i + 1) + ")" : text,
        area,
        name: name || null,
        parent_id: null,
        votes: (i * 7) % 13 === 0 ? 9 + (i % 5) : (i * 5) % 6,
        hidden: false,
        solo: round > 0,
        is_sample: true,
        source: "demo",
        feeling: i % 3 === 2 ? null : FEELINGS[(i * 5) % FEELINGS.length].key
      });
    }
    return out;
  }

  return { rows };
})();
