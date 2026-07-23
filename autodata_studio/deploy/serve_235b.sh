#!/bin/bash
# strong + judge: Qwen3-VL-235B-A22B-Instruct (multimodal MoE), 8xH100 TP=8, :8000
#   setsid nohup bash serve_235b.sh </dev/null > /tmp/vllm_235b.log 2>&1 &
M=/inspire/hdd/project/video-understanding/public/share/models/Qwen3-VL-235B-A22B-Instruct
exec vllm serve "$M" \
  --served-model-name qwen3-vl-235b \
  --host 0.0.0.0 --port 8000 \
  --tensor-parallel-size 8 \
  --max-model-len 32768 \
  --limit-mm-per-prompt '{"image":8,"video":0}' \
  --max-num-seqs 16 \
  --gpu-memory-utilization 0.92 \
  --trust-remote-code \
  --default-chat-template-kwargs '{"enable_thinking": false}'
