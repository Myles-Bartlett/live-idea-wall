#!/bin/bash
# Double-click this file to start the Idea Wall.
# Leave this Terminal window open for the whole summit.
# To stop everything: press Ctrl-C or close this window.

cd "$(dirname "$0")" || exit 1

echo "-------------------------------------------"
echo " Sheridan Idea Wall — Powering Growth Expo"
echo "-------------------------------------------"
echo ""

# 1. Open the display right away. It shows a waiting screen if the feed
#    isn't ready yet, and picks up ideas on its own once it is.
echo "Opening the display in your browser..."
open "idea-wall-display.html"
echo "  (Press Cmd-Ctrl-F in the browser for full screen.)"
echo ""

# 2. Keep the feed up to date from the Forms workbook in OneDrive.
#    First pass prints where it is looking; then it refreshes every 5s.
python3 build_idea_wall_feed.py
