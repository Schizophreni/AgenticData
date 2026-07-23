# MuirBench 原始数据分析报告

> 分析对象：`../muirbench/data/test-00000-of-00005.parquet` 至 `test-00004-of-00005.parquet`  
> 分析时间：2026-07-22  
> 统计口径：全量 2,600 条记录、11,264 张嵌入图片；来源依据图片文件名中保留的原始数据集前缀识别。

## 1. 执行摘要

本地 MuirBench 数据包含 2,600 道多项选择题、11,264 张图片，覆盖 12 种问题任务、12 种图片类型和 10 种多图关系。

但 2,600 条记录并非 2,600 个独立母题，而是：

- 1,300 条可回答题；
- 1,300 条与之配对的不可回答反事实题；
- 每个母题都有一个 counterpart，形成严格的 1:1 配对；
- 每题选项都包含 `None of the choices provided`；
- 在 1,300 条不可回答题中，该选项就是正确答案；
- 全数据共有 11,264 个 `<image>` 占位符，与 11,264 张图片完全匹配。

来源识别结果显示，所有 2,600 条记录都能通过文件名前缀映射到 11 个来源。尤其是：**398 条 Diagram Understanding 记录全部来自 IconQA，对应 199 个母题及其 199 个不可回答版本。**

## 2. 数据字段与质量检查

每条记录包含以下字段：

| 字段 | 含义 |
|---|---|
| `idx` | MuirBench 样本 ID |
| `task` | 问题任务类型 |
| `image_relation` | 多张图片之间的关系 |
| `image_type` | 图片类型 |
| `question` | 问题文本，图片位置用 `<image>` 表示 |
| `options` | 3–5 个选择项，可能是文本或 `<image>` |
| `answer` | 正确选项字母 A–E |
| `image_list` | 按占位符顺序排列的嵌入图片 |
| `counterpart_idx` | 可回答/不可回答配对样本 ID |

一致性检查结果：

- 2,600/2,600 条都有 counterpart；
- 1,300 条可回答与 1,300 条不可回答，所有任务均严格对半；
- 3 选项题 308 条，4 选项题 1,256 条，5 选项题 1,036 条；
- 每题使用 2–9 张图片，4 张图最常见（700 条），其次是 5 张图（614 条）；
- 文本中的媒体占位符和 `image_list` 数量完全一致，未发现数量错位。

## 3. 问题类型分析

| 问题类型 | 记录数 | 独立母题数 | 占比 | 核心能力 |
|---|---:|---:|---:|---|
| Image-Text Matching | 464 | 232 | 17.85% | 从多张图中选择符合文本的图片，或为多图选择描述 |
| Diagram Understanding | 398 | 199 | 15.31% | 读取抽象图形、计数图、几何图及其局部候选 |
| Difference Spotting | 340 | 170 | 13.08% | 比较两图、论文子图或连续幻灯片之间的差异 |
| Visual Retrieval | 292 | 146 | 11.23% | 跨视角检索同一建筑物 |
| Counting | 234 | 117 | 9.00% | 跨两图或多页幻灯片计数 |
| Attribute Similarity | 196 | 98 | 7.54% | 找相同场景、相同对象或指定属性变化的图片 |
| Scene Understanding | 186 | 93 | 7.15% | 汇总同一 3D 场景多个视角中的信息 |
| Action Understanding | 164 | 82 | 6.31% | 从视频帧序列判断动作及动作顺序 |
| Geographic Understanding | 100 | 50 | 3.85% | 判断历史地图覆盖区域是否相同或重叠 |
| Visual Grounding | 84 | 42 | 3.23% | 结合多张图、上下文或对话完成指代与推理 |
| Cartoon Understanding | 78 | 39 | 3.00% | 理解漫画、多格梗图的叙事与笑点 |
| Ordering | 64 | 32 | 2.46% | 恢复图片、动作或幻灯片的正确顺序 |

这里的 task 不是简单的内容领域标签，而是“多图操作方式”。例如 Slides 可以同时产生 Counting、Difference Spotting、Image-Text Matching 和 Ordering；Photography 也可服务于动作、属性、差异、排序等多种任务。

## 4. 图片类型分析

| 图片类型 | 记录数 | 占比 | 典型内容 |
|---|---:|---:|---|
| Photography | 780 | 30.00% | 自然图像、室内外场景、视频抽帧、图文匹配候选 |
| Graphics | 402 | 15.46% | IconQA 抽象图示为主，另有少量 MMBench 图形 |
| Slides | 348 | 13.38% | 科研论文演示文稿的连续页面 |
| Drone and Satellite | 292 | 11.23% | 同一大学建筑的卫星、无人机和地面多视角 |
| Medical Image | 234 | 9.00% | PubMed 论文中的多子图医学影像 |
| 3D View | 186 | 7.15% | 室外 3D 场景的多视角渲染/采样 |
| Map | 103 | 3.96% | 100 条历史地图与 3 条 MMBench 地图题 |
| Video | 96 | 3.69% | SEED-Bench 视频任务抽取的帧序列 |
| Meme | 78 | 3.00% | 多格漫画和网络梗图 |
| Animation | 32 | 1.23% | HallusionBench 动画序列及 MMBench 动画图 |
| Other | 31 | 1.19% | MMBench 无法归入主要视觉类别的内容 |
| Data Visualization | 18 | 0.69% | 图表、统计可视化等 |

