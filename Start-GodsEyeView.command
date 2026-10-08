#!/bin/bash
# One-click start for macOS/Linux: double-click (macOS) or run ./Start-GodsEyeView.command
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 24 is required: https://nodejs.org"
  open "https://nodejs.org/en/download" 2>/dev/null || xdg-open "https://nodejs.org/en/download" 2>/dev/null
  read -r -p "Press Enter to close" _
  exit 1
fi
exec node scripts/launch.mjs "$@"
