# Personal Memory: 设计文档

> 不是让 AI 拥有人的记忆，而是让人拥有自己的记忆，并在需要时借给 AI 一小部分。

本文件覆盖：产品与技术架构（§1）、Memory Schema（§2）、检索与 Memory Compiler（§3）、分发策略（§4）、MVP 范围（§5）、仓库结构（§6）、实现计划（§7）、心理健康安全边界（§8）。
威胁模型见 [THREAT_MODEL.md](THREAT_MODEL.md)，对抗性自检见 [SELF_REVIEW.md](SELF_REVIEW.md)。

每个决定都按这个问题检验：**一个完全不懂技术的病友，能不能在几分钟内装好并开始用？**

> **方向调整（2026-09-25）**：维护者明确了首要目标：**一次操作、放进所有 AI、在每个对话里一直可读的自我记忆锚点**，而不是逐条记录。因此首要产品改为**锚点卡**（`start/锚点卡生成器.txt`、`start/锚点卡示例.txt`）：
> - **是什么**：一段几百字的精炼"关于我"。包括现实锚点、自己观察到的规律与早期信号、按有效程度排序的方法、会让自己更难受的做法、陪伴方式、安全计划、给未来自己的话。结构参考了常见的自助健康计划和安全计划的分段方式。
> - **怎么做出来**：把生成器发给任意 AI，AI 通过温和的访谈或提炼已有笔记，输出两段、每段 ≤ 1400 字的卡片。
> - **怎么放进去**：卡片放进各平台**长期生效**的个性化设置：ChatGPT 自定义指令（免费版每栏 1500 字，付费版 5000 字）、Claude 个人偏好、Gemini 已保存的信息、豆包 / 元宝的私密智能体设定。没有这类设置的平台（如 DeepSeek）在每次对话开头粘贴。
> - **取舍**：卡片每次对话约占 1–2k token，并保存在平台服务器上；换来的是"一次放好、每个对话都在"。卡片的行为规则仍然只能靠模型遵守，需要实测。
> - **下文的 Memory Core、胶囊、MCP 扩展**降为可选的"记录日常"工具，以后可以从记录里自动提炼锚点卡。
>
> **再次调整（2026-09-25，Claude 与 ChatGPT）**：维护者要求"无感记录、精确查档、原文不可篡改"，先做 Claude 和 ChatGPT。实现如下：
> - **记录链**（`src/core/chain.js`）：每条记录带 `seq / prev / hash`（SHA-256，纯 JS，Node 与浏览器一致），哈希覆盖原话、时间、来源、状态标签等不可变字段；结构化结果不在哈希内，可随时从原话重建。改字会报 `edited`，悄悄删除会报 `missing`。
> - **只追加**：没有"修改"操作。后来的理解用 `annotates` 追加在原记录旁边。删除是先隐藏（AI 立即看不到），7 天后变成墓碑，保留 `seq/prev/hash`，所以链条仍能校验、缺口可见。在线版另有紧急销毁。
> - **自动记录**：由用户在安装或创建时开启（`autoRecord`），属于"长期同意"。第一次自动保存时，AI 会被要求告诉用户一次；用户可以随时说"暂停记录"。关闭时仍是"说记住才记"。
> - **精确查档**：新增 `lookup` 工具，按编号、日期、日期范围或关键词返回原话、本地时间、完整性标记和后来的补充，单次最多约 1500 token；查不到返回 `NO_RECORD`，要求 AI 直接说没有。
> - **在线连接器**（`src/http/`，见 [CONNECTOR.md](CONNECTOR.md)）：同一个 Core，走 MCP 的 Streamable HTTP 传输，ChatGPT 的开发者模式和 Claude 的自定义连接器都能添加。不用账号，"链接即钥匙"；磁盘上只有 AES-256-GCM 密文，目录名和密钥由链接经 HKDF 推导，服务器不保存链接。

---

## 1. 产品与技术架构

### 1.1 一个 Core，三种外壳