图片类型字段描述的是视觉载体，而不是原始来源。例如 Map 类型来自 HistoricalMap 和少量 MMBench；Animation 来自 HallusionBench 和 MMBench。

## 5. QA 类型分析

### 5.1 按答案载体

| QA 形式 | 记录数 | 占比 | 涉及任务 |
|---|---:|---:|---|
| 图片选项 MCQ | 1,442 | 55.46% | Diagram、Geographic、Visual Retrieval、Attribute Similarity，以及部分 Image-Text Matching、Difference Spotting |
| 文本选项 MCQ | 1,158 | 44.54% | Action、Counting、Cartoon、Ordering、Scene、Visual Grounding，以及部分 Difference Spotting、Image-Text Matching |

“图片选项 MCQ”是指除 `None of the choices provided` 外，候选项均为 `<image>`；“文本选项 MCQ”则是候选项为自然语言答案。

### 5.2 按问答操作

MuirBench 中可归纳出以下 QA 模式：

1. **图找图**：给定查询图片，从候选图中找同一区域、同一建筑、相同场景或满足属性条件的图片。
2. **文找图**：给定文字描述，从候选图中选择匹配图片。
3. **图找文**：给定多张图，从文字选项中选择正确描述、差异、数量、动作或结论。
4. **多图联合推理**：答案依赖多张互补图、多个视角或连续页面，而非单张图。
5. **时序排序**：对动作帧、漫画格或幻灯片页面恢复顺序。
6. **不可回答检测**：识别图片、问题或候选项被最小改动后，现有选项中没有正确答案。

### 5.3 可回答/不可回答构造

每类任务的样本都以一对形式出现：原始可回答题和不可回答 counterpart。不可回答版本不是只删除正确选项，而可能通过以下方式产生：

- 替换或修改关键图片，使原答案失去视觉依据；
- 修改问题中的关键对象、属性、数量、动作或关系；
- 修改候选项，使所有普通选项均不正确；
- 最终正确答案变为 `None of the choices provided`。

因此，MuirBench 同时测量“做对多图题”和“发现题目不可回答”两种能力。评估时不宜把配对样本拆散后当作完全独立分布。

## 6. 多图关系分析

| 多图关系 | 记录数 | 主要含义 |
|---|---:|---|
| Cropped/Zoomed | 398 | 主图与裁剪候选或局部区域 |
| Partial Similarity | 350 | 图片部分属性或内容相似 |
| Ordered_Pages | 348 | 同一演示文稿的连续页面 |
| Object-Multiview | 292 | 同一对象/建筑的多视角 |
| Overall Similarity | 276 | 整体场景、区域或内容相似 |
| Independent | 234 | 图像相互独立，由文本或问题建立联系 |
| Complementary | 222 | 多图提供互补证据 |
| Temporal | 216 | 视频帧、动作或事件的时间关系 |
| Scene-Multiview | 186 | 同一场景的多个视角 |
| Narrative | 78 | 多格漫画/梗图组成叙事 |

## 7. 图片类型、任务与数据来源对应关系

下表是本地文件的精确映射。记录数包含可回答和不可回答版本，因此独立母题数均为记录数的一半。

| 原始来源 | MuirBench 任务 | 图片类型 | 多图关系 | 记录数 | 独立母题数 |
|---|---|---|---|---:|---:|
| IconQA | Diagram Understanding | Graphics | Cropped/Zoomed | 398 | 199 |
| University-1652 / `university_building` | Visual Retrieval | Drone and Satellite | Object-Multiview | 292 | 146 |
| SciDuet / SciSlides | Image-Text Matching | Slides | Ordered_Pages | 146 | 73 |
| SciDuet / SciSlides | Difference Spotting | Slides | Ordered_Pages | 144 | 72 |
| SciDuet / SciSlides | Counting | Slides | Ordered_Pages | 46 | 23 |
| SciDuet / SciSlides | Ordering | Slides | Ordered_Pages | 12 | 6 |
| PubMed / PubMedMQA | Difference Spotting | Medical Image | Complementary | 138 | 69 |
| PubMed / PubMedMQA | Image-Text Matching | Medical Image | Independent | 96 | 48 |
| GeneCIS | Attribute Similarity | Photography | Overall Similarity | 118 | 59 |
| GeneCIS | Attribute Similarity | Photography | Partial Similarity | 78 | 39 |
| NLVR2 | Counting | Photography | Partial Similarity | 188 | 94 |
| ISVQA | Scene Understanding | 3D View | Scene-Multiview | 186 | 93 |
| SEED-Bench | Action Understanding | Video | Temporal | 96 | 48 |
| SEED-Bench | Action Understanding | Photography | Temporal | 68 | 34 |
| SEED-Bench | Cartoon Understanding | Meme | Narrative | 78 | 39 |
| SEED-Bench | Image-Text Matching | Photography | Partial Similarity | 84 | 42 |
| SEED-Bench | Visual Grounding | Photography | Complementary | 68 | 34 |
| SEED-Bench | Visual Grounding | Data Visualization | Complementary | 16 | 8 |
| SEED-Bench | Difference Spotting | Photography | Overall Similarity | 58 | 29 |
| MMBench | Image-Text Matching | Photography | Independent | 86 | 43 |
| MMBench | Image-Text Matching | Other | Independent | 31 | 15.5* |
| MMBench | Image-Text Matching | Animation | Independent | 12 | 6 |
| MMBench | Image-Text Matching | Graphics | Independent | 4 | 2 |
| MMBench | Image-Text Matching | Map | Independent | 3 | 1.5* |
| MMBench | Image-Text Matching | Data Visualization | Independent | 2 | 1 |
| HallusionBench | Ordering | Photography | Temporal | 32 | 16 |
| HallusionBench | Ordering | Animation | Temporal | 20 | 10 |
| National Geologic Map Database / HistoricalMap | Geographic Understanding | Map | Overall Similarity | 100 | 50 |

