# AutoData Studio — 多图 MCQ 生成流水线(现状与流程)

> 最后更新 2026-07-19。本文档是"知乎语料 → 多图选择题(MCQ)数据集"这条流水线的
> single-source-of-truth,记录模型拓扑、逐步流程、代码层规范化、验收判定、已知限制与工程教训。
> 工作脚本:`autodata_studio` scratchpad `batch_mcq.py`(引擎复用 `autodata_studio/backend`)。

> **最新产出(2026-07-19)**:全量 30 文档跑 → **18 条 accepted(60%)**,耗时 ~5h。
> 14 answerable + 4 unanswerable;答案分布均匀(D6/B4/E4/A2/C2);任务类型 8 种。
> 门控:扫 46 doc 留 30(SKIP 掉表情包/写真/纯聊天/综艺截图,KEEP 图表/文档/多视角/产品对比)。
> 数据文件 `scratchpad/batch_mcq_accepted.jsonl`;review 页 serve 在 :8090。
> 6 条已验证子集备份在 `scratchpad/mcq_verified6.jsonl`。

---

## 1. 一句话

用 **Agentic Self-Instruct** 循环,从知乎图文语料自动合成 **多图理解选择题(五选一,含 unanswerable
变体)**,以 MuirBench / MMIU 的任务分类学为出题约束,以 **weak-vs-strong gap** 为难度验收信号,
以一个强 VLM 做质检(QV)与打分(judge)。当前 accept 率 ~50–100%(门控筛过的专业语料上)。

---

## 2. 模型角色矩阵与端点拓扑

四个角色,全部自有算力,经反向 SSH 隧道 + 本地端口转发访问(端口会漂移,用前必 re-probe):

| 角色 | 模型 | 机器(TP) | 本地端口 | 说明 |
|---|---|---|---|---|
| **challenger**(出题) | Qwen3.5-122B-A10B | 4×H100 TP=4 | 8006 | 够聪明写好选项、比 235B 快;`enable_thinking=false` 出干净 JSON |
| **weak**(弱解题器) | Qwen2.5-VL-7B | 1×H100 | 8004 | 五选一有 ~20% 猜测底噪 |
| **strong**(强解题器) | Qwen3-VL-235B-A22B-Instruct | 8×H100 TP=8 | 8005 | 判别力最强,慢(~7 tok/s) |
| **judge + QV**(质检+打分) | Qwen3-VL-235B(同上) | 8×H100 | 8005 | 与 strong 共用;QV 极严,能抓泄漏/图外引用 |

- 部署脚本固化在 `autodata_studio/deploy/serve_*.sh`(容器重建也不丢)。
- 隧道起法:`setsid nohup ssh -N -L <local>:127.0.0.1:8000 -p <sshport> root@127.0.0.1 ... &`。
- **必走 loopback**:本机有 mihomo socks 代理,发往 LAN IP 会被代理吞掉;httpx 对 127.0.0.1 有 bypass。
- 每台新机接入,跳板机上常有"僵尸/半开转发"霸占端口 → 先 `kill` 掉,等 GPU 侧自愈重建。

---

## 3. 图像类别门控(用户要求:只对接近 benchmark 视觉类型的语料造题)

知乎语料 ~90% 是聊天/自拍/表情包,不适合出多图推理题。门控在 challenger 之前预筛:

- **模型**:235B(7B 判别不可靠——会把统计表/文档误杀、视觉幻觉)。
- **关键工程点**:门控输出必须极简(`{"suitable":bool,"category":"短标签"}`,`max_tokens=48`)。
  否则 235B 会写长描述,单次从 ~3s 涨到 ~50s。只看前 4 张图判类型即可。
- **判据**:能否出一道"必须看图、跨≥2 图、非记忆型"的题。适合=图表/示意图/文档公告/对比图/
  多视角照片/数据表;不适合=纯聊天、自拍写真、走秀穿搭、表情包、风景装饰。
