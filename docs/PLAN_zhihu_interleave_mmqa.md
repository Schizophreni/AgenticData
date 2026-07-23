# Zhihu 高质量 Interleave / 多图理解数据集构建方案

> 版本 v1.0 · 2026-07-04 · 状态：**方案评审中，未启动生成**
>
> 目标：从已下载的知乎回答语料构建两个数据集：
> (A) **图文交错（interleaved）预训练数据集** —— 对标 CoMM 质量标准；
> (B) **多图理解指令数据集（multi-image QA）** —— 对标 Mantis / MMDU 标准。
>1
> 核心质量要求（用户验收标准）：**① 文本必须与图片强相关（image-grounded）；② 内容必须专业（知识型，非观点/闲聊/饭圈）。**

---

## 1. 源数据实况（已实测验证）

路径：`/inspire/qb-ilm2/project/video-understanding/public/lance_hub/Zhihu/download`
（注意：**不是 Lance 数据集**，尽管在 lance_hub 目录下）
1
| 组成 | 内容 |
|---|---|
| `zhihu_answers/zhihu_good_answers{,2,3,4}.jsonl` | 共 **9,596,729 条**回答，~48GB。每条 = 一个知乎回答 |
| `img/` + `img2/` | ~9.9M + ~1.46M 张本地图片，扁平目录，命名 `v2-<32hex hash>_720w.<ext>` |
| `img_zip/` | 146 个原始批次 zip（~64GB），可用于补图 |

**记录 schema 要点：**
- `content`：回答正文 **HTML**，`<img>` 内联、顺序保真（原生排版，同 OBELICS 采集方式）
- `question.title`：唯一可用的话题信号（**无任何 topic/tag/category 字段**；`question_type` 99.96% 恒为 normal；`extras` 全空；URL 是纯 id API 地址无 slug）
- `upVoteCount / likeCount / commentCount / favorites`：engagement 指标（likeCount==thanksCount，冗余）
- `img_path`（27.3% 填充）：爬虫注入的已下载图片清单，可作图片存在性的快速信号
- `img_error / img_failed_urls`（<0.2%）：下载不全标记 → 直接剔除
- `status`：1=有效（99.9%）

**图片解析规则（已验证正确）：**
- 同一张图跨 `src`(720w 或 data:SVG占位) / `data-actualsrc`(720w) / `data-original`(_r 原图) 多属性出现，URL 内嵌内容 hash `v2-<32hex>`
- 正确解法：**抽 hash → 归一到本地 `v2-<hash>_720w.<ext>` 查找**；过滤 `data:` SVG 占位；公式图（`equation?tex=`）不算内容图，其 LaTeX 在 `alt` 属性中
- HTML `<img>` 自带 `data-rawwidth / data-rawheight` → **分辨率过滤零成本**

**关键统计（3k–30k 样本实测）：**

| 指标 | 数值 | 全量外推 |
|---|---|---|
| 含图回答 | 27–31% | ~2.9M 条 |
| 多图回答（≥2 distinct） | 21% | ~2M 条 |
| 本地图片覆盖率（hash 归一后） | 81.1% | — |
| 图/答案 分布 | p50=4, mean=12, p99=106, max=1186 | 长尾是图墙 |
| 文本含图片指代（如图/图N/下图…） | 仅 9.7%（含图答案中） | grounding 天然稀缺 |
| 观点/社会类标题（如何看待/如何评价…） | 28.7% | 主要噪声源 |

**两个反直觉事实（决定方案设计）：**
1. **engagement 与专业度负相关**——高赞答案几乎全是情感/社会/时事观点文。upvote 只能当弱 tie-break，绝不能当质量主筛。
2. **专业 vs 闲聊无元数据可筛**——必须依赖 文本信号（规则）+ 模型评审（LLM/VLM）。

---

## 2. 对标开源标准（已调研核实）

### 2.1 Interleave 预训练数据集

| 数据集 | 对我们的启示 |
|---|---|
| **MMC4** (2304.06939) | CLIP 图文二部图匹配（sim<0.15 丢图）；core split：2–15 图/doc；phash 去重、频次>10 丢图 |
| **OBELICS** (2306.16527) | **原生排版无需 CLIP 过滤**（我们同类）；1–30 图/doc；图片短边 150–20000px、AR∈[0.5,2]；文本启发式（长度/重复率/标点比/困惑度）；图片 URL 频次>10 全语料删除；同域段落去重 |
| **OmniCorpus** (2406.08418) | 5 级流水线存活 0.2%；**中文先例（-CW 1.2B docs）**：BERT 类打分器（流畅/广告/色情/政治/毒性）+ ~40 条中文可读性人工规则；MinHash 0.8 文档去重；美学分<3.7 丢图；水印率审计（8%） |
| **CoMM** (2406.10462) | **最贴近的模板**（教程/开发类内容，中位 4 图/doc）：CLIP 预筛 sim<0.1 丢 → **LLM 评审 0–10 分三维：Development / Completeness / Image-Text Interleaving，保留 ITA≥4**；图使用 VLM caption 代入 LLM |

