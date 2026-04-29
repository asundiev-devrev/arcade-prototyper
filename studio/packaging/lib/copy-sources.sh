#!/bin/bash
# Usage: copy-sources.sh <repo-root> <target>
# Copies the arcade-prototyper repo into <target>, excluding build artifacts,
# git data, existing node_modules, and screenshot scratch files.
set -euo pipefail

SRC="${1:?repo root required}"
DST="${2:?target required}"

mkdir -p "$DST"

rsync -a \
  --exclude ".git" \
  --exclude "node_modules" \
  --exclude "studio/packaging/dist" \
  --exclude "dist" \
  --exclude ".omc" \
  --exclude ".playwright-mcp" \
  --exclude ".worktrees" \
  --exclude ".env" \
  --exclude ".env.*" \
  --exclude "*.swp" \
  --exclude "*~" \
  --exclude ".idea" \
  --exclude ".vscode" \
  --exclude ".turbo" \
  --exclude "coverage" \
  --exclude "*.png" \
  --exclude "*.jpg" \
  --exclude "*.pdf" \
  --exclude ".DS_Store" \
  "$SRC/" "$DST/"

echo "Copied repo to $DST"
