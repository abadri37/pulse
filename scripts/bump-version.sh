#!/usr/bin/env bash
set -euo pipefail

# Bumps Pulse version across version.go, wails.json, and frontend/package.json.
# Usage: ./scripts/bump-version.sh [patch|minor|major]

BUMP_TYPE="${1:-patch}"
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
VERSION_FILE="$ROOT_DIR/version.go"

CURRENT_VERSION="$(sed -n 's/^const AppVersion = "\([0-9]*\.[0-9]*\.[0-9]*\)"/\1/p' "$VERSION_FILE")"
if [[ -z "$CURRENT_VERSION" ]]; then
  echo "Could not read AppVersion from $VERSION_FILE" >&2
  exit 1
fi

IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT_VERSION"

case "$BUMP_TYPE" in
  major)
    MAJOR=$((MAJOR + 1))
    MINOR=0
    PATCH=0
    ;;
  minor)
    MINOR=$((MINOR + 1))
    PATCH=0
    ;;
  patch)
    PATCH=$((PATCH + 1))
    ;;
  *)
    echo "Invalid bump type: $BUMP_TYPE (use patch, minor, or major)" >&2
    exit 1
    ;;
esac

NEXT_VERSION="${MAJOR}.${MINOR}.${PATCH}"

sed -i '' "s/const AppVersion = \"${CURRENT_VERSION}\"/const AppVersion = \"${NEXT_VERSION}\"/" "$VERSION_FILE"
sed -i '' "s/\"productVersion\": \"${CURRENT_VERSION}\"/\"productVersion\": \"${NEXT_VERSION}\"/" "$ROOT_DIR/wails.json"
sed -i '' "s/\"version\": \"${CURRENT_VERSION}\"/\"version\": \"${NEXT_VERSION}\"/" "$ROOT_DIR/frontend/package.json"

echo "Bumped Pulse version: v${CURRENT_VERSION} -> v${NEXT_VERSION}"