**结论：CLIP 对齐分对原生排版数据非必需（作 metadata 发布即可）；2024+ 数据集的分水岭是「LLM/VLM 文档级评审」。**

### 2.2 多图 QA 数据集

| 数据集 | 对我们的启示 |
|---|---|
| **M4-Instruct** (2407.07895) | 9 类多图任务分类学：找不同/编辑指令/故事/多图VQA/低层对比/图文匹配/拼图等；混 ~40% 单图回放防遗忘 |
| **Mantis-Instruct** (2405.01483) | **4 项跨图技能：共指 / 比较 / 推理 / 时序**；问题必须真正跨 ≥2 图且带显式指代（"第二张图中…"）；平均 4.7 图/样本 |
| **MMDU** (2406.11833) | 图片真实相关（聚类 τ=0.75）；GPT-4o 生成 + `<image-i>` 标签；训练集 2–5 图/样本；人审抽检错误率 <5% |

**结论：当前"图组+标题当 prompt"的产物不满足任何标准；多图 QA 必须 VLM 生成跨图问题。**

---

## 3. 已完成的原型与差距

| 阶段 | 产物 | 状态 |
|---|---|---|
| naive 解析原型 | `scripts/assemble_prototype.py` | ✅ 验证图片管线（零丢图、顺序正确、公式/占位过滤正确）；❌ 文本压平成 blob、7.5% 退化样本、质量 C+ |
| 规则策展原型 | `scripts/assemble_curated.py` → `scripts/curated_out/` | ✅ 块级解析 + 指代硬门槛 + 观点标题剔除 + 密度带 + 相关性窗口（中位砍掉 60% 无关文本）；存活 1.03%（205/20k），产物以分步教程为主 |

**已验证的规则策展效果**：样本从"ao3/明星/观点文"变成"电工电路逐图讲解 / MATLAB BP 神经网络分步教程"。
**残留问题（规则的天花板）**：grounding 好但不专业的样本仍通过（例：BTS 官咖注册教程）——领域词只能加分排序，做硬门槛会误杀 → **专业度精筛必须靠 LLM**。

**与标准的差距清单（按重要度）：**
1. ❌ LLM/VLM 文档级评审（CoMM 三维 + 专业度）—— 两项用户抱怨的标准答案
2. ❌ 图片有效性规则（`data-rawwidth/rawheight` 分辨率/AR，零成本）
3. ❌ 语料级图片频次去重（知乎分割线图/表情包/广告横幅是重灾区）
4. ❌ 文档级 MinHash 去重（同一问题下近重复回答）
5. ❌ NSFW/毒性过滤（图+文）
6. ❌ OBELICS 式文本质量启发（重复率/标点比）
7. ❌ CN-CLIP 相似度 metadata、水印/美学审计
8. ❌ 多图 QA 整体重做（VLM 生成）

---

## 4. 目标流水线设计

### 4.0 总体架构（漏斗）

```
960万回答
  │ Stage 0  卫生过滤（status/空文/img_error）              ~99% 通过
  │ Stage 1  解析+图片解析（块级 interleave，hash→本地路径）  含图 27% → ~260万
  │ Stage 2  规则策展（图数带/密度带/指代门槛/观点剔除/
  │          图片有效性/频次去重/文本启发/MinHash 去重）      ~1% → ~8–10万 候选
  │ Stage 3  模型评审（LLM/VLM 打分，CoMM 三维+专业度）       保留 ~40–60% → ~4–6万
  ├─→ 产物 A: interleave 数据集（core split）
  │ Stage 4  VLM 合成（对 Stage 3 通过者生成跨图 QA）
  ├─→ 产物 B: multi-image QA 数据集
  │ Stage 5  验收审计（抽检 + 统计报告 + metadata 层）
  └─→ 数据卡（datacard）+ 审计报告
```

### 4.1 Stage 0 — 卫生过滤

丢弃：`status != 1`；`content` 空；`question_type != normal`；含 `img_error/img_failed_urls`。
字段清理：丢 `thanksCount`（=likeCount）、`extras`（全空）。

### 4.2 Stage 1 — 解析与图片解析

