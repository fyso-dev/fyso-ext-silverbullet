#!/usr/bin/env bash
# doctor.sh [editor|upload]: without an argument, check both processes.
set -euo pipefail
part="${1:-all}"
if [ "$part" != upload ]; then
  command -v silverbullet >/dev/null
  command -v mcp-server-filesystem >/dev/null
  test -d "${FYSO_ROOT:?}/project/wiki"
  curl --fail --silent --show-error --max-time 5 --output /dev/null \
    "http://127.0.0.1:${FYSO_EXT_SILVERBULLET_PORT:?}/.fs/index.md"
fi
if [ "$part" != editor ]; then
  command -v tusd >/dev/null
  command -v pandoc >/dev/null
  command -v extract-zip >/dev/null
  test -e "${FYSO_DATA:?}/ext/silverbullet/uppy/uppy.min.mjs"
  # tus answers OPTIONS with its protocol version.
  curl --fail --silent --show-error --max-time 5 --output /dev/null -X OPTIONS \
    --unix-socket "/tmp/fyso-ext-silverbullet-${FYSO_EXT_SILVERBULLET_PORT:?}.sock" http://tusd/.kb/upload/
fi
