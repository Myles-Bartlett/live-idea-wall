#!/usr/bin/env python3
"""
Idea Wall feed updater  —  Sheridan College, Powering Growth Expo (HES 2026)

Same pattern as the Kudos Wall script. On a loop:
  1. finds the Microsoft Forms response workbook in OneDrive
  2. pulls out Idea / Theme / Your Name
  3. applies any manual drag-and-drop recategorizations (idea-wall-overrides.json)
  4. groups near-duplicate ideas within each column into a "stack" and
     orders everything by upvotes (idea-wall-votes.json)
  5. writes idea-wall-feed.json  (the data, human readable)
     and  idea-wall-feed.js     (same data, what the HTML display reads)

Also runs a tiny local server (localhost only) so the display page can save:
  - a drag-and-drop move between columns  (POST /move  {id, theme})
  - an upvote on an idea                  (POST /like  {id})
Both just record the action and rewrite the feed immediately.

Uses only the Python standard library — nothing to install.
Stop it any time with Ctrl-C.
"""

import fnmatch
import hashlib
import json
import os
import re
import shutil
import sys
import tempfile
import threading
import time
import zipfile
import xml.etree.ElementTree as ET
from datetime import datetime
from difflib import SequenceMatcher
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# ----------------------------------------------------------------------
# CONFIG  — the only lines you might ever need to change
# ----------------------------------------------------------------------

# The exact workbook the Form writes to. This is checked first; if it is
# there, the script uses it and skips searching entirely. If the file is
# ever renamed or moved, the search below still finds it, so this can be
# left as-is rather than kept in sync.
WORKBOOK_PATH = (
    "~/Library/CloudStorage/OneDrive-SheridanCollege/"
    "Sheridan –– Idea Wall — HES 2026.xlsx"
)

# Where OneDrive lives on this Mac. The script searches inside it for the
# workbook, so the file can be moved around without editing anything.
ONEDRIVE_ROOT = os.path.expanduser(
    "~/Library/CloudStorage/OneDrive-SheridanCollege"
)

# Fallback matching, used only if WORKBOOK_PATH above is missing or moved.
# Matching ignores punctuation and capitals, so the dashes and spaces in
# "Sheridan –– Idea Wall — HES 2026.xlsx" cannot cause a miss. Any
# spreadsheet in OneDrive whose name contains these words, in this order,
# counts as a match.
WORKBOOK_NAME_WORDS = ["idea", "wall"]

# Kept for reference; the word list above is what actually matches now.
WORKBOOK_PATTERN = "*Idea Wall*.xls*"

# Search limits, so a big OneDrive tree can never make this hang.
SEARCH_MAX_DEPTH   = 5    # folder levels below ONEDRIVE_ROOT
SEARCH_MAX_SECONDS = 20   # give up and retry on the next pass

# Folders worth looking in first (relative to ONEDRIVE_ROOT).
PRIORITY_SUBDIRS = [
    "Documents/Microsoft Forms",
    "Documents",
    "Desktop",
    "",
]

# Never walk into these.
SKIP_DIRS = {"node_modules", "Library", ".git", "Pictures", "Music", "Movies"}

# Where to write the feed files (defaults to this script's own folder).
OUT_DIR = os.path.dirname(os.path.abspath(__file__))

# How often to re-read the workbook, in seconds.
REFRESH_SECONDS = 5

# How often to re-search OneDrive while the workbook hasn't been found yet.
SEARCH_RETRY_SECONDS = 60

# Where manual drag-and-drop moves are remembered, so they survive the next
# time this script re-reads the workbook. Safe to delete any time — that
# clears every manual move and lets categories go back to what the Form
# answer says.
OVERRIDES_FILE = os.path.join(OUT_DIR, "idea-wall-overrides.json")

# Where upvote counts are remembered. Safe to delete any time — that resets
# every idea back to 0 likes.
VOTES_FILE = os.path.join(OUT_DIR, "idea-wall-votes.json")

# Local-only port for the drag-and-drop / like save server. Nothing outside
# this Mac can reach it. Change it only if 8791 is already used by something
# else.
SERVER_PORT = 8791

