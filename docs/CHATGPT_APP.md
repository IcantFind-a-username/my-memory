# 上架 ChatGPT（让 ChatGPT 手机 App 能用）

ChatGPT 的开发者模式只在网页版可用，自定义 GPT 也正在下线（2026-09-25 停止新建，2026-12-11 停止运行）。要让 **ChatGPT 手机 App** 用上"我的记忆"，唯一的路是作为正式应用提交到 ChatGPT 的应用 / 插件目录，通过 OpenAI 审核。审核不保证通过。

提交需要用维护者自己的 OpenAI 开发者账号，由维护者本人操作；下面是需要准备的全部材料。

## 1. 先部署在线服务

见 [CONNECTOR.md](CONNECTOR.md)。上架要求一个稳定的 HTTPS 域名，最好是自己的域名（比如 `memory.example.org`），因为 OpenAI 要验证你拥有这个域名。

## 2. 域名验证

OpenAI 会给你一个验证字符串，并要求它出现在某个地址上（以提交页面上的说明为准）。设置两个环境变量后重启服务即可：

| 变量 | 例子 |
|---|---|
| `VERIFY_PATH` | 提交页面要求的路径，比如 `/.well-known/openai-apps-challenge` |
| `VERIFY_TOKEN` | OpenAI 给你的验证字符串 |

## 3. 提交表单要填的内容

| 项目 | 内容 |
|---|---|
| 名称 | My Memory · 我的记忆 |
| 图标 | `packaging/icon.png`（64×64，310 字节） |
| 一句话介绍 | Keeps what you share about yourself word for word, never edited, so ChatGPT can quote your own records instead of guessing. |
| 详细介绍 | A private, verbatim memory for people who lose track of time or feel disconnected from their past selves (for example through dissociation or strong mood changes). With the user's permission, ChatGPT saves what they share about themselves with its date and time; records are sealed in a tamper-evident chain and are never edited, and later understanding is added beside the original. Before answering, ChatGPT can look up exact records and quote them with date and time, or say that nothing is recorded. Data is encrypted at rest with a key derived from the user's private link, which the server does not keep. Not a medical or therapy service. |
| MCP 服务地址 | `https://你的域名/mcp` |
| 身份验证 | OAuth（支持动态客户端注册 + PKCE；元数据在 `/.well-known/oauth-authorization-server`） |
| 隐私政策 | `https://你的域名/privacy` |
| 服务条款 | `https://你的域名/terms` |
| 网站 | https://github.com/IcantFind-a-username/my-memory |
| 开发者名称 | 由维护者填写 |

## 4. 给审核人员的测试说明

> 1. Connect the app. On the sign-in page choose **"新建一个记忆库 / Create a new memory store"** (no account needed), save the shown private link, and continue.
> 2. Say: "Remember: I've been sleeping badly, but today a walk helped a bit." → the app records it.
> 3. In a new chat say: "I feel numb again and don't know why." → ChatGPT looks up the record and quotes it with its date and time, and says numbness was not recorded before.
> 4. Ask: "What exactly did I write about sleep?" → the `lookup` tool returns the verbatim record.
> 5. Say: "Forget that." → the record is hidden and scheduled for deletion after 7 days; "undo" restores it.

## 5. 工具说明（审核会看）

| 工具 | 类型 | 说明 |
|---|---|---|
| `remember` | 写入，非破坏性 | 保存用户关于自己的原话。只有在用户开启了自动记录，或者主动要求时才会保存 |
| `recall` | 只读 | 返回和当前消息相关的精简概览（带编号） |
| `lookup` | 只读 | 按编号、日期或关键词返回原话、时间和完整性校验 |
| `forget` | 破坏性，有冷静期 | 立刻隐藏，7 天后永久删除，期间可撤销 |
| `memory_info` | 写入（暂停 / 恢复记录） | 状态、完整性、访问记录、导出说明、暂停或恢复记录 |

## 6. 已知风险（上架前后都要实测）

- 有开发者反馈（2025 年 11 月）：ChatGPT 手机 App 里，MCP 应用的写入类工具被禁用、只读工具可以用。如果现在仍然如此，**手机上可以查档，但自动记录可能不生效**，要到网页或 Claude 上才能记录。上架后第一件事就是在 iPhone 和安卓上各测一次。
- 心理健康相关的应用可能会被更严格地审核。材料里要始终写清楚：它是个人记录工具，不是医疗服务，不做诊断。
