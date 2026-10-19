#!/usr/bin/env bash
# Prepares a Claude Code cloud session: yt-dlp for the yt-dlp MCP server and
# the npm packages tools/export-pdf.mjs needs. Local machines install these once
# by hand (see CLAUDE.md), so this only runs in the cloud.
set -euo pipefail

[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] || exit 0
cd "$CLAUDE_PROJECT_DIR"

command -v yt-dlp >/dev/null || pip install -q yt-dlp >&2
mkdir -p media/downloads
[ -d tools/node_modules ] || PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm ci --prefix tools --no-audit --no-fund >&2