- **early-stop**:扫到够 `target` 个 PASS 就停(不用扫满)。收紧后通过率 ~60–70%。
- 实测:11s/doc,7 个已知标签测 5/7(边界:含信息聊天、走秀偏宽松,交给下游 QV 精筛)。

---

## 4. MCQ 生成流程(逐文档)

```
门控(§3) 通过的文档 d
  └─ 循环(step_budget=4):
      1. challenger(122B): 读 d 的图文 + 任务分类学(§8) → 出
         {question(题干), options(5项), correct_answer(字母), task_type, rubric, reference_answer}
      2. 代码层规范化(§5) —— 关键,不靠模型自觉:
         · 选项补 E(缺 E 自动补"Cannot be determined")
         · 位置随机化(打乱 A-D,消除 122B 全 A 偏差)
         · rubric/reference 强制与 correct 字母一致(否则自相矛盾被 QV 拒)
         · 拼接 solver 可见的完整题面(题干 + 五选项)
      3. QV(235B): 只审三件事 —— 选项是否 image-grounded、正确答案是否唯一、stem 有无泄漏。
         不因 rubric/reference 的细节挑刺。FAIL → 带 feedback 重来。
      4. weak solver(7B) ×k_weak: 只看图答题
      5. 省算力门:weak 太强(蒙对过多)→ 判 too_easy,重来
      6. strong solver(235B) ×k_strong: 只看图答题
      7. gap 判定(§6): verifiable 模式,weak≤2/3 且 strong≥2/3 → accept,否则 improve 重来
  └─ accept → 落库 + 导出;step_budget 耗尽 → reject
```

---

## 5. 代码层规范化(本流水线最关键的一课)

**不要指望模型遵守格式约束,能代码兜底的一律代码兜底。** 三处:

1. **选项补 E**:E 永远是固定的"Cannot be determined",122B 常漏掉它 → 代码保留前 4 个非 E 选项 +
   追加标准 E。只有真的<4 个实质选项才判失败重试。
2. **位置随机化**:122B 几乎总把正确答案放 A(实测 12/13)→ 代码打乱 A-D 内容、重贴字母、更新
   correct_answer。实测打散后 A/B/C/D 均匀(~25% each)。
3. **rubric/reference 强制一致**:⚠️ 位置随机化改了答案字母,但模型原来的 rubric/reference 仍写着
   旧字母 → **题目自相矛盾** → 235B QV 拒掉每一条。修法:随机化后代码强制
   `rubric=[单条"选对<letter>"]`、`reference="The correct answer is option <letter>."`。
   **这是 accept 率从 10% 飙到 100% 的直接原因。**

---

## 6. gap 验收(verifiable 模式)

MCQ 有唯一正确字母,用二值正确数计数最干净:

- `k_weak=3, k_strong=3`;`weak_max_correct=2`(五选一有猜测底噪,允许弱模型蒙对≤2 次);
  `strong_min_correct=2`(强模型 3 次至少对 2 次)。
- 核心信号:strong 会、weak 不太会 → 题有真难度且可解 → 保留。
- 门控筛过的专业题上,gap 通常健康(strong 普遍全对,weak 0–0.67)。

---

## 7. unanswerable(现状 + 计划)

**用户要求**:数据集含 unanswerable 题(E = 证据不足时的正确答案),测模型幻觉抑制/弃答能力。

- **现状(毒化法)**:把可答题的正确选项文字替换成错误说法,使 E 成为唯一正确。**有根本缺陷**:
  图片证据没动,235B QV 常识破"图其实能推出答案,只是没列出"。修 rubric 一致后能过少量(6 条里出 2 个)。
