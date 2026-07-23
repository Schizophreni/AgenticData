#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="/inspire/hdd/project/video-understanding/public/personal/wran/projects/Zhihu"
GEN_PID="${1:?usage: watch_mcq_v2_and_sync.sh <generation-pid>}"
STATUS_FILE="${ROOT_DIR}/datasets/batch_mcq_v2_auditfix.sync.status"
GEN_LOG="/tmp/mcq_v2_auditfix.log"

printf 'waiting generation_pid=%s\n' "${GEN_PID}" >"${STATUS_FILE}"
while ! grep -q '^EXPORTED [0-9][0-9]* accepted' "${GEN_LOG}" 2>/dev/null; do
  sleep 30
done

printf 'syncing generation_pid=%s\n' "${GEN_PID}" >"${STATUS_FILE}"
cd "${ROOT_DIR}"
python3 autodata_studio/backend/scripts/sync_mcq_frontend.py
printf 'done generation_pid=%s synced_at=%s\n' "${GEN_PID}" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  >"${STATUS_FILE}"
