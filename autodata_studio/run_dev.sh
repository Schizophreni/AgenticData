#!/usr/bin/env bash
# Launch AutoData Studio behind a path-prefixed notebook/VSCode proxy.
# - clears all proxy env vars (they break port-forwarding / probing)
# - serves the frontend as a RELATIVE-base production build via `vite preview`
#   so assets + /api resolve correctly under https://host/.../proxy/5173/
set -e
here="$(cd "$(dirname "$0")" && pwd)"

# strip every proxy variable from this shell (and thus the children)
unset http_proxy https_proxy all_proxy ftp_proxy no_proxy \
      HTTP_PROXY HTTPS_PROXY ALL_PROXY FTP_PROXY NO_PROXY \
      npm_config_proxy npm_config_https_proxy npm_config_http_proxy npm_config_noproxy

# backend
( cd "$here/backend" && python -m uvicorn autodata.app:app --host 0.0.0.0 --port 8000 ) &
BACK=$!
trap "kill $BACK 2>/dev/null || true" EXIT

# frontend: build once, then serve the static bundle (rebuild after code changes)
cd "$here/frontend"
npm run build
exec ./node_modules/.bin/vite preview --host 0.0.0.0 --port 5173 --strictPort