\* MMBench 的单个母题配对后，两个版本的 `image_type` 可能被标成不同类别，所以按细分图片类型除以二会出现半数；来源总数仍严格为 69 个母题、138 条记录。

### 7.1 按来源汇总

| 来源 | 记录数 | 独立母题数 | 占比 |
|---|---:|---:|---:|
| SEED-Bench | 468 | 234 | 18.00% |
| IconQA | 398 | 199 | 15.31% |
| SciDuet / SciSlides | 348 | 174 | 13.38% |
| University-1652 | 292 | 146 | 11.23% |
| PubMed / PubMedMQA | 234 | 117 | 9.00% |
| GeneCIS | 196 | 98 | 7.54% |
| NLVR2 | 188 | 94 | 7.23% |
| ISVQA | 186 | 93 | 7.15% |
| MMBench | 138 | 69 | 5.31% |
| HistoricalMap | 100 | 50 | 3.85% |
| HallusionBench | 52 | 26 | 2.00% |

## 8. Diagram 数据专项结论

本地数据可以消除“Diagram 是否混合多个来源”的不确定性：

- `task = Diagram Understanding` 共 398 条；
- `image_type = Graphics` 共 398 条与 Diagram 重合，另有 4 条 Graphics 属于 MMBench Image-Text Matching；
- 398 条 Diagram 的图片文件名全部以 `iconqa_` 开头；
- 多图关系全部为 `Cropped/Zoomed`；
- QA 全部为图片候选选择题；
- 对应 199 个原始母题和 199 个不可回答版本。

这类题通常把 IconQA 的一张问题主图和若干候选图拆成多个 `<image>`，要求完成几何面积、数量比较、模式识别、类别对应等视觉推理。它虽然在 MuirBench 中被改造成“多图格式”，但其多图性主要来自**主图 + 裁剪/候选图**，与真实多视角、跨页面或跨时刻推理不同。

## 9. 对数据使用和新数据构造的启示

1. **避免配对泄漏。** 划分训练集和验证集时，必须按 `idx`–`counterpart_idx` 成对划分，否则同一母题的轻微变体会泄漏到另一集合。
2. **分别报告 answerable 与 unanswerable。** 总准确率会掩盖模型只会偏向 `None` 或从不选择 `None` 的问题。
3. **不要把所有多图题视作同一种难度。** IconQA 的裁剪候选、University-1652 的对象多视角、SciSlides 的跨页推理和 SEED-Bench 的时间序列需要完全不同的能力。
4. **QA 载体应平衡。** 当前图片选项占 55.46%，文本选项占 44.54%；若用于训练，需防止模型通过选项形式猜测任务来源。
5. **来源和任务高度耦合。** Diagram 几乎等价于 IconQA、Visual Retrieval 等价于 University-1652、Scene Understanding 等价于 ISVQA。模型可能学习来源风格，而不只是目标能力。
6. **Diagram 的多图强度应单独评估。** `Cropped/Zoomed` 关系可能允许模型先在主图内完成问题，再将结果匹配到候选图；它不一定要求跨两张独立图片整合证据。
7. **构造新题时应增加真实跨图依赖。** 可优先增加跨视角互补、跨时刻状态变化、跨页面证据链，以及需要排除无关图像的题型，以降低单图捷径。

## 10. 方法与限制

- 统计直接读取本地 5 个 Parquet 分片，不依赖抽样估计。
- 来源由嵌入图片的 `path` 前缀识别；所有记录均成功归入已知来源。
- `image_type`、`task` 和 `image_relation` 使用 MuirBench 自带标注，没有另行覆盖。
- 图片类型表示 MuirBench 的人工分类，并不保证同一 counterpart 对的类型完全一致。
- 本报告分析的是发布版 benchmark 结构和内容分布，不等同于对每道题答案正确性的人工审计。

## 11. 相关材料

- 本地数据说明：[`../muirbench/README.md`](../muirbench/README.md)
- MuirBench 论文：https://arxiv.org/abs/2406.09411
- MuirBench 官方代码：https://github.com/muirbench/MuirBench

