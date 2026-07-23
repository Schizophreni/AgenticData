#!/usr/bin/env bash
set -u

# Resumable IconQA production supervisor. The target counts accepted examples,
# not attempted source documents. It continues the validated pilot database so
# accepted pilot examples remain part of the final 10k.
ROOT_DIR="/inspire/hdd/project/video-understanding/public/personal/wran/projects/Zhihu"
SCRATCH_DIR="/tmp/claude-0/-inspire-hdd-project-video-understanding-public-personal-wran-projects-Zhihu/8015243a-5b19-453d-b06c-99d1b532e25a/scratchpad"
BATCH_SCRIPT="${SCRATCH_DIR}/batch_mcq.py"
DB_PATH="${MCQ_DB:-${ROOT_DIR}/datasets/batch_mcq_iconqa_pilot.sqlite3}"
OUTPUT_PATH="${MCQ_OUTPUT:-${ROOT_DIR}/datasets/batch_mcq_iconqa_10k_accepted.jsonl}"
STATE_PATH="${MCQ_STATE:-${ROOT_DIR}/autodata_studio/backend/var/iconqa_10k.cursor}"
STATUS_PATH="${MCQ_STATUS:-${ROOT_DIR}/autodata_studio/backend/var/iconqa_10k.status.json}"
LOCK_PATH="${MCQ_LOCK:-${ROOT_DIR}/autodata_studio/backend/var/iconqa_10k.lock}"
TARGET_ACCEPTED="${MCQ_TARGET_ACCEPTED:-10000}"
SHARD_DOCS="${MCQ_SHARD_DOCS:-50}"
WEAK_PORT="${MCQ_PRODUCTION_WEAK_PORT:-8104}"
STRONG_PORT="${MCQ_PRODUCTION_STRONG_PORT:-8105}"
CHALLENGER_PORT="${MCQ_PRODUCTION_CHALLENGER_PORT:-8110}"
JUDGE_PORT="${MCQ_PRODUCTION_JUDGE_PORT:-8111}"

mkdir -p "$(dirname "${STATE_PATH}")"
exec 9>"${LOCK_PATH}"
if ! flock -n 9; then
  echo "another IconQA 10k supervisor already holds ${LOCK_PATH}" >&2
  exit 2
fi

accepted_count() {
  local fallback=0 count="" attempt
  if [[ ! -f "${DB_PATH}" ]]; then
    if [[ -s "${STATUS_PATH}" ]]; then
      fallback="$(jq -r '.accepted // 0' "${STATUS_PATH}" 2>/dev/null || echo 0)"
    fi
    echo "${fallback}"
    return
  fi
  # The frontend sync daemon also reads/writes SQLite. A brief lock must not
  # make progress jump back to zero or inflate the next shard's remaining
  # target. Retry, then retain the last published monotonic value.
  if [[ -s "${STATUS_PATH}" ]]; then
    fallback="$(jq -r '.accepted // 0' "${STATUS_PATH}" 2>/dev/null || echo 0)"
  fi
  [[ "${fallback}" =~ ^[0-9]+$ ]] || fallback=0
  for attempt in 1 2 3; do
    count="$(sqlite3 -cmd '.timeout 5000' "${DB_PATH}" \
      "SELECT count(*) FROM examples WHERE status='accepted';" 2>/dev/null)" || count=""
    if [[ "${count}" =~ ^[0-9]+$ ]]; then
      if (( count < fallback )); then
        echo "${fallback}"
      else
        echo "${count}"
      fi
      return
    fi
    sleep 1
  done
  echo "${fallback}"
}

write_status() {
  local phase="$1" accepted="$2" cursor="$3" note="${4:-}"
  local tmp="${STATUS_PATH}.tmp"
  jq -n \
    --arg phase "${phase}" \
    --arg note "${note}" \
    --argjson accepted "${accepted}" \
    --argjson target "${TARGET_ACCEPTED}" \
    --argjson cursor "${cursor}" \
    --arg updated_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    '{phase:$phase,accepted:$accepted,target:$target,cursor:$cursor,note:$note,updated_at:$updated_at}' \
    >"${tmp}"
  mv "${tmp}" "${STATUS_PATH}"
}

