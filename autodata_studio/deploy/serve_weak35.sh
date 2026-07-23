#!/bin/bash
# weak solver: Qwen3.5-35B-A3B (multimodal MoE), 2xH100 TP=2. On the weak machine:
#   setsid nohup bash serve_weak35.sh </dev/null > /tmp/vllm_weak.log 2>&1 &
M=/inspire/hdd/project/video-understanding/public/share/models/Qwen3.5-35B-A3B
exec vllm serve "$M" \
  --served-model-name qwen3.5-35b \
  --host 0.0.0.0 --port 8000 \
  --tensor-parallel-size 2 \
  --max-model-len 32768 \
  --limit-mm-per-prompt '{"image":8,"video":0}' \
  --max-num-seqs 32 \
  --gpu-memory-utilization 0.90 \
  --trust-remote-code \
  --default-chat-template-kwargs '{"enable_thinking": false}'