```
                  ┌──────────────────────── Memory Core (src/core, 零依赖, ~1.5k 行) ────────────────────────┐
 用户的话 ──────▶ │ extract ─▶ Entry(同意单元) ─▶ Items(结构化) ─▶ layers(情节摘要/稳定记忆/索引)          │
                  │                                              │                                          │
 当前消息 ──────▶ │ query(门控+意图) ─▶ planSlots ─▶ retrieve(分层检索) ─▶ compile(预算/去重/delta) ─▶ 两种表示 │
                  └──────────────────────────────────────────────┬──────────────────────────────────────────┘
                                                                 │ storage 接口注入
          ┌──────────────────────────────┬───────────────────────┴───────────────┬────────────────────────────┐
          │ A. MCP 本地服务 (src/mcp)       │ B. Agent Skill (skill/)                  │ C. 记忆胶囊 (capsule/)          │
          │ 文件存储 ~/PersonalMemory       │ 行为规范：何时存/取、怎么说、安全边界     │ 单个离线 HTML，浏览器本地存储    │
          │ Claude Desktop 一键扩展(.mcpb)  │ 有工具时调工具；没工具时走胶囊格式        │ 复制粘贴到豆包/DeepSeek/元宝等   │
          └──────────────────────────────┴──────────────────────────────────────────┴────────────────────────────┘
```

- **Memory Core**：纯 JavaScript（ES 模块，JSDoc 注释），不依赖 Node 或浏览器专有 API。Node 端和浏览器胶囊跑的是同一份代码（胶囊由构建脚本内联）。零运行时依赖，方便审计，也没有供应链风险。
- **A. MCP 本地服务**：能运行本地进程的 AI 应用（Claude Desktop、各类 MCP 客户端、Kimi Code 等 CLI）通过 stdio 调用。数据是用户目录下一个看得见的 JSON 文件。
- **B. Agent Skill**：`SKILL.md` 只规定 AI *怎么用* 记忆：何时取、何时问要不要存、怎样表述主观和客观、安全边界。它本身不存数据。能装 Skill 但不能跑本地进程的平台，就用 Skill + 胶囊。
- **C. Universal Memory Capsule**：给不能装任何东西的 AI（豆包、DeepSeek、元宝，以及手机上的 ChatGPT/Gemini）。用户在胶囊页里问问题，看到"这次会带哪些记忆"，勾选后复制，粘贴进任何聊天框。AI 按固定格式提出【记忆候选】，用户粘回胶囊，自己决定存不存。**同意是天然的**：没有复制粘贴，就没有东西离开设备。

### 1.2 为什么这样拆

| 选择 | 理由 | 放弃了什么 |
|---|---|---|
| 零依赖 JS，而不是 Python / TS + 构建链 | Claude Desktop 自带 Node；浏览器原生跑 JS；同一份 Core 两端复用；没有 `pip`/`npm install` | 类型检查靠 JSDoc 和测试 |
| 词典概念层（中英双语）+ BM25，而不是 embedding | 不用下载模型；向量不会成为第二份敏感数据；秒装；结果可解释 | 无法理解词典外的同义表达（见 SELF_REVIEW） |
| JSON 单文件，而不是 SQLite / 向量库 | 用户看得见、能备份、能手工删；2 万条约 9 MB，读取加检索 < 40 ms | 超大规模（10 万条以上）需要换存储（接口已隔离） |
| 4 个小工具，而不是十几个 | 每个工具的定义在**每次对话**都占 token | 部分能力合并进 `recall` 的 `focus` |
| 派生层（摘要/稳定记忆）现算不落盘 | 删除一条记忆后，不可能残留在某个摘要里 | 每次重算（已用 rev 缓存） |

### 1.3 数据流（Day 1 → Day 20）

1. Day 1 用户说"记住，我最近睡眠很差，今天出去走路以后感觉舒服了一点。"，AI 调 `remember(words=原话, consent=user_asked)`。
2. `extract` 拆出两个 Item：`state{sleep:poor, 最近}`（自我报告）和 `coping{walk, +1, 今天}`（自我报告）。原话完整保留。
3. Day 20 用户说"我现在又觉得很麻木，不知道为什么。"，AI 调 `recall(query=原话)`。
4. `query` 门控判定需要记忆（自述状态、麻木），规划槽位：RECENT → SIMILAR → HELPED → NEW → ANCHOR → FUTURE。
5. `retrieve`：最近 14 天没有记录，改用 LAST（最近一条，20 天前）。没有更早的"麻木"时期，所以 SIMILAR 为空，并产生 NEW（"以前没记录过麻木"，防止 AI 编造"上次"）。HELPED 来自稳定层的散步统计。
6. `compile` 按预算装箱，输出约 94 token（保守估计）：

