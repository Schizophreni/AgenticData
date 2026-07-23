#!/usr/bin/env bash
# GPU holder + VLM launcher.
# Properties:
#   - waits for all GPUs to stay below IDLE_UTIL_MAX for 5 minutes;
#   - starts the holder once, then launches vLLM;
#   - if the holder is killed, it is NOT restarted;
#   - the supervisor stays alive and keeps vLLM alive;
#   - TERM/INT clean up only processes started by this script.
set -u

GPUS=${GPUS:-}
MATRIX=${MATRIX:-8192}
PYTHON=${PYTHON:-/inspire/hdd/project/video-understanding/public/personal/lojuncao/anaconda3/envs/data_filter/bin/python}
IDLE_UTIL_MAX=${IDLE_UTIL_MAX:-30}
IDLE_SAMPLES=${IDLE_SAMPLES:-30}
IDLE_INTERVAL=${IDLE_INTERVAL:-10}

# Override these per machine, or export VLLM_CMD before launching.
VLLM_CMD=${VLLM_CMD:-}
VLLM_PID=""
WORKER_PID=""
WORKER_PIDS=()
WORKER_PY=""

log() { echo "[$(date '+%F %T')] $*"; }

command -v nvidia-smi >/dev/null 2>&1 || { log "nvidia-smi not found"; exit 1; }
"$PYTHON" -c 'import torch; assert torch.cuda.is_available()' 2>/dev/null || {
  log "CUDA python unavailable: $PYTHON"; exit 1;
}

if [ -n "$GPUS" ]; then
  IFS=',' read -ra GPU_LIST <<< "$GPUS"
else
  mapfile -t GPU_LIST < <(nvidia-smi --query-gpu=index --format=csv,noheader,nounits)
fi
[ "${#GPU_LIST[@]}" -gt 0 ] || { log "no GPUs found"; exit 1; }

wait_for_idle() {
  local good=0 util
  log "waiting for all GPUs below ${IDLE_UTIL_MAX}% for $((IDLE_SAMPLES * IDLE_INTERVAL)) seconds"
  while [ "$good" -lt "$IDLE_SAMPLES" ]; do
    util=$(nvidia-smi --query-gpu=utilization.gpu --format=csv,noheader,nounits |
      awk -v limit="$IDLE_UTIL_MAX" '{ if (($1 + 0) >= limit) bad=1 } END { print bad ? 100 : 0 }')
    if [ "$util" = "0" ]; then
      good=$((good + 1)); log "idle sample ${good}/${IDLE_SAMPLES}"
    else
      good=0; log "GPU busy; reset idle timer"
    fi
    [ "$good" -lt "$IDLE_SAMPLES" ] && sleep "$IDLE_INTERVAL"
  done
}

make_worker() {
  WORKER_PY=$(mktemp /tmp/gpu_hold_worker.safe.XXXXXX.py)
  cat > "$WORKER_PY" <<'PY'
import sys, torch
n = int(sys.argv[1])
torch.cuda.set_device(0)
a = torch.randn(n, n, device="cuda")
b = torch.randn(n, n, device="cuda")
while True:
    for _ in range(64):
        a = a @ b
        a = a / a.norm()
    torch.cuda.synchronize()
PY
}

start_holder_once() {
  make_worker
  for gpu in "${GPU_LIST[@]}"; do
    CUDA_VISIBLE_DEVICES="$gpu" "$PYTHON" "$WORKER_PY" "$MATRIX" &
    WORKER_PID=$!
    WORKER_PIDS+=("$WORKER_PID")
    log "started holder GPU=$gpu pid=$WORKER_PID"
  done
}

start_vllm() {
  [ -n "$VLLM_CMD" ] || { log "VLLM_CMD is empty; leaving vLLM untouched"; return 0; }
  bash -lc "$VLLM_CMD" &
  VLLM_PID=$!
  log "started vLLM pid=$VLLM_PID"
}

cleanup() {
  trap - INT TERM EXIT
  log "stopping processes started by safe supervisor"
  [ -n "$VLLM_PID" ] && kill "$VLLM_PID" 2>/dev/null || true
  for pid in "${WORKER_PIDS[@]}"; do kill "$pid" 2>/dev/null || true; done
  [ -n "$WORKER_PY" ] && rm -f "$WORKER_PY"
  exit 0
}
trap cleanup INT TERM EXIT

wait_for_idle
start_holder_once
start_vllm

# Deliberately do not restart a worker after it exits. A manual kill is final.
while true; do
  if [ -n "$VLLM_PID" ] && ! kill -0 "$VLLM_PID" 2>/dev/null; then
    log "vLLM exited; supervisor remains alive and will not restart it"
    VLLM_PID=""
  fi
  sleep 10
done
