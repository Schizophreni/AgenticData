#!/bin/bash
# weak solver: Qwen2.5-VL-7B, single GPU. Run on the weak machine after restart:
#   setsid nohup bash serve_weak.sh </dev/null > /tmp/vllm_weak.log 2>&1 &
M=/inspire/hdd/project/video-understanding/public/share/models/Qwen2.5-VL-7B-Instruct
export CUDA_VISIBLE_DEVICES=0
exec vllm serve "$M" \
  --served-model-name qwen2.5-vl-7b \
  --host 0.0.0.0 --port 8000 \
  --max-model-len 32768 \
  --limit-mm-per-prompt '{"image":8,"video":0}' \
  --max-num-seqs 32 \
  --gpu-memory-utilization 0.85 \
  --trust-remote-code
