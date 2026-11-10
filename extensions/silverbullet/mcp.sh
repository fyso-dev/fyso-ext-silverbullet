#!/usr/bin/env bash
# OMB intentionally does not pass FYSO_ROOT to bots; derive it from this file.
set -euo pipefail
cd "$(dirname "$0")/../.."
root=$(pwd -P)
exec bash framework/scripts/run-ext.sh silverbullet -- \
  mcp-server-filesystem --confine-roots "$root/project/wiki"
