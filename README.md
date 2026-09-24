<div align="center">

# 🌱 我的记忆 · My Memory

**让你拥有自己的记忆，需要的时候，借给 AI 一小部分。**<br>
**Your memories belong to you. Lend a little to AI, only when you need to.**

免费 · 开源 · 无广告 · 不用注册 · 记忆只存在你自己的设备上<br>
Free · Open source · No ads · No account · Stays on your own device

[中文](#中文) · [English](#english)

</div>

---

<a id="中文"></a>

## 中文

### 写给你

也许你常常觉得，和昨天的自己断了线。
也许有些日子会突然"丢失"，想不起发生过什么。
也许情绪来的时候很猛，事后又说不清它从哪里来。

**我的记忆**是一个很小的工具。它帮你把重要的事情记下来：你的感受、发生过的事、那些真的帮到过你的小方法、写给未来自己的话。等你需要的时候，它会悄悄找出和现在最相关的几条，递给你正在聊天的 AI，让 AI 能接着"你的过去"来陪你说话。

它不会替你记住一切，也不会把你的一切交给 AI。**记忆是你的，你决定借出去多少。**

### 用起来是什么样子

你不需要学任何新东西，像平常一样聊天就好。

> **第 1 天**，你说：
> "记住，我最近睡眠很差，今天出去走路以后感觉舒服了一点。"
>
> AI：记下了，最近睡得不好，今天散步后好一点。想删掉随时告诉我。

> **第 20 天**，你说：
> "我现在又觉得很麻木，不知道为什么。"
>
> 这一次，AI 只会看到几行和你有关的记录，并且会告诉你它看了什么：
>
> 📎 *这次借给 AI 的记忆：20 天前你记录"我最近睡眠很差"；散步对你有一点帮助；之前的记录里没有提到麻木。*
>
> AI：我看了一下你 20 天前的记录，那时候睡得不太好，出门走走后好受了一点。要不要先看看最近几天睡得怎么样？如果可以的话，也许可以试试出去走十分钟……

其他你可以说的话：

| 你可以说 | 它会做什么 |
|---|---|
| "我最近发生了什么？" | 帮你回顾最近两周记下的事 |
| "上次我这样是什么时候？" | 找找过去有没有相似的时期 |
| "以前什么对我有帮助？" | 列出你记录过、真的帮到过你的方法 |
| "我是谁，今天是哪天？" | 读出你给自己写的现实锚点 |
| "我想看看过去的我留给我的话" | 读出你写给未来自己的留言 |
| "忘掉刚才那条" | 删除 |
| "谁看过我的记忆？" | 告诉你 AI 什么时候读过、读了几条 |

### 三种用法，选一种就好

> 💡 第一个正式版本还在准备中。发布后会放在本页右侧的 [Releases](https://github.com/IcantFind-a-username/my-memory/releases)，不需要懂 GitHub，点下载就行。

**🖥️ 如果你用 Claude 电脑版（Mac / Windows）**

1. 下载 `personal-memory.mcpb`
2. 双击它，在弹出的窗口里点"安装"
3. 开始聊天。不需要装别的东西，也不用碰命令行。

**📱 如果你用豆包、DeepSeek、元宝、Kimi、ChatGPT，或任何 AI**

用**记忆胶囊**：一个小小的离线网页，不联网，不上传。

1. 打开 `personal-memory-capsule.html`（手机上可以"添加到主屏幕"）
2. 在「记下来」里写下想记住的事
3. 想问 AI 的时候，先在「问 AI 之前」里输入问题。它会告诉你这次要带上哪几条记忆，不想带的，取消勾选就好
4. 点「复制」，粘贴到任何 AI 的对话框
5. 如果 AI 的回答里出现【记忆候选】，可以把回答粘回来，由你决定存不存

**🧩 如果你的 AI 支持安装 Skill**

上传 `personal-memory-skill.zip`。它会告诉 AI：什么时候该用你的记忆，怎么温柔、诚实地说话，哪些事情不能做。

### 我们对你的承诺

- 🤫 **不偷偷记。** 只有你说"记住"，或你同意了 AI 的提议，才会保存。
- 🤏 **每次只借一点点。** 只借和这次对话有关的几条，通常只有几十个词。和你无关的问题（比如写邮件、查天气），一条都不借。
- 👀 **你知道 AI 看到了什么。** 每次借出都会附一句说明；用记忆胶囊时，复制前你就能逐条看到、逐条取消。
- 🔒 **私密的就是私密的。** 标成"只给我自己看"的记录，任何 AI 都看不到。标成"敏感"的，默认也不给，除非你自己打开。
- 🪞 **感受就是感受。** 你当时的感受会被标成"你的感受"，而不是事实。AI 不会把"先后"说成"因果"，也不会给你下诊断。
- 🗑️ **随时可以删、可以带走。** 删除一条、导出全部、或者直接删掉整个文件夹，都由你决定。

### 你的记忆放在哪里

- **Claude 电脑版**：在你电脑的 `PersonalMemory` 文件夹里，是一个可以直接打开、备份、删除的文件。
- **记忆胶囊**：在你手机或电脑的浏览器里。清理浏览器数据时它也会被清掉，所以偶尔点一下「导出备份」吧。
- 两边的备份可以互相导入。

更多细节见 [隐私说明](docs/PRIVACY.md)。

### 常见问题

<details>
<summary><b>要花钱吗？需要注册吗？</b></summary>

不要钱，也不用注册。这是一个公益开源项目，没有广告，不收集你的使用数据。
</details>

<details>
<summary><b>我完全不懂技术，能用吗？</b></summary>

能。它就是为不想折腾的人做的。你只需要下载、双击，或者打开一个网页。剩下的交给它。
</details>

<details>
<summary><b>AI 会不会记住我说过的所有话？</b></summary>

不会。只有你明确说"记住"的内容才会被保存。每次对话，AI 也只会借到很少的几条。
</details>

<details>
<summary><b>我说了"只给我自己看"，这次对话的 AI 是不是已经看到了？</b></summary>

是的。你在对话里说出来的话，这一次的 AI 已经看到了。"只给我自己看"保护的是**以后**的对话。如果有些话你希望任何 AI 都不要看到，请直接写在记忆胶囊里。
</details>

<details>
<summary><b>它能代替心理咨询或治疗吗？</b></summary>

不能。它只是帮你留住自己的记忆、找回时间线、想起曾经帮到过你的方法。它不是医生，也不是治疗。如果你正在接受专业帮助，它可以作为一个小小的补充。
</details>

### 如果你现在很难受

请先照顾好自己。如果你有伤害自己的念头，或觉得自己不安全，请现在就联系身边信任的人，或拨打急救电话：中国大陆 **120 / 110**，美国 **988**（心理危机热线）或 **911**，英国 **Samaritans 116 123**。

你不需要一个人扛着。

---

<a id="english"></a>

## English

### For you

Maybe you often feel cut off from who you were yesterday.
Maybe some days just go missing, and you can't recall what happened.
Maybe a feeling hits hard, and afterwards you can't tell where it came from.

**My Memory** is a small tool. It helps you keep the things that matter: how you felt, what happened, the little things that actually helped, the notes you write to your future self. When you need them, it quietly finds the few that matter right now and hands them to the AI you're talking with, so the AI can meet you where your story left off.

It won't remember everything for you, and it won't hand everything to an AI. **Your memories are yours. You decide how much to lend.**

### What it feels like

There's nothing new to learn. Just talk the way you normally do.

> **Day 1**, you say:
> "Remember: I've been sleeping badly, but today I went for a walk and felt a bit better."
>
> AI: Got it: sleeping badly lately, and a walk helped a little today. Just tell me if you want it deleted.

> **Day 20**, you say:
> "I feel numb again and I don't know why."
>
> This time the AI sees only a few lines about you, and it tells you what it looked at:
>
> 📎 *What the AI sees from your memory this time: 20 days ago you noted "I've been sleeping badly"; walking helped a bit; your earlier notes don't mention numbness.*
>
> AI: I looked at your note from 20 days ago. You weren't sleeping well then, and a walk helped a little. How has your sleep been these past few days? If it feels doable, maybe a ten-minute walk…

Other things you can say:

| You can say | What it does |
|---|---|
| "What's been happening with me lately?" | Looks back over the last two weeks |
| "When did I last feel like this?" | Finds similar times in your past |
| "What helped me before?" | Lists what you recorded as actually helping |
| "Who am I, what day is it?" | Reads the reality anchors you wrote for yourself |
| "Show me what my past self wrote to me" | Reads your messages to your future self |
| "Forget that" | Deletes it |
| "Who has read my memory?" | Shows when an AI read it, and how much |

### Three ways to use it: pick one

> 💡 The first release is on its way. It will appear under [Releases](https://github.com/IcantFind-a-username/my-memory/releases) on this page. No GitHub know-how needed: just click to download.

**🖥️ Claude desktop app (Mac / Windows)**

1. Download `personal-memory.mcpb`
2. Double-click it and choose "Install"
3. Start chatting. Nothing else to install, no command line.

**📱 ChatGPT, Gemini, DeepSeek, or any other AI**

Use the **Memory Capsule**: a small offline web page that never connects to the internet.

1. Open `personal-memory-capsule.html` (on a phone, "Add to Home Screen")
2. Write down what you want to keep under **Remember**
3. Before asking an AI, type your question under **Before asking AI**. It shows which memories would come along; untick anything you'd rather keep to yourself
4. Tap **Copy** and paste into any AI chat
5. If the AI's reply includes a **[MEMORY CANDIDATE]**, paste it back and choose whether to keep it

**🧩 If your AI app supports Skills**

Upload `personal-memory-skill.zip`. It teaches the AI when to use your memory, how to speak gently and honestly, and what it must never do.

### Our promises to you

- 🤫 **Nothing is saved behind your back.** Only when you say "remember", or agree to the AI's suggestion.
- 🤏 **Only a little, each time.** Just the few lines that matter for this conversation. Unrelated questions (an email, the weather) borrow nothing.
- 👀 **You know what the AI sees.** Every time memory is lent, you're told what. With the Memory Capsule you see it, line by line, before you copy.
- 🔒 **Private means private.** Notes marked "only for me" are never shown to any AI. Notes marked "sensitive" aren't either, unless you turn that on yourself.
- 🪞 **Feelings stay feelings.** What you felt is labelled as your feeling, not as fact. The AI won't turn "this came before that" into "this caused that", and it won't diagnose you.
- 🗑️ **Delete it or take it with you, any time.** One note, all of it, or the whole folder: your call.

### Where your memory lives

- **Claude desktop app:** in a `PersonalMemory` folder on your computer, as one file you can open, back up, or delete.
- **Memory Capsule:** in your phone's or computer's browser. Clearing browser data clears it too, so tap **Export backup** now and then.
- Backups from either one can be imported into the other.

More in the [privacy notes](docs/PRIVACY.md).

### Questions

<details>
<summary><b>Does it cost anything? Do I need an account?</b></summary>

No and no. It's a free, open-source, non-profit project. No ads, and no tracking of how you use it.
</details>

<details>
<summary><b>I'm not technical at all. Can I use it?</b></summary>

Yes. It's made for people who don't want to fiddle with things. Download and double-click, or open a web page. That's it.
</details>

<details>
<summary><b>Will the AI remember everything I say?</b></summary>

No. Only what you clearly ask it to remember is saved, and each conversation borrows just a few notes.
</details>

<details>
<summary><b>I said "only for me". Did this conversation's AI already see it?</b></summary>

Yes. Whatever you say in a chat, that chat's AI has already seen. "Only for me" protects your **future** conversations. For things you never want any AI to see, write them straight into the Memory Capsule.
</details>

<details>
<summary><b>Can it replace therapy?</b></summary>

No. It helps you hold on to your own memories, find your timeline again, and remember what has helped before. It isn't a doctor or a treatment. If you're already getting professional support, it can be a small companion to that.
</details>

### If things feel hard right now

Please look after yourself first. If you're thinking about hurting yourself, or you don't feel safe, reach out to someone you trust now, or call emergency services: **988** (US crisis line) or **911** in the US, **Samaritans 116 123** in the UK, **120 / 110** in mainland China.

You don't have to carry this alone.

---

<details>
<summary><b>🛠️ For developers · 开发者</b></summary>

<br>

Zero runtime dependencies. Node ≥ 20. 零运行时依赖。

```bash
npm test
```

```bash
npm run demo
```

```bash
npm run build
```

- `npm test`: 32 tests, including the real MCP server process and the bundled capsule
- `npm run demo`: the Day 1 → Day 20 chain in a throwaway folder
- `npm run build`: writes the Claude Desktop extension, the Skill and the Memory Capsule to `dist/`

Docs 文档:
- [DESIGN.md](docs/DESIGN.md): architecture, memory schema, retrieval & Memory Compiler, distribution, MVP scope, plan
- [THREAT_MODEL.md](docs/THREAT_MODEL.md)
- [SELF_REVIEW.md](docs/SELF_REVIEW.md): adversarial self-review and known gaps
- [Agent Skill](skill/personal-memory/SKILL.md) · [MCP server](src/mcp/server.js) · [Memory Capsule](capsule/capsule.html)

Contributions are very welcome, especially from people with lived experience, clinicians, and translators. 欢迎贡献，特别欢迎有亲身经历的朋友、专业人员和译者。

</details>

<div align="center">

MIT License · Made with care 🌱 用心做的

</div>