- lxml 块级遍历（`p/li/h*/blockquote/figure/figcaption/pre/table` 为块边界），文档序输出 `text|image` 序列
- 图片：抽 `v2-<hash>` → 查 `img/`、`img2/` 的 `_720w.<ext>`；`data:` 占位过滤；相邻同 hash 去重
- **公式图**：抽 `alt`/`tex=` 内联为 `$...$` 文本（不当图、不丢内容）
- **超链接**：保留为 `[锚文本](url)`；视频嵌入打 `<video:url>` 标记
- `<figcaption>` 单独成块并打 `is_caption` 标记
- 全量运行前**预建图片索引**（一次扫描 11.4M 文件 → basename→path 的 sqlite/parquet 索引），避免逐图 stat

### 4.3 Stage 2 — 规则策展（cheap gate）

**答案级硬门槛：**
| 规则 | 阈值 | 依据 |
|---|---|---|
| distinct 图数带 | 2 ≤ n ≤ 30（core split 收紧到 2–15） | OBELICS / MMC4-core |
| 本地在档图数 | ≥ 2，且在档率 ≥ 70% | 防退化样本 |
| grounding 密度带 | 30 ≤ 可见字符/图 ≤ 600 | 实测分布，剔图墙与图稀prose |
| 图片指代 | 全文含 ≥1 处（如图/图N/上下图/箭头/红框…） | 精度杠杆（可配置放宽为排序项） |
| 观点标题剔除 | 命中 OPINION_RE 即丢 | 28.7% 噪声源 |
| 图片有效性 | 短边 ≥150px、AR∈[0.5,2]（用 data-rawwidth/height） | 全标准通用 |
| 语料级图片频次 | 同 hash 出现 >10 答案 → 该图删除（分割线/表情包/广告） | MMC4/OBELICS |
| 文本启发 | 字符重复率 ≤0.1、标点比合理、段长带 | OBELICS |
| MinHash 去重 | 答案正文 Jaccard ≥0.8 去重（尤其同 question 下） | OmniCorpus |

**文本裁剪（解决"图文无关文本"）：**
- 相关性窗口：保留 图片 ±1 块 + 含指代块 + caption 块；其余正文丢弃
- 窗口半径与"是否保留开头引言块"做成参数，供消融

**排序分（不做硬门槛）：** 领域词命中 +2；结构信号（code/table/ol/figcaption/h2-3）各 +1；指代次数 +min(n,5)；log(upvote) 仅作 tie-break。

### 4.4 Stage 3 — 模型评审（决定性环节，需模型资源）

对 Stage 2 存活的 ~8–10万候选，用 VLM（直接看图；候选量小，不必走 CoMM 的 caption 间接法）逐 doc 打分：

**评分 rubric（0–10 × 4 维，输出 JSON）：**
1. **Development（发展性/逻辑推进）** —— CoMM 维度
2. **Completeness（完整性）** —— CoMM 维度
3. **Image-Text Interleaving（图文交错贴合度：文本是否真的在讲这些图）** —— CoMM 维度，对应抱怨①
4. **Professionalism（专业度：知识/教程/技术 vs 观点/闲聊/饭圈）** —— 自定维度，对应抱怨②

**保留规则（初值，需在 500 条标定集上校准）**：ITI ≥ 4 且 Professionalism ≥ 5 且其余 ≥ 3。
**校准流程**：人工标 200–500 条 → 调 prompt 与阈值 → 报告与人工判断的一致率（目标 ≥85%）。
**产出**：每条附 4 维分数 metadata；按分数分层（core / full 两个 split）。

### 4.5 Stage 4 — 多图 QA 合成（需 VLM 资源）

种子：Stage 3 通过的教程/知识型样本（图天然同源、语义相关，满足 MMDU 相关性要求且无需聚类）。

- **任务分类学（按 Mantis 4 技能 + M4 任务型）**：跨图比较、共指（"第 2 张图中的元件在第 4 张图里…"）、时序/步骤推理（教程步骤天然有序）、细节定位、基于全序列的总结/流程问答
- **生成约束**：每问必须**依赖 ≥2 张图**才能回答；使用显式 `<image-i>` 指代；答案须可从图+文验证；每样本 2–5 图（超出的做窗口切分）
- **过滤**：生成后跑一遍 VLM 自检（"只看第 i 张图能否答对？能 → 丢弃"）+ 规则查指代完整性
- **人审抽检**：≥200 条，错误率目标 <5%（MMDU 标准）

### 4.6 Stage 5 — metadata 与审计

- CN-CLIP 图文相似度（作 metadata，core split 可选 gate ≥0.20）
- NSFW（图分类器，保守阈值 0.1 丢全 doc）+ 中文毒性/广告分
- 水印率、人脸率抽样审计并写入数据卡
- 数据卡：来源、许可与合规说明、漏斗各级存活率、分布统计、已知局限

### 4.7 输出格式

