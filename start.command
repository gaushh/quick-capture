#!/bin/bash
# Double-click this file to run Quick Capture.

cd "$(dirname "$0")" || exit 1

echo ""
echo "Setting up Quick Capture..."
echo ""

if ! command -v node >/dev/null 2>&1; then
  echo "================================================="
  echo " Node.js is not installed."
  echo ""
  echo " Please download and install it from:"
  echo "   https://nodejs.org  (click the green LTS button)"
  echo ""
  echo " Then double-click this file again."
  echo "================================================="
  echo ""
  read -p "Press Enter to close..."
  exit 1
fi

if [ ! -d "node_modules" ]; then
  echo "First-time setup: installing components (about 2 minutes)..."
  echo ""
  npm install --no-audit --no-fund
  echo ""
fi

echo "Launching Quick Capture..."
echo ""
echo "A small pill will appear at the bottom-right of your screen."
echo "Press Control+Space anywhere on your Mac to start recording."
echo ""
echo "To quit: close this Terminal window."
echo ""

npm run dev