```
MEMORY (user's own notes, lent for this reply; not facts; s=self-report; no diagnosis):
LAST: 20d ago sleep:poor(s) "我最近睡眠很差"
HELPED: walk:+ 20d ago "今天出去走路以后感觉舒服了一点" (s)
NEW: numb↑ not in any earlier shared note
ids: bmv4.0 ~mmms ~htgi
```

同时生成给用户看的 Human Preview：

```
这次借给 AI 的记忆（约 94 token）：
· 20 天前你记录：“我最近睡眠很差”
· 你记录过的方法：散步有一点帮助（20 天前）
· 之前的记录里没有提到麻木
```

> 注意：需求里的示例输出写的是 "poor sleep preceded numbness"。但 Day 1 的记录里**没有**麻木，这句话是推断，不是记录。系统拒绝输出它，改为如实说"以前没记录过麻木"。只有当历史里真的有"先睡不好、后麻木"的记录时，才会输出 `sleep:poor→numb↑`，并注明 `→` 只表示先后、不表示因果（见 `npm run demo` 的第二段）。

---

## 2. Memory Schema

存储文件 `memory.json`（格式 `personal-memory` v1）：

```jsonc
{
  "format": "personal-memory", "version": 1, "rev": 12,
  "entries": [{
    "id": "bmv4",                       // 4 位 base32，省 token
    "savedAt": "2026-09-05T02:00:00Z",  // 记录时间
    "day": "2026-09-05",                // 用户本地日期
    "words": "我最近睡眠很差，今天出去走路以后感觉舒服了一点。", // Raw：用户原话（去掉“记住，”）
    "consent": "user_asked",            // user_asked | user_confirmed
    "origin": "user_words",             // user_words | ai_candidate（AI 写、用户确认）
    "via": "mcp",                       // mcp | capsule | import
    "sensitivity": "normal",            // normal | sensitive | restricted
    "important": false,
    "aiSummary": null,                  // {text, by:"ai"}：永远标注为 AI 写的
    "items": [                          // Structured：从原话派生
      { "kind": "state",  "epistemic": "self_report", "text": "我最近睡眠很差",
        "back": 0, "span": 7, "signals": [{"dim":"sleep","val":"poor"}], "tags": ["sleep"], "by": "rules" },
      { "kind": "coping", "epistemic": "self_report", "text": "今天出去走路以后感觉舒服了一点",
        "back": 0, "span": 1, "strategy": "walk", "effect": 1, "tags": ["walk"], "by": "rules" }
    ]
  }]
}
```

### 2.1 八种记忆类型（`kind`）

| kind | 含义 | 默认认识论标签 | 整段保存还是按分句拆 |
|---|---|---|---|
| `event` | 发生了什么 | `user_record` 用户的记录 | 分句 |
| `state` | 情绪 / 自我报告的状态 | `self_report` 主观感受 | 分句 |
| `reflection` | 用户自己的体会（"我发现…"） | `self_report` | 整段 |
| `anchor` | 现实锚点 | `user_record` | 整段 |
| `coping` | 应对方法及效果 | `self_report`（效果是主观的） | 分句 |
| `future_message` | 给未来自己的留言 | `user_record` | 整段 |
| `relationship` | 重要的人及关系 | `self_report` | 整段 |
| `support_plan` | 支持 / 危机计划 | `user_record` | 整段 |

### 2.2 四种认识论地位，严格区分

| 标签 | 来源 | 在 AI 上下文里的记号 | 可否升级为"事实" |
|---|---|---|---|
| `user_record` | 用户记录的发生过的事 | `(r)` | 不会。这是"用户的记录"，不是被验证的事实 |
| `self_report` | 用户的主观感受 | `(s)` | 不会 |
| `ai_summary` | AI 写的摘要，或 AI 提出、用户确认的候选 | `(a)` | 不会 |
| `ai_inference` | AI 的推断 | **从不存储，从不输出** | 不存在升级路径 |

- 结构化字段 `by: rules | ai` 记录是谁做的结构化。AI 给的 `tags` 只能映射到受控词表，诊断词（抑郁症、PTSD、DID…）会被丢弃。
- 系统唯一的"派生结论"是计数和时间先后（`×4d`、`→`），它们由确定性代码从用户记录算出，并在上下文头部声明"→ = 先后，不是原因"。

