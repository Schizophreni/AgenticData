#!/bin/bash
# strong solver: Qwen3.5-122B-A10B, 8xH100 TP=8. Run on the strong machine after restart:
#   setsid nohup bash serve_strong.sh </dev/null > /tmp/vllm_strong.log 2>&1 &
M=/inspire/hdd/project/video-understanding/public/share/models/Qwen3.5-122B-A10B
exec vllm serve "$M" \
  --served-model-name qwen3.5-122b \
  --host 0.0.0.0 --port 8000 \
  --tensor-parallel-size 8 \
  --max-model-len 32768 \
  --limit-mm-per-prompt '{"image":8,"video":0}' \
  --max-num-seqs 32 \
  --gpu-memory-utilization 0.90 \
  --trust-remote-code \
  --default-chat-template-kwargs '{"enable_thinking": false}'
