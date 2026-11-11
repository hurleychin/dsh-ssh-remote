# dsh-ssh-remote

在 DeepSeek Harness 的 Web GUI 里，**通过 SSH 连接到另一台主机上的 DSH**（对应 dsh-go / dsh-tauri 的 SSH 远程主机流程的 Harness 插件版本）。

## 使用

1. 侧栏出现「远程主机」图标（`sidebar.panellist`，order 20），点击打开面板。
2. 「添加主机」填入 `名称`、`主机`（`user@host` 或 `~/.ssh/config` 别名）、`SSH 端口`。
   - `远端 dsh 端口`、`远端 token` 留空即可：插件会 SSH 上去启动一个受管的远端 `dsh web` 并从日志读取端口与 token。
3. 点「连接」。面板显示 `连接中 → 启动远端 dsh web… → 建立隧道… → 检查远端 Harness… → 已连接`。
4. 连接成功后出现「打开远端 Harness」按钮，点开新标签页即进入远端那台 DSH（`http://127.0.0.1:<本地隧道口>/?token=…`）。

## 工作流程（对应参照的 SSH 分析流程）

1. **connect**：`ssh -L 127.0.0.1:<localPort>:127.0.0.1:<remotePort>`（`ExitOnForwardFailure`、`ServerAliveInterval=15`）。
2. **probe/own**：若未配置远端端口，SSH 执行引导脚本，在远端 `$HOME/.dsh-ssh-remote/` 记录 `web.pid/web.cmd/web.log`，`dsh web --host 127.0.0.1 --port 0 --no-open` 启动，读日志首行 `…/?token=`。可复用则复用。
3. **tunnel**：本地固定端口转发到远端回环端口。
4. **check**：经隧道 HTTP 根路径，`401/303/200` 视为可达。
5. **keepalive**：每 15s 健康检查；断线指数退避重连。

详见 [GLOSSARY.md](GLOSSARY.md) 与 [docs/adr/](docs/adr/)。

## 结构

- `index.js`（host 半）：`SshRemoteService`——主机配置持久化（`$DSH_HOME/ssh-remote/hosts.json`）、SSH 隧道、launch-and-own、健康检查、重连、SSE 推送、`/dsh-ssh-remote/*` HTTP 路由。
- `client.js`（client 半）：`sidebar.panellist` 图标 + `main` 面板（React），经同源 `fetch`/`EventSource` 与 host 半通信。
- `cordis.patch.yml`：插入一行 `ssh-remote`。

## 依赖的 Host Service

`subprocess`（spawn `ssh`）、`webServer`（注册路由）。无需 `ctx.ssh`（本 profile 未提供）。

## 限制 / 后续

- 第一版未类型化 RPC（见 ADR-0002）；未做 owner 级路由鉴权（同源 + 回环为基本边界）。
- 连接断开后远端受管 `dsh web` 仍保留以便下次复用（launch-and-own 语义）。
- 若 `~/.ssh/config` 未配免密且非密钥认证，需先用 `ssh-copy-id` 或配置 agent（插件用 `BatchMode=yes`，不做交互式密码）。
