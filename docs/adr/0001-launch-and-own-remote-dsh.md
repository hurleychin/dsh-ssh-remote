# ADR-0001：远端 DSH 采用 launch-and-own，而非 attach 既有实例

- 状态：已采纳
- 日期：2026-11-11

## 背景

插件需要「在本 Harness 里通过 SSH 连接到另一台主机上的 DSH」。被参照的 dsh-go 分析流程里存在「探测远端 `~/.dsh-app-remote/web.log` 并复用已运行实例」的做法。

## 决策

**由插件自己启动并拥有远端 `dsh web`（launch-and-own）**：SSH 上去执行一段 POSIX 脚本，在远端**状态目录**（默认 `$HOME/.dsh-ssh-remote/`，可按主机通过 `remoteStateDir` 配置）记录 `web.pid/web.cmd/web.log`，用 `dsh web --host 127.0.0.1 --port 0 --no-open` 启动并重定向其 stdout 到 `web.log`，从日志抓 `…/?token=` 行拿到端口与 token。下次连接先按「可复用」规则判断能否复用自己上次启动的实例。

## 为什么不 attach 既有实例

> **修正（2026-11-11，见 [ADR-0004](0004-share-dsh-go-state-dir.md)）**：本节「token 无法从任何文件或接口恢复」的前提在实测中被证伪——远端 `web.log` 明文记录了带 token 的完整 URL，且该 token 非一次性、进程存续期内长期有效。因此现在改为**与 dsh-go 共用 `~/.dsh-app-remote` 并双向复用同一 `dsh web`**。本节仅保留作历史背景；「launch-and-own 由本插件拥有实例」的主体决策仍有效。
>
> 实测目标机 `qinhulin@10.37.234.1`（2026-11-11）：`~/.dsh-app-remote/web.log` 中带 token 的 URL 可读，多次 `GET /?token=…` 均返回 `303`（无 token 为 `401`）。

原论述（已被上述修正取代）：源码核实（`@deepseek-ai/dsh-client-connection` 的 `BrowserAuth`/`processLaunchToken`）：`launchToken = encodeBase64Url(randomBytes(SECRET_BYTES))`，每进程随机生成、仅存于内存、只打印一次到 stdout，一个并非本插件启动的、正在运行的远端 `dsh web` 的 token 无法从任何文件或接口恢复。

## 结果

- 每次连接可能让远端多一个 `dsh web` 进程；本插件负责在可复用时复用、否则重启（先 `kill` 旧实例）。（**更新**：与 dsh-go 共用状态目录后，两套实现互相复用，重复进程问题已消除，见 ADR-0004。）
- token 不落本地磁盘，安全性更好。（**更新**：token 实际随 `web.log` 落在远端状态目录，复用时从日志读取，见 ADR-0004。）
- 复用判定用 HTTP 探活（远端日志最新 URL 仍返回 401/200/303），而非 pid 存活，以兼容 Windows/MINGW 下 pid 跨会话不可靠的事实。（**补充**：同时写出 `web.pid`/`web.st` 以兼容 dsh-go 的 pid+start-time 认领条件，见 ADR-0004。）

## 备选方案

- **attach 既有实例**：不可行（token 不可恢复），已否决。
- **要求用户手填远端 port+token**：可行但体验差，作为 `remotePort/token` 留空时的降级路径保留。

## 影响

代码集中在 `index.js` 的 `_ensureRemoteDsh` / `_bootstrapScript` / `_runRemote`。