- **正确方案(MuirBench Image Manipulation,待实现)**:不动选项,**动图片**——把承载判别证据的
  关键图**替换成同域无关图**,证据物理上真缺失,题干引用不悬空(图还在,只是内容无关)。
  流程:challenger 出题时标注"关键证据图" → 替换该图 → 235B judge 验证"现有图不足以回答"。
  参考:MuirBench(2406.09411)三法占比:改图 24% / 改问题 35% / 改选项 40%(我们现用的是最弱一种)。
  补充批量法:TDIUC 式"移花接木"(把 A 的题配到 B 的无关图上)。

---

## 8. 任务分类学(出题约束,来自 MuirBench/MMIU/BLINK/MIRB/ReMI/Mantis 归并)

12 类,challenger 出题时选一个,标注 `task_type`。优先高产类:
`multi_hop`(多跳跨图推理)、`comparison`(对比)、`chart_table`(图表联读)、`temporal_order`(时序)、
`comprehensive`(综合描述)、`retrieval_matching`(检索匹配);看图适配:`difference_spotting`/
`action_event`/`narrative`;稀缺(不硬凑):`multi_view_spatial`/`counting`/`geographic`。
硬约束:题必须显式引用≥2 图、单图不可解。

---

## 9. 工程教训(反复踩过)

1. **慢速 MoE 的 max_tokens 铁律**:122B/235B decode ~7 tok/s,输出长度主导延迟。challenger 8192→2048、
   门控→48。给太大 → 模型写到上限 → 单次几分钟甚至超时。
2. **代码兜底 > 提示词祈祷**:选项数、答案位置、rubric 一致性,全部代码强制(§5)。
3. **网络健壮性**:provider 层对 5xx/429/传输错误重试(指数退避 + 尊重 Retry-After);judge/QV 返回
   数组时类型守卫,不崩整题。
4. **落库排障**:challenger 异常也写一行 `challenger_error` 到 rounds,否则复现不出来。
5. **外部 API 有配额**:曾用小米 mimo-v2.5,配额耗尽('quota exhausted')卡死全量 → 全迁自有算力。
6. **pgrep/pkill -f 会匹配自己命令行**(exit 144)→ 用 `[x]` 括号或按 pid 精确杀。

---

## 10. 数据格式(导出 JSONL,每行一条 accepted)

```json
{
  "doc_id": "zh_...", "task_type": "comparison", "answerable": true,
  "question": "题干\n\nA. ...\nB. ...\nC. ...\nD. ...\nE. Cannot be determined from the given images",
  "options": ["A. ...", ..., "E. Cannot be determined from the given images"],
  "correct_answer": "C",
  "reference": "The correct answer is option C.",
  "rubric": [{"number":1,"criterion":"The final selected option is C","weight":10}],
  "images": ["/abs/path/v2-<hash>_720w.jpg", ...],
  "weak_avg": 0.33, "strong_avg": 1.00, "gap": 0.67, "rounds": 2
}
```

---

## 11. 运行 / 复现

```bash
# 环境: 四端点隧道就绪(8006/8004/8005 + 门控用 8005)
export AUTODATA_HTTP_TIMEOUT=400
MCQ_DOCS=30 MCQ_GATE=1 python3 batch_mcq.py     # 门控 + 全量 30
# 关键参数(batch_mcq.py 内): challenger=122B(8006,mt2048), weak=7B(8004), strong/judge=235B(8005)
#   GapConfig(mode=verifiable, k_weak=3, k_strong=3, weak_max_correct=2, strong_min_correct=2, step_budget=4)
# 产出: batch_mcq_accepted.jsonl;review 页: python gen_mcq_html.py <jsonl> <out.html>,serve 到 :8090
```

---

## 12. 待办

- [ ] unanswerable 改用 MuirBench 替换法(§7),替代被识破的毒化法
- [ ] 前端集成:门控开关、MCQ 模式、verifiable gap、预览面板显示选项+正确答案+可答性(见前端分支)
- [ ] 规模化产出(当前 30 条,235B 慢约 6–8h)+ 数据集级去重/多样性平衡
