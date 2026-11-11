# dsh-ssh-remote — 领域术语表

本插件把「本 Harness」通过 SSH 连接到「另一台主机上的 DSH」。以下术语用于代码与文档，保持原样不翻译。

## 核心术语

- **本地 Harness（local Harness）**：当前运行、并在浏览器 `http://127.0.0.1:<port>` 暴露 Web GUI 的这台 DSH。插件挂载于它的 host 进程。
- **远端主机（remote host）**：通过 SSH 可达的另一台机器，其上运行着（或将由本插件启动）另一个 DSH。示例：`qinhulin@10.37.234.2`。
- **远端 DSH（remote DSH）**：远端主机上的 `dsh web` 进程。它监听远端回环 `127.0.0.1:<remotePort>`，只认带 `?token=` 的 URL 或已签发的 cookie。
- **launch-and-own**：本插件**自行启动并拥有**远端 `dsh web`（而非附着一个用户已运行的实例）的策略。原因见 ADR-0001：远端 `dsh web` 的 `launchToken` 每进程随机、仅存内存、只在启动时打印一次，无法从外部恢复。
- **远端状态目录（remote state dir）**：远端主机上存放 `web.pid / web.cmd / web.log` 的目录，用于下次连接时判定「自己上次启动的实例」是否仍可复用。对应 dsh-go 的 `~/.dsh-app-remote/`。**默认为 `$HOME/.dsh-ssh-remote`，可按主机配置**（host config 的 `remoteStateDir`）；配置值由远端 shell 展开：`~`/`$HOME` 开头按家目录、相对路径相对 `$HOME`、绝对路径原样。
- **主机记录（host record）**：本地插件对一台远端主机的内存态，包含连接阶段、隧道本地端口、隧道句柄、日志。不持久化。
- **主机配置（host config）**：持久化在本地 `$DSH_HOME/ssh-remote/hosts.json` 的非敏感字段：`name / host / user / port / remotePort / token`。**token 默认不落盘**（留空则每次连接从远端日志实时读取）。
- **隧道（tunnel）**：`ssh -N -L 127.0.0.1:<localPort>:127.0.0.1:<remotePort> <address>`。本地 `localPort` 在一条连接记录存活期间保持不变，使浏览器在新标签页打开的 URL 稳定。
- **健康检查（health check）**：经隧道 HTTP `GET http://127.0.0.1:<localPort>/`；返回 `401/303/200` 视为「远端 DSH 可达」，`ECONNREFUSED/timeout` 视为不可达。
- **连接阶段（phase）**：`idle → connecting → probing → tunneling → checking → connected → reconnecting → failed` 的状态机。
- **可复用（reusable）**：远端 `web.cmd` 与 `dsh web` 一致，且远端日志中的最新 URL 经 `curl` 仍返回 `401/200/303`。复用判定基于 HTTP 而非 pid 存活，因为 MINGW/Windows 下后台子进程的 shell pid 跨 SSH 会话不可靠。
- **引导脚本（bootstrap script）**：`_bootstrapScript()` 生成、经 `ssh <address> 'sh -s'` 在远端执行的 POSIX `sh` 脚本。它运行在**非交互、非登录** shell 中，不读 `~/.profile` / `~/.bashrc`，因此脚本自行把用户级 bin 目录（`~/.local/bin` 等）前置进 PATH，以免 `dsh` 装在 `~/.local/bin` 时找不到（见 ADR-0003）。

## 非术语（避免混用）

- 「远程主机」不要与第三方 P2P 插件 `ds-harness-remote`（WebRTC、非 SSH）混淆；两者独立。
- 「桌面端 dsh-go / dsh-tauri」指同类 SSH 远程方案的既有实现，本插件是其 Harness Web 插件版本。