- **主格式 JSONL manifest**（每行一样本；图片存本地绝对/相对路径 + hash；interleave 用 `sequence` 数组，QA 用 `messages` + `images` 数组）
- 大规模训练需要时二次导出 **WebDataset tar 分片**（图字节打包）；保留导出脚本
- 目录约定：`output/interleave/{core,full}/`、`output/mmqa/`、`output/reports/`

---

## 5. 产量与资源估算

| 项 | 估算 |
|---|---|
| Stage 2 后候选 | 全量 960万 × ~1.03% ≈ **8–10万条**（若放宽指代硬门槛为排序项 ≈ 30–50万，供权衡） |
| Stage 3 后 interleave | 保留 40–60% ≈ **4–6万条 core**（放宽路线 ≈ 15–25万 full） |
| 多图 QA | 每种子 2–4 问 ≈ **10–20万 QA 对** |
| Stage 1–2 计算 | 纯 CPU；48GB JSONL 流式 + 多进程，预估数小时～1天（含一次性图片索引构建） |
| Stage 3 VLM 评审 | ~10万 doc × (2–5图+~1.5k字) —— 7B–70B 级 VLM，vLLM 批推理；量级：单机 8 卡数天（取决于模型大小，待定后细估） |
| Stage 4 VLM 合成 | 与 Stage 3 同量级 |

**待定依赖：模型资源**（vLLM 本地部署 Qwen2.5-VL / InternVL 类，或 API）。Stage 0–2 无此依赖，可先行。

## 6. 风险与开放决策

| # | 风险/决策 | 现状/建议 |
|---|---|---|
| R1 | 指代硬门槛牺牲产量 10×（1% vs ~10%） | 建议双轨：core（硬门槛）+ full（作排序分），消融后定 |
| R2 | 规则无法筛掉"grounding好但不专业"（BTS 案例） | 由 Stage 3 Professionalism 维度解决，需标定集验证 |
| R3 | 81% 图片覆盖率 → 19% 缺图 | 已由"在档率≥70% + 序列只留在档图"规避；可选从 img_zip 补图提产量（+成本） |
| R4 | 中文文本质量无公开 KenLM 基线 | 用启发式 + Stage 3 LLM 分兜底；不单独训分类器（除非产量不足） |
| R5 | 评审模型选型未定 | **待用户确认**：本地 vLLM（哪个模型/几卡）或 API |
| R6 | 合成数据的许可/合规口径 | 数据卡中明示来源与用途限制；内部训练用途 |
| D1 | interleave 是否也做"未裁剪全文"版本 | 建议：core 用裁剪版，另存全文版供预训练消融 |
| D2 | 产量优先 or 精度优先 | 当前按精度优先设计；若需 >50万 条走放宽路线 |

## 7. 实施排期（Conductor 分支划分）

| 分支 | 内容 | 依赖 | 交付 |
|---|---|---|---|
| **W1-a `pipeline-rules`** | Stage 0–2 全量实现：图片索引、块级解析、全部规则门槛、MinHash、频次去重；在 100k 样本上出漏斗报告 | 无（纯 CPU，可立即开工） | 候选集 + 漏斗统计 |
| **W1-b `rubric-calibration`** | 标定集抽样工具 + 评审 prompt 设计 + 200–500 条人工标注界面/流程 | W1-a 部分产出 | 校准后的 rubric + 阈值 |
| **W2-a `llm-review`** | Stage 3 批量评审（vLLM/API 适配层、断点续跑、成本核算） | W1-a/b + R5 决策 | interleave core/full |
| **W2-b `mmqa-synthesis`** | Stage 4 合成 + 自检过滤 + 人审抽检 | W2-a 通过集 | 多图 QA 数据集 |
| **W3 `audit-release`** | Stage 5 metadata、审计、数据卡、（可选）WebDataset 导出 | W2 | 最终交付 |

---

## 附录 A：现有代码资产

- `scripts/assemble_prototype.py` —— naive 解析原型（图片管线已验证）
- `scripts/assemble_curated.py` —— 规则策展原型（Stage 2 的雏形，含全部正则与门槛初值）
- `scripts/sample_out/`、`scripts/curated_out/` —— 两代样例产物，可做前后对比

## 附录 B：核心正则（已实测）

- 图片 hash：`v2-[0-9a-f]{32}`；图片属性优先级 `data-actualsrc > src > data-original`
- 指代 DEIXIS：如[下上右左]?图|下图|上图|见图|图中|如下所示|图N/①|红框/圈|箭头所指|如图所示
- 观点 OPINION：如何看待|如何评价|怎么看|是怎样的体验|靠谱吗|女朋友|男朋友|该不该|…
- 领域 DOMAIN：原理|算法|公式|推导|电路|编程|细胞|基因|参数|教程|步骤|测评|拆解|…