# The six opportunity areas from the proposal. Order here is the column
# order on the wall. Edit the "match" words if the Form's dropdown wording
# ends up slightly different — matching is loose (lowercase, punctuation
# ignored, substring match).
THEMES = [
    {"key": "talent",        "label": "Talent",                  "match": ["talent"]},
    {"key": "innovation",    "label": "Innovation",               "match": ["innovation"]},
    {"key": "productivity",  "label": "Productivity",             "match": ["productivity"]},
    {"key": "resilience",    "label": "Community Resilience",     "match": ["community", "resilience"]},
    {"key": "transformation","label": "Industry Transformation",  "match": ["industry", "transformation"]},
    {"key": "success",       "label": "Student Success",          "match": ["student success", "student"]},
]
OTHER_THEME = {"key": "other", "label": "Other Ideas", "match": []}
VALID_THEME_KEYS = {t["key"] for t in THEMES} | {OTHER_THEME["key"]}

# Which Forms questions map to which part of the display card.
# Matching is loose: lowercase, punctuation ignored.
COLUMN_ALIASES = {
    "idea":  ["your idea", "idea", "shout out", "response", "contribution"],
    # "your idea1" is what Microsoft Forms exports when two questions share
    # the title "Your idea" — it silently numbers the second one. Keep it in
    # the list so the area column is found by name rather than by position.
    "theme": ["opportunity area", "your idea1", "theme", "category"],
    "name":  ["your name", "name", "submitted by"],
}

# Newest submission first within each theme column (before upvotes reorder
# things and near-duplicates get stacked).
NEWEST_FIRST = True

# Cap how many stacks render per column so the wall never overflows the
# screen. The full idea count is still shown in the column header.
MAX_PER_COLUMN = 18

# ---- similar-idea stacking -------------------------------------------
# Two ideas (within the same column) are treated as "the same idea" and
# stacked together when they share enough of their meaningful words AND
# read similarly overall. Both checks have to pass, which keeps two ideas
# that just happen to share a couple of common words (e.g. "students",
# "college") from getting stacked together by mistake.
#
# This is a rough heuristic, not real language understanding — it will
# occasionally miss a real duplicate or group two that aren't quite the
# same. Tune the two numbers below if it feels too eager or too shy.
STACK_WORD_OVERLAP_THRESHOLD = 0.34   # shared significant words / all significant words, 0-1
STACK_TEXT_SIMILARITY_THRESHOLD = 0.5 # difflib ratio on the full sentence, 0-1

STOPWORDS = {
    "a", "an", "the", "and", "or", "but", "if", "of", "to", "in", "on", "at",
    "by", "for", "with", "about", "into", "onto", "from", "as", "is", "are",
    "was", "were", "be", "been", "being", "this", "that", "these", "those",
    "it", "its", "your", "yours", "our", "ours", "their", "theirs", "his",
    "her", "hers", "they", "them", "we", "you", "i", "not", "no", "so",
    "than", "then", "more", "most", "less", "least", "very", "can", "could",
    "should", "would", "will", "shall", "may", "might", "must", "do", "does",
    "did", "have", "has", "had", "each", "every", "all", "any", "some",
    "other", "such", "also", "just", "like", "what", "when", "where", "who",
    "how", "why", "college", "colleges", "polytechnic", "polytechnics",
    "student", "students", "ontario", "sheridan", "program", "programs",
    "system", "across", "over", "next", "ten", "years", "idea",
}

# ----------------------------------------------------------------------
# xlsx reading (pure stdlib) — identical approach to the Kudos script
# ----------------------------------------------------------------------

NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"


def _col_index(ref):
    """'BC12' -> 28 (0-based column number)."""
    letters = re.match(r"[A-Z]+", ref).group(0)
    n = 0
    for ch in letters:
        n = n * 26 + (ord(ch) - 64)
    return n - 1


