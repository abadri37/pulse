#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_BUNDLE="$ROOT_DIR/build/bin/pulse.app"
FULL_ICNS="$ROOT_DIR/build/darwin/iconfile.icns"
WAILS_BIN="${WAILS_BIN:-$(command -v wails || echo "$HOME/go/bin/wails")}"

cd "$ROOT_DIR"
"$WAILS_BIN" build

if [[ -f "$FULL_ICNS" && -d "$APP_BUNDLE/Contents/Resources" ]]; then
  cp "$FULL_ICNS" "$APP_BUNDLE/Contents/Resources/iconfile.icns"
  codesign --force --deep --sign - "$APP_BUNDLE"
  touch "$APP_BUNDLE"
  /System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$APP_BUNDLE" >/dev/null 2>&1 || true
fi

echo "Built $APP_BUNDLE with full multi-resolution Pulse icon."