### 2.3 同意单元 = 删除单元

一次保存就是一个 Entry，删除也以 Entry 为单位。用户想的是"忘掉我那天说的那件事"，不是"删掉第 2 个结构化子项"。这样也避免了原话还在、子项被删的残留问题。

### 2.4 三级敏感度（硬门控）

| 级别 | 如何产生 | AI 能看到吗 |
|---|---|---|
| `normal` | 默认 | 相关时可以看到一小部分 |
| `sensitive` | 规则自动识别（自伤、创伤、用药、诊断、物质使用），或 AI/用户上调 | 默认不能。只有用户在**只有用户能改的设置**里打开（扩展设置页 / 胶囊设置） |
| `restricted` | 用户说"只给我自己看"，或手动设置 | **永远不能**。所有 AI 路径都看不到内容；`forget` 只显示"私密记录，内容隐藏" |

原则：**AI 只能收紧权限，不能放宽。** 工具里没有任何降低敏感度或打开敏感分享的参数。

---

## 3. 检索与 Memory Compiler

目标不是"召回得多"，而是**每个 token 的上下文效用最大**。普通对话 0 token；需要时通常 50–150 token；硬上限默认 300，用户最多可调到 800。

### 3.1 管线

```
Raw(原话) → Structured(Items) → Episodic(情节摘要) → Stable(稳定记忆) → 分层检索 → 语义去重 → Compiler → 预算 → AI
```

1. **门控（query.js）**：先判断这句话需不需要长期记忆。写邮件、写代码、问天气返回 `NO_MEMORY_NEEDED`，0 token，也不读取、不留访问记录。中文省略主语（"还是很麻木"）按本人处理，明确是他人（"他最近很焦虑"）则不触发。
2. **意图 → 槽位规划**：`state / recent / similar / helped / anchors / future / support / search / ground`，映射到有序槽位。例：麻木 + 为什么 → `RECENT, SIMILAR, YOU_NOTED, HELPED, NEW, ANCHOR, FUTURE`；危机 → `SUPPORT` 最先，并加 `SAFETY` 行。
3. **权限过滤最先做**（layers.buildView）：不允许的 Entry 根本不进入视图，不参与打分、计数、索引。编译阶段再按敏感度检查一次（纵深防御）。
4. **分层检索（retrieve.js），先摘要后下钻**：
   - `RECENT`：14 天窗口内按维度统计**不同天数**（`sleep:poor×4d`），加上窗口内的方法效果。窗口为空时退到 `LAST`（90 天内最近一条）。
   - `SIMILAR`：情节层把状态记录按间隔 ≤ 3 天聚成"时期"。用目标维度（当前自述，否则近两周主导状态）匹配过往时期，只输出时期摘要和先后（`06/15(3d): sleep:poor→numb↑ +unreal↑`）。当前时期不算"相似"。
   - `HELPED`：稳定层按方法聚合 `次数 / 有效次数 / 平均效果`，与目标维度或相似时期相关的优先（`talk:+, walk:+ 3/4`）。
   - `YOU_NOTED`：用户自己写过的相关体会（原话）。
   - `NEW`：当前状态在已分享的记录里从未出现，明确告诉 AI 不要编"上次"。
   - `ANCHOR / FUTURE / SUPPORT`：按重要性和时间，只取 1–3 条。
   - `FOUND`：显式"我之前说过…吗"才走 BM25（中文双字 + 英文词 + `#概念` 跨语言词元），带时间匹配、近因和重要性加权。
5. **打分信号**：semantic（概念重叠 + BM25）、temporal（"上个月"等时间匹配）、entity（人物词、自由标签）、recency（半衰期按槽位不同：60/120/180/365 天）、importance、reliability（原话优先于 AI 摘要，AI 推断不存在），permission 作为硬过滤而非权重。
6. **语义去重**：相似时期按维度签名做 Jaccard（≥ 0.8）合并为 `×N periods`；搜索结果按双字 Jaccard（≥ 0.6）去重；跨槽位用 `covers`（如 `str:walk`）避免同一方法出现两次。
7. **Memory Compiler（compile.js）**：
   - 两轮装箱：第一轮按优先级放入紧凑形式，单位成本 = 正文 + 槽位名（首次）+ id；第二轮用剩余预算把紧凑形式升级为带用户原话的形式（原话最能帮 AI 自然回应）。
   - 最后按真实文本重新计量，超了就从最低优先级开始删，保证不超预算。
   - 头部图例按需生成：只解释本次出现的记号（`s/r/a/→`）。
