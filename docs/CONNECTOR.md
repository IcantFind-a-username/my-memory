# 在线连接器 · Online connector

让 **Claude（网页、电脑、iPhone、安卓）** 和 **ChatGPT** 用上同一个记忆库。
用户只需要添加一次，之后聊天会自动记录原话，AI 回答前可以查到确切的记录。

## 手机能不能用

| | 怎么接入 | 手机 App |
|---|---|---|
| Claude | 在 claude.ai 网页上添加连接器 `https://你的域名/mcp`，按提示登录（或者直接填私人连接地址） | ✅ 网页上加一次，iPhone 和安卓自动同步 |
| ChatGPT | 上架前：只能在网页版开发者模式里用。上架后：在应用目录里连接 | ⚠️ 必须上架（见 [CHATGPT_APP.md](CHATGPT_APP.md)），而且有报告称手机上写入类工具被禁用，需要实测 |

## 两种接入方式

- **公开地址 + 登录（OAuth 2.1）**：`https://你的域名/mcp`。AI 应用会打开授权页，用户在那里新建记忆库，或者粘贴私人页面链接连接已有的。上架 ChatGPT 必须用这种方式。连接后的令牌会一直有效，直到用户在私人页面点"断开所有通过登录连接的 AI"。
- **私人连接地址**：`https://你的域名/u/<私人钥匙>/mcp`，不需要登录，适合 Claude 自己用。

Claude 电脑版也可以不用在线版，直接装本地扩展（`dist/personal-memory.mcpb`），数据只在自己电脑上。

## 它怎么保护数据

| | 做法 |
|---|---|
| 身份 | 不用账号。每个人创建时得到一个私人链接，里面有 32 字节的随机钥匙 |
| 磁盘 | 只存加密数据（AES-256-GCM）。目录名和加密钥匙都用 HKDF 从私人链接推导出来，服务器**不保存链接和钥匙**。拿到硬盘或备份的人读不出任何人的内容 |
| 原文 | 只能追加。每条记录用 SHA-256 与前一条串起来，改一个字或悄悄删掉一条都会在私人页面和 `status` 里显示出来 |
| 删除 | 先隐藏，7 天后才真正删除，期间可撤销；删除后在原位置留下删除标记 |
| 紧急情况 | 私人页面可以立即销毁整个记忆库（需要输入"删除"确认） |
| 发给 AI 的 | 只有当次回答需要的几条记录，会随对话发给 OpenAI 或 Anthropic |

**做不到的，要说清楚**：
- 服务器在处理请求的那一刻，内存里是明文。运营者如果改代码，是可以截取的。所以用户需要信任运营者；不想信任任何人的，用本地扩展或者自己部署。
- 私人链接就是钥匙：泄露了别人就能读，弄丢了没有任何办法找回。
- 私人链接会出现在 AI 平台的连接器设置里，也就是平台知道这个网址。

## 5 分钟在自己电脑上试（不用买服务器）

ChatGPT 和 Claude 只接受 `https://` 开头的公网地址，可以用 Cloudflare 的临时隧道把本机服务暴露出去。

```bash
npm run serve
```

另开一个终端（需要先安装 cloudflared，比如 `brew install cloudflared`）：

```bash
cloudflared tunnel --url http://localhost:8787
```

打开它给出的 `https://xxxx.trycloudflare.com`，点"创建我的记忆库"，按页面上的步骤添加到 Claude 或 ChatGPT。
临时隧道的网址每次都会变，电脑关机后也就断了，只适合试用。

## 正式部署

**最简单：Render 一键部署。** 仓库里带了 `render.yaml`：在 Render 注册 → New → Blueprint → 选择这个 GitHub 仓库 → 确认。它会自动构建、分配 HTTPS 地址、挂 1 GB 磁盘，并生成服务器密钥。持久化磁盘需要付费实例（以 Render 当前价格为准）。部署好后，页面地址就是你的服务地址，也可以在 Render 里绑定自己的域名。

也可以部署在任何能跑 Docker、带持久化磁盘和 HTTPS 的地方。数据目录是 `/data`，只放密文。

```bash
docker build -t personal-memory .
```

```bash
docker run -d --name personal-memory -p 8787:8787 -v personal-memory-data:/data -e PUBLIC_URL=https://memory.example.org personal-memory
```

再在前面加一个 HTTPS 反向代理（比如 Caddy），或者使用平台自带的 HTTPS。

以 Fly.io 为例（命令以官方文档为准）：先 `fly launch --no-deploy`，然后 `fly volumes create memdata --size 1`，在 `fly.toml` 里把 `memdata` 挂载到 `/data`、设置 `PUBLIC_URL`，最后 `fly deploy`。

环境变量：

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | 8787 | 监听端口 |
| `PERSONAL_MEMORY_DATA` | `./data` | 加密数据目录 |
| `PUBLIC_URL` | 从请求推断（Render、Fly.io 会自动识别） | 页面上显示的网址，也是 OAuth 的 issuer |
| `PERSONAL_MEMORY_SECRET` | 首次启动时生成 `/data/server.key` | 签发登录令牌的服务器密钥。更换它会让所有已连接的 AI 需要重新登录 |
| `VERIFY_PATH` / `VERIFY_TOKEN` | 无 | 平台要求的域名验证（比如上架 ChatGPT） |

## 添加到 AI

**Claude**（免费版可添加 1 个自定义连接器）：在 claude.ai 上 Customize → Connectors → **+** → 名称"我的记忆"，网址填 `https://你的域名/mcp` → 连接 → 在授权页选择"连接我已有的记忆库"或"新建"。手机 App 会自动同步。

**ChatGPT 网页版（上架前测试用）**（Plus 及以上）：Settings → Security and login → 打开 Developer mode；Settings → Apps & Connectors → Create → 网址填 `https://你的域名/mcp`，Authentication 选 OAuth。

**ChatGPT 手机版**：上架后在应用目录里连接，见 [CHATGPT_APP.md](CHATGPT_APP.md)。

菜单名称以平台实际为准。

## 接口

| 路径 | 用途 |
|---|---|
| `GET /` | 创建页 |
| `POST /mcp` | MCP（需要 OAuth 令牌；未登录返回 401 并指向元数据） |
| `GET /.well-known/oauth-protected-resource`、`/.well-known/oauth-authorization-server` | OAuth 元数据 |
| `POST /register`、`GET/POST /authorize`、`POST /token` | 动态注册、授权页、令牌（PKCE S256、刷新） |
| `POST /u/<token>/mcp` | MCP（私人连接地址；Streamable HTTP，JSON 响应；通知返回 202） |
| `GET /u/<token>/` | 私人页面：记录、完整性、设置、导出、销毁 |
| `GET /u/<token>/export.json` | 下载全部记录（含校验链） |
| `GET /health` | 健康检查 |

以后可以改进的：钥匙的纸质恢复码、按应用单独断开、多设备的本地加密同步。