def read_rows(xlsx_path):
    """Return the first worksheet as a list of lists of strings."""
    with zipfile.ZipFile(xlsx_path) as z:
        shared = []
        if "xl/sharedStrings.xml" in z.namelist():
            root = ET.fromstring(z.read("xl/sharedStrings.xml"))
            for si in root.findall(NS + "si"):
                shared.append("".join(t.text or "" for t in si.iter(NS + "t")))

        sheet_name = next(
            (n for n in sorted(z.namelist())
             if n.startswith("xl/worksheets/sheet") and n.endswith(".xml")),
            None,
        )
        if not sheet_name:
            return []

        root = ET.fromstring(z.read(sheet_name))
        rows = []
        for row in root.iter(NS + "row"):
            cells = {}
            for c in row.findall(NS + "c"):
                ref = c.get("r") or ""
                idx = _col_index(ref) if ref else len(cells)
                ctype = c.get("t")
                if ctype == "s":
                    v = c.find(NS + "v")
                    text = shared[int(v.text)] if v is not None and v.text else ""
                elif ctype == "inlineStr":
                    is_el = c.find(NS + "is")
                    text = "".join(t.text or "" for t in is_el.iter(NS + "t")) if is_el is not None else ""
                else:
                    v = c.find(NS + "v")
                    text = v.text if v is not None and v.text else ""
                cells[idx] = (text or "").strip()
            if cells:
                width = max(cells) + 1
                rows.append([cells.get(i, "") for i in range(width)])
        return rows


# ----------------------------------------------------------------------
# turning rows into wall cards
# ----------------------------------------------------------------------

def normalize(s):
    return re.sub(r"[^a-z ]", "", (s or "").lower()).strip()


def classify_theme(raw_theme):
    n = normalize(raw_theme)
    for theme in THEMES:
        if any(word in n for word in theme["match"]):
            return theme["key"]
    return OTHER_THEME["key"]


def card_id(idea, sender):
    """Stable id for a submission, so a manual drag-and-drop move or an
    upvote still finds the right card even after the workbook is re-read
    and rebuilt."""
    raw = (idea or "").strip() + "\x1e" + (sender or "").strip()
    return hashlib.md5(raw.encode("utf-8")).hexdigest()[:10]


def build_cards(rows):
    if not rows:
        return []

    header = [normalize(h) for h in rows[0]]

    def find_col(key):
        for alias in COLUMN_ALIASES[key]:
            if alias in header:
                return header.index(alias)
        for alias in COLUMN_ALIASES[key]:
            for i, h in enumerate(header):
                if alias in h:
                    return i
        return None

    cols = {k: find_col(k) for k in COLUMN_ALIASES}

    # Fallback for a Forms export with the standard trailing 3 questions.
    if cols["idea"] is None or cols["theme"] is None:
        if len(header) >= 3:
            cols = {"idea": len(header) - 3,
                    "theme": len(header) - 2,
                    "name": len(header) - 1}
        else:
            return []

    out = []
    for row in rows[1:]:
        def get(key):
            i = cols.get(key)
            return row[i].strip() if i is not None and i < len(row) else ""
        idea, raw_theme, sender = get("idea"), get("theme"), get("name")
        if not idea:
            continue
        out.append({
            "id": card_id(idea, sender),
            "idea": idea,
            "theme": classify_theme(raw_theme),
            "from": sender,
        })

    if NEWEST_FIRST:
        out.reverse()
    return out


# ----------------------------------------------------------------------
# manual drag-and-drop overrides
# ----------------------------------------------------------------------