8. **Delta / session cache**：每个单元有稳定 id（条目 id 或内容哈希 `~abcd`）。AI 把已收到的 id 作为 `seen` 传回，同一对话内不重发；内容变化则哈希变化，自动重发。之所以不靠服务端会话缓存，是因为 MCP 进程跨多个对话存活，服务端无法知道 AI 当前上下文里还有什么，而 AI 自己知道。

### 3.2 两种表示

- **Machine Context**：英文代码 + 用户原话引用，逐行 `槽位: 单元 | 单元`。例：`RECENT: sleep:poor×4d, mood↓×2d, numb↑×3d; walk:+ (s)`。
- **Human Preview**：同一批单元的自然语言版本，用用户的语言（中/英），带 token 数和"可以少分享"的提示。MCP 中作为 `audience: ["user"]` 内容块返回；胶囊中逐条可勾选，取消勾选后立即重新编译。

### 3.3 实测（`npm test` 与 `scripts/`，本机 Node 22，保守 token 估计）

| 场景 | 结果 |
|---|---|
| Day 1 → Day 20 | ≈94 token，3 条单元 |
| 含 6 月相似时期和锚点 | ≈147 token，4 条单元 |
| 无关问题 | 0 token，不读取 |
| 同对话重复提问（delta） | ≈18 token（"nothing new"） |
| 1k / 5k / 20k 条记忆 | 单次 recall 1–37 ms，48–123 token；JSON 0.5 / 2.3 / 9.3 MB |
| MCP 工具定义固定开销 | ≈820 token（保守估计），这是目前最大的 token 成本，见 SELF_REVIEW |

token 估计不依赖分词器：非 ASCII 字符按 1 个、ASCII 按 3 字符 1 个计算，偏保守。

---

## 4. 分发策略（大陆版 / 海外版）

两版共享同一个 Core 和同一种文件格式（可以互相导入导出），只维护不同的 adapter 和分发包。

> 平台能力变化很快。下表中"已核实"指 2026-09 查到了公开资料；"待核实"指上架前必须在该平台再确认，不能想当然。

### 4.1 海外版

| 渠道 | 形态 | 用户操作 | 本地优先？ | 状态 |
|---|---|---|---|---|
| **Claude Desktop（macOS/Windows）** | `.mcpb` 扩展（MCP Bundle） | 双击或拖入，出现安装对话框；Node 由 Claude 自带，无需命令行 | ✅ 数据在本机 | 已核实：MCPB manifest 0.3 / 0.4，Node 随 Claude 分发。上架 Anthropic 精选目录的流程**待核实** |
| Claude.ai 网页 / 手机 | Agent Skill（zip）+ 胶囊 | 设置里上传 Skill（或组织管理员启用），记忆放在胶囊里 | ✅（胶囊） | Skill 在云端沙箱运行，不能跨对话持久化，所以只承担行为规范 |
| ChatGPT | 胶囊（MVP）；以后可做 Apps SDK | 复制粘贴 | ✅ | ChatGPT 的应用要求远程 HTTPS 服务，与本地优先冲突。**不做托管服务**，除非以后有端到端加密的自托管方案 |
| Gemini | 胶囊；开发者可用 Gemini CLI 扩展（MCP） | 复制粘贴 | ✅ | 消费版 App 安装第三方工具的能力**待核实** |
| 其他 MCP 桌面客户端 | 同一个 MCP 服务 | 按客户端的添加 MCP 方式 | ✅ | 面向进阶用户 |

### 4.2 中国大陆版

