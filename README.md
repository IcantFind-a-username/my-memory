<div align="center">

# 🌱 我的记忆 · My Memory

**你的话，原样留下，永不改动。AI 回答你之前，先查确切的记录，不去猜。**<br>
**Your words, kept exactly as you said them, never changed. Before answering, the AI looks up the exact record instead of guessing.**

免费 · 开源 · 无广告 · 不用注册<br>
Free · Open source · No ads · No account

[中文](#中文) · [English](#english)

</div>

---

<a id="中文"></a>

## 中文

### 写给你

也许你常常觉得，和昨天的自己断了线。
也许有些日子会突然"丢失"，想不起发生过什么。
也许回头看某一天的自己，会觉得很陌生，不确定那时到底发生了什么。

**我的记忆**替你把说过的话原样留下来，带着日期和时间，而且**谁都不能改动，包括以后的你自己**。
你和 AI 聊天时，它会先去查确切的记录，告诉你"9 月 5 日 21:14 你写道：……"，而不是凭印象猜。

### 两种用法

| | 🗂️ 记忆库 | 🪪 锚点卡 |
|---|---|---|
| 适合 | Claude、ChatGPT | 任何 AI（豆包、DeepSeek、Kimi……） |
| 记录 | 聊天时自动记录你的原话 | 不记录日常，只放一张"关于我"的卡 |
| 查找 | AI 能查到确切的哪一天、哪句话 | AI 每次对话都读得到这张卡 |
| 手机 | Claude 手机 App ✅（在网页上添加一次，自动同步）；ChatGPT 手机 App 需要正式上架（审核中不保证通过） | ✅ |
| 现在能用吗 | 代码已完成；**还需要部署一个公网地址**（仓库里带了一键部署配置） | ✅ 今天就能用 |

---

### 🗂️ 记忆库

**它会做什么**

- **不用刻意记录**：开启"自动记录"后，你聊到自己时，AI 会把你的原话连同时间存下来。不想记的时候，说一句"暂停记录"。
- **原文永远不被改动**：每一条记录都和上一条用密码学的方式串在一起，改一个字、或悄悄删掉一条，都会被发现。你的私人页面随时显示"全部记录校验通过"。
- **后来的理解放在旁边**：如果后来的你对某一天有了不同的理解，可以补充一句，原话不动，两者并排。这样能看到不同状态下的自己怎么描述同一件事。
- **精确查档，不猜**：AI 回答前先查记录，引用原话和时间；查不到就直接说"没有记录"。
- **删除是慎重的**：说"删掉这条"，它会先隐藏，7 天后才真正删除，期间可以撤销。遇到紧急情况，可以在私人页面立即销毁整个记忆库。

**怎么用**

- **Claude（网页、iPhone、安卓、电脑）**：在 claude.ai 网页上添加连接器（在线版网址 + `/mcp`），在弹出的页面里新建记忆库或连接已有的。网页上加一次，手机 App 自动同步。
- **ChatGPT**：正式上架后，在 ChatGPT（手机或网页）的应用目录里连接；上架之前只能在网页版的开发者模式里试用。
- **只用 Claude 电脑版、不想放在任何服务器上**：安装 `personal-memory.mcpb` 扩展（双击，点"安装"），记忆只存在你自己的电脑上。

> 💡 在线版需要先部署一个公网地址，目前还没有公开上线；部署方法见 [在线连接器说明](docs/CONNECTOR.md)，上架 ChatGPT 的材料见 [CHATGPT_APP.md](docs/CHATGPT_APP.md)。电脑版扩展会在 [Releases](https://github.com/IcantFind-a-username/my-memory/releases) 发布。

**你的记忆在哪里**

- 电脑版：`~/PersonalMemory/memory.json`，只在你的电脑上。
- 在线版：服务器上只保存**加密后的数据**，解密的钥匙从你的私人链接算出来，服务器不保存链接。所以私人链接就是唯一的钥匙：不要分享，也请存好，弄丢了无法找回。
- 两种方式都一样：当次回答需要的几条记录，会随对话发给你正在用的 AI 公司（Anthropic 或 OpenAI）。

---

### 🪪 锚点卡（任何 AI，今天就能用）

一段只有几百字的"关于我"：你的现实锚点、你的规律、真正帮到过你的事、会让你更难受的话、你希望被怎样陪伴、撑不住时的计划。放进 AI 的个性化设置后，每个新对话都会自动带上。

1. 把 👉 [**锚点卡生成器.txt**](start/%E9%94%9A%E7%82%B9%E5%8D%A1%E7%94%9F%E6%88%90%E5%99%A8.txt) 发给任意一个 AI，回答几个问题（每题都能跳过），或者直接贴上你的日记和笔记。先看看样子：[示例卡](start/%E9%94%9A%E7%82%B9%E5%8D%A1%E7%A4%BA%E4%BE%8B.txt)。
2. 把得到的两段文字放进你用的 AI，每个平台只需要一次：

| 平台 | 放在哪里 |
|---|---|
| ChatGPT | 设置 → 个性化 → 自定义指令：第一段放"关于你"，第二段放"希望如何回复" |
| Claude | 设置 → 个人资料 → 个人偏好：两段一起放 |
| Gemini | 设置 → 已保存的信息 |
| 豆包 / 元宝 | 创建一个"仅自己可见"的智能体，两段放进设定 |
| DeepSeek 等 | 每次新对话开头粘贴一次（存进输入法"常用语"，一点就贴） |

3. 状态有变化时，在对话里说"更新锚点卡"。

> 锚点卡保存在各平台的设置里，所以只写称呼和城市，不写全名、电话、地址。

---

### 我们对你的承诺

- 🪞 **原话就是原话。** 不润色、不改写。你的感受不会被当成事实，"先后"不会被说成"因果"，AI 也不会给你下诊断。
- 🔒 **不被改动。** 包括以后的你自己。能做的只有补充、隐藏和慎重的删除。
- 👀 **你看得见。** 私人页面列出所有记录、完整性校验结果，以及 AI 什么时候读过哪几条。
- 🙋 **你说了算。** 自动记录随时可以暂停或关闭；标为"仅自己可见"的记录，任何 AI 都读不到。
- 🌍 **没有广告，不做数据生意，不锁定平台。**

### 常见问题

<details>
<summary><b>为什么连我自己都不能改原文？</b></summary>

因为在不同的状态下，你可能会看不懂、甚至不认同以前的某条记录。如果能随手改掉，这段记忆就不再可靠，也没办法帮你看清自己是怎么变化的。你可以随时**补充**后来的理解，它会和原话并排放着。真的需要删除时，隐藏后 7 天才会删掉，给你留出反悔的时间。
</details>

<details>
<summary><b>自动记录会把什么都记下来吗？</b></summary>

不会。按设计，AI 只在你聊到自己的时候记录：感受、发生的事、有用的方法、在意的人、计划。帮你写邮件、写代码这类对话不记录，"嗯""谢谢"这种也不会存。要不要记由 AI 来判断，所以偶尔会多记或漏记；多记的可以删掉。随时说"暂停记录"就会停。
</details>

<details>
<summary><b>这和 AI 自带的记忆有什么不同？</b></summary>

AI 自带的记忆由 AI 自己决定记什么、怎么改写，也可能把推断当成关于你的结论。这里保存的是**你的原话**，带时间、不可改动，AI 引用时必须给出处；而且同一个记忆库，Claude 和 ChatGPT 都能用。
</details>

<details>
<summary><b>要花钱吗？</b></summary>

不要。你继续用自己的 Claude 或 ChatGPT 就行。项目本身免费、开源，没有广告。
</details>

<details>
<summary><b>它能代替心理咨询或治疗吗？</b></summary>

不能。它帮你留住并找回自己的记忆，让 AI 的陪伴更有根据。它不是医生，也不是治疗。如果你正在接受专业帮助，它可以作为一个小小的补充；你也可以把导出的记录带给你信任的专业人员一起看。
</details>

### 如果你现在很难受

请先照顾好自己。如果你有伤害自己的念头，或觉得自己不安全，请现在就联系身边信任的人，或拨打急救电话：中国大陆 **120 / 110**，美国 **988**（心理危机热线）或 **911**，英国 **Samaritans 116 123**。

你不需要一个人扛着。

---

<a id="english"></a>

## English

### For you

Maybe you often feel cut off from who you were yesterday.
Maybe some days just go missing.
Maybe, looking back at yourself on a certain day, you feel like a stranger and can't be sure what really happened.

**My Memory** keeps what you say, word for word, with date and time, and **nobody can change it, not even a later you**.
When you talk to an AI, it looks up the exact record first ("On Sep 5 at 21:14 you wrote: …") instead of guessing.

### Two ways to use it

| | 🗂️ Memory archive | 🪪 Anchor card |
|---|---|---|
| For | Claude, ChatGPT | Any AI |
| Recording | Your words are kept automatically as you chat | No daily log, just one "about me" card |
| Finding | The AI can find the exact day and sentence | Every chat can read the card |
| Phone | Claude app ✅ (add once on the web, syncs to iPhone/Android); ChatGPT app needs a published app (review not guaranteed) | ✅ |
| Available now? | Code is ready; **a public address still has to be deployed** (one-click config included) | ✅ Today |

### 🗂️ Memory archive

- **No effort to record**: with automatic recording on, what you share about yourself is kept with its time. Say "pause recording" whenever you like.
- **Never changed**: each record is cryptographically chained to the one before, so a changed word or a quietly removed record shows up. Your private page always shows the integrity check.
- **Later understanding sits beside it**: add what you understand later; the original stays, side by side, so you can see how different states of you describe the same thing.
- **Exact, not guessed**: the AI quotes your words with date and time, or says "no record".
- **Deleting is deliberate**: a deleted record is hidden now and removed after 7 days (undo until then). In an emergency, destroy the whole archive from your private page.

**How**: in Claude (web, iPhone, Android, desktop), add the connector `<address>/mcp` once on claude.ai and sign in to a new or existing archive; the phone apps sync. ChatGPT needs the published app (phone and web), or developer mode on the web before that. Claude desktop users who want nothing on a server can install `personal-memory.mcpb` instead. The extension will appear under [Releases](https://github.com/IcantFind-a-username/my-memory/releases); the online version still needs a hosted address. See the [online connector guide](docs/CONNECTOR.md) to try or self-host it.

**Where it lives**: on your computer (desktop), or as encrypted data on the server (online), where the key comes from your private link and the server never stores it. The link is the only key: don't share it, and keep it safe; a lost link can't be recovered. In both cases, the few records needed for an answer go to the AI company you're using (Anthropic or OpenAI).

### 🪪 Anchor card (any AI, today)

A few hundred words "about me" (reality anchors, patterns, what helps, what makes it worse, how to be with me, what to do when I can't cope) placed once in each AI's personalisation settings. Send 👉 [**anchor-card-builder.txt**](start/anchor-card-builder.txt) to any AI to make yours; see the [example card](start/anchor-card-example.txt). Put part one in ChatGPT's "about you" and part two in "how to respond"; in Claude, both parts go into personal preferences; in Gemini, Saved info; elsewhere, paste it at the start of a chat. Say "update my anchor card" when things change.

### Our promises to you

- 🪞 **Your words stay your words.** Never polished or rewritten; feelings aren't treated as facts, "before" isn't turned into "because", and there's no diagnosis.
- 🔒 **Never changed**, not even by a later you. You can add, hide, and deliberately delete.
- 👀 **You can see everything**: all records, the integrity check, and when an AI read which ones.
- 🙋 **You decide.** Pause or turn off automatic recording any time; records marked "only for me" are never shown to any AI.
- 🌍 **No ads, no data business, no lock-in.**

### If things feel hard right now

Please look after yourself first. If you're thinking about hurting yourself, or you don't feel safe, reach out to someone you trust now, or call emergency services: **988** (US crisis line) or **911** in the US, **Samaritans 116 123** in the UK, **120 / 110** in mainland China.

You don't have to carry this alone.

---

<details>
<summary><b>🧰 More tools (optional) · 更多工具（可选）</b></summary>

<br>

- **Memory Capsule 记忆胶囊**: an offline page that keeps notes in your browser and lends an AI only the few that matter. 离线网页，只借出相关的几条。
- **Memory file 记忆文件** ([我的记忆.txt](start/%E6%88%91%E7%9A%84%E8%AE%B0%E5%BF%86.txt) · [my-memory.txt](start/my-memory.txt)): a plain-text log you can send to any AI. 纯文本日志。

</details>

<details>
<summary><b>🛠️ For developers · 开发者</b></summary>

<br>

Zero runtime dependencies. Node ≥ 20. 零运行时依赖。

```bash
npm test
```

```bash
npm run build
```

```bash
npm run serve
```

- `npm test`: 54 tests, including the real MCP server process, the online connector over HTTP (OAuth 2.1 sign-in with DCR + PKCE, encryption at rest, isolation, revocation), the record chain, and the capsule bundle
- `npm run build`: the Claude Desktop extension, the Skill and the Memory Capsule into `dist/`
- `npm run serve`: the online connector on port 8787 (see [CONNECTOR.md](docs/CONNECTOR.md) for HTTPS and deployment; a `Dockerfile` is included)

Docs 文档: [DESIGN.md](docs/DESIGN.md) · [CONNECTOR.md](docs/CONNECTOR.md) · [CHATGPT_APP.md](docs/CHATGPT_APP.md) · [THREAT_MODEL.md](docs/THREAT_MODEL.md) · [SELF_REVIEW.md](docs/SELF_REVIEW.md) · [Agent Skill](skill/personal-memory/SKILL.md)

Contributions are very welcome, especially from people with lived experience, clinicians, and translators. 欢迎贡献，特别欢迎有亲身经历的朋友、专业人员和译者。

</details>

<div align="center">

MIT License · Made with care 🌱 用心做的

</div>
