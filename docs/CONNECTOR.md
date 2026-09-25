# 在线连接器 · Online connector

让 **ChatGPT** 和 **Claude（网页、手机、电脑）** 用上同一个记忆库。
用户只需要在 AI 的设置里添加一次网址，之后聊天会自动记录原话，AI 回答前可以查到确切的记录。

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

任何能跑 Docker、带持久化磁盘和 HTTPS 的地方都可以。数据目录是 `/data`，只放密文。

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
| `PUBLIC_URL` | 从请求推断 | 页面上显示的网址，正式部署时请设置 |

## 添加到 AI

**Claude**（免费版可添加 1 个自定义连接器）：Customize → Connectors → **+** → 名称"我的记忆"，网址填 `…/u/<私人钥匙>/mcp`。

**ChatGPT**（网页版，Plus 及以上）：Settings → Security and login → 打开 Developer mode；Settings → Apps & Connectors → Create → 填网址，Authentication 选 No authentication。

菜单名称以平台实际为准。

## 接口

| 路径 | 用途 |
|---|---|
| `GET /` | 创建页 |
| `POST /u/<token>/mcp` | MCP（Streamable HTTP，JSON 响应；通知返回 202） |
| `GET /u/<token>/` | 私人页面：记录、完整性、设置、导出、销毁 |
| `GET /u/<token>/export.json` | 下载全部记录（含校验链） |
| `GET /health` | 健康检查 |

以后可以改进的：OAuth 登录（替代"链接即钥匙"）、钥匙的纸质恢复码、多设备的本地加密同步。