| 渠道 | 形态 | 本地优先？ | 状态 |
|---|---|---|---|
| **记忆胶囊（主渠道）** | 单个离线网页：手机浏览器打开，添加到主屏幕；或电脑双击 HTML | ✅ 浏览器本地存储 | 已实现。大陆多数用户在手机上用豆包、DeepSeek、元宝、Kimi，这是唯一能覆盖所有 AI 的路径 |
| 豆包 / DeepSeek / 元宝 | 胶囊：复制 → 粘贴；AI 回复里的【记忆候选】→ 粘回胶囊 | ✅ | 按需求所述，这些平台不能装第三方 Skill，因此不做平台适配 |
| Kimi | Kimi Code CLI 支持 `SKILL.md`（兼容 Claude 的 skills 目录）和 MCP；Kimi Agent / Kimi Claw 有技能库（ClawHub） | CLI：✅；Kimi Claw：云端常驻，**不是本地** | 已核实 Kimi Code 支持 SKILL.md。消费版 Kimi App 能否上传第三方 Skill **未查到**，需上架前核实。Kimi Claw 走云端，只有当用户接受记忆放在云端时才适合，默认不推荐 |
| 千问 App | 2026-06 宣布向第三方 Agent 和 Skill 开放（首批为品牌方） | 大概率云端托管，**待核实** | 个人开发者、公益项目能否入驻，以及能否不托管用户数据，都**待核实** |
| 桌面 MCP 客户端（如 Cherry Studio、Chatbox） | 同一个 MCP 服务 | ✅ | 需要用户自备模型 API Key，不适合普通病友，定位为进阶选项 |

**大陆版的关键决定**：主力是胶囊，不是任何一个平台的插件。插件市场适配是"加分项"，每接入一个平台，都要先确认它能否**不把用户记忆托管在平台云端**。做不到，就只提供 Skill（行为规范）+ 胶囊（数据）的组合。

**胶囊托管（待定，需要维护者决定）**：胶囊是纯静态页，任何静态托管都行，托管方看不到数据（数据在用户浏览器里，页面设置了 `connect-src 'none'`，不能联网）。但在大陆托管需要 ICP 备案，GitHub Pages 访问不稳定。候选：有备案的公益机构域名，或把 HTML 文件直接发给用户（微信 / 网盘）。

### 4.3 记忆文件模式（2026-09-25 加入，目前的首选入口）

维护者的要求是"这个东西能发给 AI 就能使用"。所以加了第四种外壳：**一个文件**（`start/我的记忆.txt`、`start/my-memory.txt`）。文件里是给 AI 的说明（认识论规则、安全边界、`【新记忆】日期｜类型｜内容` 格式），加上一行一条的记忆。

- **用法**：发给任何 AI（上传或粘贴）；AI 在回复末尾写出 `【新记忆】` 行；用户自己把这一行复制到文件末尾。保存的永远是用户，AI 不能静默写入。
- **与其他模式互通**：`memoryFile()` 从存储生成文件（附近况摘要，日期用绝对日期、第一人称）；`parseMemoryFile()` 把文件或 AI 回复读回存储。胶囊和 MCP 导出都会生成这个文件。
- **有意接受的取舍**：这种模式下 AI 读的是**整个文件**，不是按预算挑出来的一小段。换来的是零安装、任何 AI 都能用。缓解措施：`restricted` 永不写入文件；`sensitive` 默认不写入；超过 400 条时，较早的普通记录按月压缩成一行（锚点、留言、支持计划、重要的人始终保留原文），1000 条约 1 万 token。
- **想要最少分享**：用胶囊的"问 AI 之前"（只带相关几条）或 Claude 扩展（自动检索）。

### 4.4 版本与包

- `dist/personal-memory.mcpb`：Claude Desktop 扩展（约 40 KB）。
- `dist/personal-memory-skill.zip`：Agent Skill（Claude、Kimi Code 及其他兼容 SKILL.md 的平台）。
- `dist/personal-memory-capsule.html`：记忆胶囊（约 100 KB，单文件，离线可用）。
- 三者同一个版本号，同一种导出格式。

---

## 5. MVP 范围

**只证明一条链**：Day 1 说"记住…"，Day 20 说"又麻木了"，AI 只拿到极少、忠实、带认识论标记的上下文，并自然回应。

| 包含 | 不包含（有意推迟） |
|---|---|
| remember / recall / forget / export / audit / status | 本地 embedding（接口已留：替换 `retrieve` 的打分即可） |
| 8 种 kind、4 种认识论标签、3 级敏感度 | 静态加密（依赖系统磁盘加密，见威胁模型） |
| 门控、分层检索、去重、预算、delta、Human Preview | 多设备同步 |
| MCP 服务 + Claude Desktop 扩展包 | 微信小程序、原生 App |
| Agent Skill | 平台商店上架（需要维护者账号与决定） |
| 记忆胶囊（存、问、粘回候选、浏览、导入导出、访问记录） | 多语言（目前中 / 英） |
| 测试 37 项，含真实 MCP 进程、打包后的胶囊代码与记忆文件往返 | 用户研究与可用性测试（上线前必须做） |

