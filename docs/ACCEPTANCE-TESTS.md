# Acceptance tests

The nine tests from [`HANDOFF-BRIEF.md`](HANDOFF-BRIEF.md), run on 30 October 2026 against the
live site (https://myles-bartlett.github.io/live-idea-wall/) and the real Supabase database,
in a desktop browser sized to the Surface Hub (1920x1080) and an iPhone (375x812).

| # | Test | Result | How it was checked |
|---|---|---|---|
| 1 | Post from a phone → on the wall in another browser within ~2 s, highlighted | **Pass** | Arrived in 0.26 s to 0.76 s across four runs, outlined and tagged "New" |
| 2 | Support the same idea twice from one device → second tap blocked, total +1 | **Pass** | Real database: first support counted, second refused, count went up by exactly 1. Phones block for good; the shared Hub blocks the same idea for 30 s |
| 3 | Not signed in: update or delete a row from the browser console → refused | **Pass** | Changing support, hiding, editing text, deleting, changing settings, posting a fake sample or fake support, and reading emails or the facilitator list were all refused by the database |
| 4 | Facilitator hides a note → disappears from all open screens | **Needs a facilitator** | Hiding works in demo mode, and hide changes reach every screen through the same live updates as new posts. Myles to confirm with two screens open while signed in |
| 5 | Build on an idea → response joins that stack, ×N badge updates | **Pass** | Reply posted from a phone joined the stack on the wall in 0.61 s; the stack went from ×2 to ×3 |
| 6 | Load 400 sample ideas → no column scrolls, "+N more" correct, readable at 1920x1080 | **Pass** | `?demo=400`: no column scrolls; in every column (and in the Newest and Most supported views) shown + "+N more" adds up to exactly 400 |
| 7 | Kill the network mid-post → idea queued, posts on reconnect | **Pass** | Showed "Saved on this device" and "1 idea is waiting to send"; landed on the wall 0.22 s after the connection came back |
| 8 | Closing summary renders synthesis, top 5 supported, best idea per area | **Pass** | Demo mode, including 400 ideas and a five-paragraph synthesis: fits the Hub without scrolling |
| 9 | Works in Edge (Windows) and iOS Safari | **Needs real devices** | Built for both and tested in a Chromium browser (the same engine as Edge). Not yet run on the actual Surface Hub or an iPhone |

Also checked: text contrast against WCAG AA (all note text, labels, buttons, tags and the footer
pass; the footer gradient was deepened slightly to get there), and the printable QR sign scans to
the `#add` address and fits one US Letter page.

## Still to do on real hardware (Myles)

1. **Surface Hub, Edge:** open the wall, full screen (F11). Check the question reads from about
   4 m away, then tap a note, support it, post from the pop-up, and drag a note while signed in.
2. **iPhone, Safari:** scan the printed QR sign, post an idea with a feeling and an email, then
   use "Support other ideas" and "Find my idea".
3. **Test 4:** sign in on one screen, keep the wall open on a second, hide a note, and watch it
   disappear from both.
4. **Venue Wi-Fi and a phone hotspot:** one test post on each.
5. **Before the event:** run `supabase/reset-for-event.sql` to clear the test ideas
   (TEST, TEST 2 to TEST 5 and your own trial posts).
