#!/bin/bash
# challenger: Qwen3.5-122B-A10B (multimodal MoE), 4xH100 TP=4, :8000, thinking off
#   setsid nohup bash serve_122b_tp4.sh </dev/null > /tmp/vllm_122b.log 2>&1 &
M=/inspire/hdd/project/video-understanding/public/share/models/Qwen3.5-122B-A10B
exec vllm serve "$M" \
  --served-model-name qwen3.5-122b \
  --host 0.0.0.0 --port 8000 \
  --tensor-parallel-size 4 \
  --max-model-len 32768 \
  --limit-mm-per-prompt '{"image":8,"video":0}' \
  --max-num-seqs 16 \
  --gpu-memory-utilization 0.92 \
  --trust-remote-code \
  --default-chat-template-kwargs '{"enable_thinking": false}'