---

## 6. 仓库结构

```
src/core/        Memory Core（零依赖，Node 与浏览器共用）
  util.js          token 估计、本地日期、id、安全引用（掩码号码、去掉标记）
  lexicon.js       中英概念词典：状态维度、方法、效果、时间、类型线索、敏感/危机/诊断词
  extract.js       原话 → 类型化 Items（确定性规则 + AI 提示，标注 by）
  query.js         门控 + 意图 + 槽位规划
  layers.js        权限视图、情节摘要、稳定记忆、BM25 索引（全部派生，不落盘）
  retrieve.js      分层检索 → 候选单元（机器形式 + 人类形式）
  compile.js       Memory Compiler：预算装箱、去重、delta、两种表示
  memory.js        对外 API：remember / recall / forget / status / accessLog / exportAll / importDoc
src/node/file-store.js   ~/PersonalMemory：0600 权限、原子写、fsync、损坏不覆盖
src/mcp/         零依赖 MCP stdio 服务（server.js 协议，tools.js 四个工具）
capsule/capsule.html     记忆胶囊源页面（构建时内联 Core）
skill/personal-memory/SKILL.md   Agent Skill
packaging/claude-desktop/manifest.json   MCPB 清单
scripts/         build.js（三种包）、zip.js（确定性 zip）、demo.js（Day1→Day20 演示）
test/            node:test，无依赖
docs/            DESIGN / THREAT_MODEL / SELF_REVIEW / PRIVACY
```

---

## 7. 实现计划

| 阶段 | 内容 | 完成标准 | 状态 |
|---|---|---|---|
| P0 | Core + MCP + Skill + 胶囊 + 测试 + 打包 | Day1→Day20 链路通过；`npm test` 全绿；三个包可构建 | ✅ 本次完成 |
| P1 | 真实环境验收 | 在 Claude Desktop 安装 `.mcpb` 并完成 Day1/Day20 对话；在豆包 / DeepSeek / 元宝各走一遍胶囊流程；记录 AI 是否遵守 `(s)`、`→`、`NEW` 的表述规则 | 待做（需要真实账号） |
| P2 | 可用性 | 与 5–8 位目标用户（经知情同意，最好有专业人员陪同）做可用性测试；按"几分钟能不能装好"迭代文案 | 待做 |
| P3 | 分发 | 胶囊托管决定；Claude 扩展目录提交；逐个核实 Kimi / 千问的第三方 Skill 入驻条件与数据托管方式 | 待做（维护者决定） |
| P4 | 检索增强 | 可选的本地 embedding（只在用户设备上，删除同步），与词典层做 A/B | 以后 |
| P5 | 安全增强 | 可选口令加密（至少针对 restricted）；危机资源按地区可配置 | 以后 |

---

## 8. 心理健康安全边界

定位是 memory-assisted support、personal continuity、grounding / reflection support。**不是**医生、治疗或诊断系统。

落实在代码里（而不只是写在文档里）：

- **不诊断**：AI 标签里的诊断词在入库时被丢弃；上下文头部写明 "no diagnosis"；Skill 禁止标签化和药物建议。
- **主观不等于事实**：`(s)` 记号；Skill 要求用"你当时记录 / 你当时觉得"来表述。
- **先后不等于因果**：`→` 的图例写明 "came first, not cause"；只有真实存在两条先后记录才会出现。
- **不编造过去**：`NEW` 槽位明确告诉 AI 某种状态以前没有记录。
- **不强化妄想 / 偏执**：Skill 要求既不附和也不争辩，改为温和地提供用户自己写的现实锚点。
- **不制造依赖**：Skill 要求指向用户生活中的人（关系记录、支持计划），而不是"只有 AI 懂你"。
- **危机**：检测到危机词时，上下文最先加 `SAFETY` 行，并优先给出用户自己的支持计划。即使没有任何记忆，也会返回 `SAFETY` 行。电话号码对 AI 做掩码，用户需要时自己打。
