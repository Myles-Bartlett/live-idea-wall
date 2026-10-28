/* The phone/tablet submit page (add.html). Sets up the form for a personal
   phone, or for a booth tablet when the address ends in ?kiosk. */

// Booth tablets: clear the screen this long after each post...
const KIOSK_RESET_SECONDS = 20;
// ...and clear a half-filled form after this long with no typing.
const KIOSK_IDLE_SECONDS = 120;

const kiosk = new URLSearchParams(location.search).has("kiosk");
const statusEl = document.getElementById("addStatus");

AddForm.mount(document.getElementById("addRoot"), kiosk ? {
  source: "kiosk",
  rememberName: false,
  keepDraft: false,
  resetAfter: KIOSK_RESET_SECONDS,
  idleReset: KIOSK_IDLE_SECONDS
} : {
  source: "phone",
  supportHref: "./"
});

// Tell people when they are offline, and when ideas are waiting to send.
function showStatus(){
  const waiting = Outbox.pending();
  let msg = "";
  if (!navigator.onLine) msg = "You’re offline. You can still post: your idea is kept on this device and sent when the connection is back.";
  if (waiting) msg = (waiting === 1 ? "1 idea is" : waiting + " ideas are") + " waiting to send. Keep this page open.";
  statusEl.textContent = msg;
  statusEl.hidden = !msg;
}
Outbox.onChange(showStatus);
window.addEventListener("online", showStatus);
window.addEventListener("offline", showStatus);
showStatus();