def load_overrides():
    try:
        with open(OVERRIDES_FILE, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def save_overrides(overrides):
    write_atomic(OVERRIDES_FILE, json.dumps(overrides, indent=2, ensure_ascii=False) + "\n")


def apply_overrides(cards, overrides):
    """Re-home any card that a facilitator has manually dragged elsewhere.
    The Form answer still decides the theme for everything that hasn't
    been touched by hand."""
    out = []
    for card in cards:
        card = dict(card)
        ov = overrides.get(card["id"])
        if ov and ov.get("theme") in VALID_THEME_KEYS and ov["theme"] != card["theme"]:
            card["theme"] = ov["theme"]
            card["moved"] = True
        out.append(card)
    return out


# ----------------------------------------------------------------------
# upvotes
# ----------------------------------------------------------------------

def load_votes():
    try:
        with open(VOTES_FILE, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def save_votes(votes):
    write_atomic(VOTES_FILE, json.dumps(votes, indent=2, ensure_ascii=False) + "\n")


# ----------------------------------------------------------------------
# similar-idea stacking
# ----------------------------------------------------------------------

def _significant_words(text):
    words = re.sub(r"[^a-z0-9 ]", " ", (text or "").lower()).split()
    return {w for w in words if len(w) > 2 and w not in STOPWORDS}


def _are_similar(word_set_a, word_set_b, norm_a, norm_b):
    if not word_set_a or not word_set_b:
        return False
    overlap = len(word_set_a & word_set_b) / len(word_set_a | word_set_b)
    if overlap < STACK_WORD_OVERLAP_THRESHOLD:
        return False
    ratio = SequenceMatcher(None, norm_a, norm_b).ratio()
    return ratio >= STACK_TEXT_SIMILARITY_THRESHOLD


def _cluster(cards):
    """Group cards (already all in the same column) into clusters of
    near-duplicate ideas using union-find over pairwise similarity."""
    n = len(cards)
    parent = list(range(n))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(x, y):
        rx, ry = find(x), find(y)
        if rx != ry:
            parent[ry] = rx

    norms = [normalize(c["idea"]) for c in cards]
    word_sets = [_significant_words(c["idea"]) for c in cards]

    for i in range(n):
        for j in range(i + 1, n):
            if _are_similar(word_sets[i], word_sets[j], norms[i], norms[j]):
                union(i, j)

    groups = {}
    for i in range(n):
        groups.setdefault(find(i), []).append(i)
    return list(groups.values())


def build_stacks(cards, votes):
    """Turn a column's cards into vote-ordered stacks of near-duplicate
    ideas. The idea with the most likes leads each stack and decides where
    the stack sits in the column; ties keep the newest-first order the
    cards already came in."""
    for c in cards:
        c["votes"] = votes.get(c["id"], 0)

    stacks = []
    for idxs in _cluster(cards):
        members = sorted((cards[i] for i in idxs), key=lambda c: -c["votes"])
        lead = members[0]
        stacks.append({
            "id": lead["id"],
            "idea": lead["idea"],
            "from": lead["from"],
            "moved": bool(lead.get("moved")),
            "votes": lead["votes"],
            "members": [
                {
                    "id": m["id"],
                    "idea": m["idea"],
                    "from": m["from"],
                    "votes": m["votes"],
                    "moved": bool(m.get("moved")),
                }
                for m in members
            ],
        })

    stacks.sort(key=lambda s: -s["votes"])
    return stacks


def group_by_theme(cards, votes):
    all_themes = THEMES + [OTHER_THEME]
    buckets = {t["key"]: [] for t in all_themes}
    for card in cards:
        buckets[card["theme"]].append(card)

    columns = []
    for t in all_themes:
        bucket = buckets[t["key"]]
        if not bucket and t is OTHER_THEME:
            continue

        stacks = build_stacks(bucket, votes)
        shown = stacks[:MAX_PER_COLUMN]
        shown_idea_count = sum(len(s["members"]) for s in shown)

        columns.append({
            "key": t["key"],
            "label": t["label"],
            "total": len(bucket),
            "hidden": max(0, len(bucket) - shown_idea_count),
            "cards": shown,
        })
    return columns


# ----------------------------------------------------------------------
# writing the feed
# ----------------------------------------------------------------------

def write_atomic(path, text):
    d = os.path.dirname(path) or "."
    fd, tmp = tempfile.mkstemp(dir=d, suffix=".tmp")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(text)
    os.replace(tmp, path)


def write_feed(cards, votes):
    columns = group_by_theme(cards, votes)
    payload = json.dumps(columns, indent=2, ensure_ascii=False)
    write_atomic(os.path.join(OUT_DIR, "idea-wall-feed.json"), payload + "\n")
    stamp = datetime.now().strftime("%Y-%m-%d %I:%M:%S %p")
    js = (
        "/* Auto-generated — do not edit. Last update: " + stamp + " */\n"
        "window.IDEA_WALL = " + payload + ";\n"
        'window.IDEA_WALL_UPDATED = "' + stamp + '";\n'
    )
    write_atomic(os.path.join(OUT_DIR, "idea-wall-feed.js"), js)


CACHE_FILE = os.path.join(OUT_DIR, ".workbook-path")


def _matches(filename):
    """True for a spreadsheet whose name carries the words in
    WORKBOOK_NAME_WORDS, in order. Punctuation, capitals and the various
    dash characters Word and Forms like to insert are all ignored, so
    "Sheridan –– Idea Wall — HES 2026.xlsx" matches just as well as
    "idea-wall.xlsx". Excel lock files (~$...) and hidden files are
    skipped."""
    if filename.startswith(("~$", ".")):
        return False
    stem, ext = os.path.splitext(filename)
    if not ext.lower().startswith(".xls"):
        return False
    flat = re.sub(r"[^a-z0-9]+", " ", stem.lower())
    pos = 0
    for word in WORKBOOK_NAME_WORDS:
        pos = flat.find(word, pos)
        if pos < 0:
            return False
        pos += len(word)
    return True


def _scan(root, max_depth, deadline, verbose):
    hits = []
    queue = [(root, 0)]
    while queue:
        if time.time() > deadline:
            if verbose:
                print("  (search time limit reached)", flush=True)
            break
        directory, depth = queue.pop(0)
        try:
            with os.scandir(directory) as it:
                entries = list(it)
        except OSError:
            continue
        for e in entries:
            try:
                if e.is_file() and _matches(e.name):
                    hits.append(e.path)
                elif (e.is_dir() and depth < max_depth
                      and not e.name.startswith(".")
                      and e.name not in SKIP_DIRS):
                    queue.append((e.path, depth + 1))
            except OSError:
                continue
    return hits


def find_workbook(verbose=True):
    if WORKBOOK_PATH and os.path.exists(os.path.expanduser(WORKBOOK_PATH)):
        return os.path.expanduser(WORKBOOK_PATH)

    try:
        with open(CACHE_FILE, encoding="utf-8") as f:
            cached = f.read().strip()
        if cached and os.path.exists(cached):
            return cached
    except OSError:
        pass

    if not os.path.isdir(ONEDRIVE_ROOT):
        if verbose:
            print("OneDrive folder not found: " + ONEDRIVE_ROOT, flush=True)
        return None

    deadline = time.time() + SEARCH_MAX_SECONDS
    for sub in PRIORITY_SUBDIRS:
        root = os.path.join(ONEDRIVE_ROOT, sub) if sub else ONEDRIVE_ROOT
        if not os.path.isdir(root):
            continue
        if verbose:
            print("  looking in: " + (sub or "OneDrive (top levels)") + " ...", flush=True)
        depth = SEARCH_MAX_DEPTH if sub else 2
        hits = _scan(root, depth, deadline, verbose)
        if hits:
            best = max(hits, key=os.path.getmtime)
            try:
                write_atomic(CACHE_FILE, best + "\n")
            except OSError:
                pass
            return best
        if time.time() > deadline:
            break
    return None


def read_workbook_safely(path):
    """OneDrive/Excel can hold a lock — work from a copy, and retry once."""
    for attempt in (1, 2):
        try:
            with tempfile.TemporaryDirectory() as td:
                copy = os.path.join(td, "book.xlsx")
                shutil.copy2(path, copy)
                return read_rows(copy)
        except Exception:
            if attempt == 2:
                raise
            time.sleep(2)


# ----------------------------------------------------------------------
# shared state + the drag-and-drop / upvote save server
# ----------------------------------------------------------------------

STATE_LOCK = threading.Lock()
STATE = {"cards": []}  # latest cards straight from the workbook, pre-override


def rebuild_and_write():
    """Recompute the feed from the last-read workbook cards plus whatever
    manual moves and upvotes are on file, and write it out. Called after
    every workbook poll, and immediately after a move or a like is saved."""
    with STATE_LOCK:
        cards = list(STATE["cards"])
    overrides = load_overrides()
    votes = load_votes()
    write_feed(apply_overrides(cards, overrides), votes)


class WallActionHandler(BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _reply(self, status, payload):
        self.send_response(status)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(payload).encode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length", 0) or 0)
            body = self.rfile.read(length) if length else b""
            data = json.loads(body or b"{}")
            card_id_value = str(data.get("id", "")).strip()
            if not card_id_value:
                raise ValueError("missing id")

            if self.path == "/move":
                theme = str(data.get("theme", "")).strip()
                if theme not in VALID_THEME_KEYS:
                    raise ValueError("invalid theme")
                with STATE_LOCK:
                    overrides = load_overrides()
                    overrides[card_id_value] = {
                        "theme": theme,
                        "ts": datetime.now().isoformat(timespec="seconds"),
                    }
                    save_overrides(overrides)
                rebuild_and_write()
                self._reply(200, {"ok": True})

            elif self.path == "/like":
                with STATE_LOCK:
                    votes = load_votes()
                    votes[card_id_value] = votes.get(card_id_value, 0) + 1
                    save_votes(votes)
                    new_total = votes[card_id_value]
                rebuild_and_write()
                self._reply(200, {"ok": True, "votes": new_total})

            else:
                self._reply(404, {"ok": False, "error": "not found"})

        except Exception as e:
            self._reply(400, {"ok": False, "error": str(e)})

    def log_message(self, fmt, *args):
        pass  # keep the console focused on the feed status line


def start_wall_server():
    try:
        httpd = ThreadingHTTPServer(("127.0.0.1", SERVER_PORT), WallActionHandler)
    except OSError as e:
        print("Could not start the local save server on port "
              + str(SERVER_PORT) + " (" + str(e) + "). The wall will still "
              "display and update from the Form as normal, but dragging a "
              "note or liking one won't be saved.", flush=True)
        return
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    print("Drag-and-drop / like save server listening on http://127.0.0.1:"
          + str(SERVER_PORT), flush=True)


# ----------------------------------------------------------------------

def main():
    print("Idea Wall feed updater running.  Ctrl-C to stop.", flush=True)
    print("  OneDrive : " + ONEDRIVE_ROOT, flush=True)
    print("  Writing  : " + OUT_DIR, flush=True)
    print("", flush=True)

    start_wall_server()

    workbook = None
    last_count = -1
    last_search = 0.0
    status_line_open = False

    while True:
        try:
            if not workbook or not os.path.exists(workbook):
                if time.time() - last_search >= SEARCH_RETRY_SECONDS:
                    last_search = time.time()
                    workbook = find_workbook()
                    if workbook:
                        print("Found workbook: " + workbook, flush=True)
                    else:
                        if status_line_open:
                            print("", flush=True)
                            status_line_open = False
                        print("[" + time.strftime("%I:%M:%S %p") + "] "
                              "Workbook not found yet — retrying in "
                              + str(SEARCH_RETRY_SECONDS) + "s...", flush=True)
                        write_feed([], load_votes())
            if workbook:
                cards = build_cards(read_workbook_safely(workbook))
                with STATE_LOCK:
                    STATE["cards"] = cards
                rebuild_and_write()
                now = time.strftime("%I:%M:%S %p")
                if len(cards) != last_count:
                    if status_line_open:
                        print("", flush=True)
                        status_line_open = False
                    arrow = "" if last_count < 0 else \
                            "  (+" + str(len(cards) - last_count) + ")"
                    print("[" + now + "] " + str(len(cards))
                          + " ideas in the feed." + arrow, flush=True)
                    last_count = len(cards)
                else:
                    print("\r    checked " + now + "  ·  "
                          + str(len(cards)) + " ideas  ",
                          end="", flush=True)
                    status_line_open = True

        except KeyboardInterrupt:
            raise
        except Exception as e:
            if status_line_open:
                print("", flush=True)
                status_line_open = False
            print("[" + time.strftime("%I:%M:%S %p") + "] Skipped this pass: "
                  + type(e).__name__ + ": " + e.__str__(), flush=True)

        time.sleep(REFRESH_SECONDS)


if __name__ == "__main__":
    if "--find" in sys.argv:
        print("Searching " + ONEDRIVE_ROOT + " ...", flush=True)
        t0 = time.time()
        wb = find_workbook()
        print(("Found: " + wb) if wb else "Not found.", flush=True)
        print("Took %.1f seconds." % (time.time() - t0), flush=True)
    elif "--once" in sys.argv:
        wb = find_workbook()
        if not wb:
            print("No workbook matching " + WORKBOOK_PATTERN
                  + " under " + ONEDRIVE_ROOT
                  + " yet — the display will show a waiting screen and pick it"
                  + " up automatically once it is found.", flush=True)
            write_feed([], load_votes())
        else:
            c = build_cards(read_workbook_safely(wb))
            c = apply_overrides(c, load_overrides())
            write_feed(c, load_votes())
            print("Wrote " + str(len(c)) + " ideas from " + wb, flush=True)
    else:
        try:
            main()
        except KeyboardInterrupt:
            print("\nStopped.", flush=True)
