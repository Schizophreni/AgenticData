#!/bin/bash
# challenger: Qwen3.5-35B-A3B on GPU0 only (TP=1), :8000
# 67G weights on an 80G card -> KV is tight; max-model-len trimmed to 24576 and seqs to 4.
M=/inspire/hdd/project/video-understanding/public/share/models/Qwen3.5-35B-A3B
export CUDA_VISIBLE_DEVICES=0
exec vllm serve "$M" \
  --served-model-name qwen3.5-35b \
  --host 0.0.0.0 --port 8000 \
  --max-model-len 24576 \
  --limit-mm-per-prompt '{"image":8,"video":0}' \
  --max-num-seqs 4 \
  --gpu-memory-utilization 0.95 \
  --trust-remote-code \
  --default-chat-template-kwargs '{"enable_thinking": false}'