models_ready() {
  local spec port expected body model
  for spec in \
    "${WEAK_PORT}:qwen2.5-vl-7b" \
    "${STRONG_PORT}:qwen3-vl-235b" \
    "${CHALLENGER_PORT}:qwen3-vl-235b" \
    "${JUDGE_PORT}:qwen3-vl-235b"; do
    port="${spec%%:*}"
    expected="${spec#*:}"
    body="$(env -u http_proxy -u https_proxy -u all_proxy \
      -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY \
      curl --noproxy '*' -fsS --max-time 8 \
      "http://127.0.0.1:${port}/v1/models" 2>/dev/null)" || return 1
    model="$(jq -r '.data[0].id // empty' <<<"${body}")"
    [[ "${model}" == *"${expected}"* ]] || return 1
  done
}

# The production stream always begins at zero. Pilot examples may come from a
# later hard bucket; MCQ_RESUME skips any accepted doc IDs when production reaches them.
cursor=0
if [[ -s "${STATE_PATH}" ]]; then
  read -r cursor <"${STATE_PATH}"
fi
[[ "${cursor}" =~ ^[0-9]+$ ]] || cursor=0

# Do not contend with the five-item validation run.
while tmux has-session -t iconqa-pilot 2>/dev/null; do
  accepted="$(accepted_count)"
  write_status "waiting_for_pilot" "${accepted}" "${cursor}" "pilot still running"
  sleep 30
done

while true; do
  accepted="$(accepted_count)"
  if (( accepted >= TARGET_ACCEPTED )); then
    write_status "done" "${accepted}" "${cursor}" "target reached"
    echo "TARGET REACHED accepted=${accepted}/${TARGET_ACCEPTED}"
    exit 0
  fi

  if ! models_ready; then
    write_status "waiting_for_models" "${accepted}" "${cursor}" \
      "need weak=${WEAK_PORT}, strong=${STRONG_PORT}, challenger=${CHALLENGER_PORT}, judge=${JUDGE_PORT}"
    sleep 30
    continue
  fi

  remaining=$((TARGET_ACCEPTED - accepted))
  shard="${SHARD_DOCS}"
  if (( remaining < shard )); then shard="${remaining}"; fi
  write_status "running" "${accepted}" "${cursor}" "starting shard_docs=${shard}"

  env -u http_proxy -u https_proxy -u all_proxy \
    -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY \
    MCQ_DATASET=iconqa \
    MCQ_RESUME=1 \
    MCQ_GATE=0 \
    MCQ_DB="${DB_PATH}" \
    MCQ_OUTPUT="${OUTPUT_PATH}" \
    MCQ_DOCS="${shard}" \
    MCQ_START="${cursor}" \
    MCQ_MAX_INFLIGHT="${MCQ_PRODUCTION_MAX_INFLIGHT:-8}" \
    MCQ_HTTP_TIMEOUT=600 \
    MCQ_HTTP_RETRIES="${MCQ_PRODUCTION_HTTP_RETRIES:-3}" \
    MCQ_WEAK_PORT="${WEAK_PORT}" \
    MCQ_STRONG_PORT="${STRONG_PORT}" \
    MCQ_CHALLENGER_PORT="${CHALLENGER_PORT}" \
    MCQ_JUDGE_PORT="${JUDGE_PORT}" \
    MCQ_CHALLENGER_MAX_TOKENS=512 \
    MCQ_JUDGE_MAX_TOKENS=512 \
    python -u "${BATCH_SCRIPT}" &
  child_pid=$!

  while kill -0 "${child_pid}" 2>/dev/null; do
    accepted="$(accepted_count)"
    write_status "running" "${accepted}" "${cursor}" \
      "child_pid=${child_pid} shard_docs=${shard}"
    sleep 30
  done
  wait "${child_pid}"
  rc=$?

  if (( rc == 0 )); then
    cursor=$((cursor + shard))
    printf '%s\n' "${cursor}" >"${STATE_PATH}"
    accepted="$(accepted_count)"
    write_status "between_shards" "${accepted}" "${cursor}" "previous shard completed"
  else
    accepted="$(accepted_count)"
    write_status "retrying_shard" "${accepted}" "${cursor}" "child exit=${rc}"
    sleep 30
  fi
done
