#!/usr/bin/env bash
# Upload receiver for the import (D59): tusd (resumable uploads, tus protocol) on a
# Unix socket behind the gateway's web login. No extra port. Uploads stay in runtime
# data until the import workflow moves them; nothing here writes into the wiki.
set -euo pipefail
cd "${FYSO_ROOT:?}"
data="${FYSO_DATA:?}/ext/silverbullet"
mkdir -p "$data/uploads"
# The picker's browser files come from the pinned npm packages (no vendored copy).
link() { # <mise tool> <directory inside node_modules> <link name>
  local dir
  dir=$(find "$(mise where "$1")" -type d -path "*/node_modules/$2" | head -n 1)
  [ -n "$dir" ] || { echo "error: $1 is not installed; run: mise install" >&2; exit 1; }
  ln -sfn "$dir" "$data/$3"
}
link npm:uppy uppy/dist uppy
link npm:@uppy/locales @uppy/locales/lib uppy-locales
socket="/tmp/fyso-ext-silverbullet-${FYSO_EXT_SILVERBULLET_PORT:?}.sock"
rm -f "$socket"
umask 077
# The gateway owns authentication and same-origin checks; uploads cannot be read back.
exec tusd -unix-sock "$socket" -base-path /.kb/upload/ -upload-dir "$data/uploads" \
  -max-size 1073741824 -disable-download -disable-cors
