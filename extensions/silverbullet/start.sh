#!/usr/bin/env bash
# One project-owned Markdown folder, also used by the existing Dagu wiki.
set -euo pipefail
cd "${FYSO_ROOT:?}"
space="$FYSO_ROOT/project/wiki"
mkdir -p "$space" "$FYSO_DATA/ext/silverbullet"
# Never replace an existing home page, including when restarting or updating.
if [ ! -e "$space/index.md" ]; then
  (set -o noclobber; cat extensions/silverbullet/index.md > "$space/index.md") 2>/dev/null || [ -e "$space/index.md" ]
fi
# Stable 2.12.1 has no native MCP. Agents use the official filesystem MCP.
# Caddy owns browser authentication. No runtime browser, shell or extra history.
export SB_RUNTIME_API=0 SB_SHELL_BACKEND=off SB_REVISIONS=disabled
export SB_DISABLE_SERVICE_WORKER=1
# Native head customization keeps presentation outside project-owned wiki pages.
export SB_HEAD_HTML="${SB_HEAD_HTML:-}$(cat extensions/silverbullet/theme/head.html)"
exec silverbullet --single -L 127.0.0.1 -p "${FYSO_EXT_SILVERBULLET_PORT:?}" "$space"
