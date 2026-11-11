# ADR-0004：与 dsh-go 共用远端状态目录，实现双向复用同一 `dsh web`

- 状态：已采纳
- 日期：2026-11-11

## 背景

本插件（launch-and-own，见 [ADR-0001](0001-launch-and-own-remote-dsh.md)）默认在自己的状态目录 `~/.dsh-ssh-remote` 记录 `web.cmd / web.log` 并启动受管 `dsh web`。dsh-go 也用同一套策略，但状态目录写死为 `~/.dsh-app-remote`，并在其中记录 `web.cmd / web.pid / web.st / web.log`。

实测（目标机 `qinhulin@10.37.234.1`，raspberrypi，2026-11-11）暴露的核心问题：

- **只做了单向复用**：dsh-ssh-remote 把「远端状态目录」配成 `~/.dsh-app-remote` 后，能复用 dsh-go 启动的实例；但 **dsh-go 无法复用 dsh-ssh-remote 启动的实例**，于是两边各自又起一个 `dsh web`（实测 `1884216` vs `1884310`）。
- **根因是状态文件不兼容**：dsh-go 的复用判据是 `reusable = pid != null && sameCommand && URL可解析`，其中 `pid` 仅在 `web.pid` 存在且 `ours(pid)` 通过时非空；`ours()` 要求 `kill -0 <pid>` 成功 **且** `web.st`（进程 start-time）匹配。而插件的 `_bootstrapScript` **从不写 `web.pid` / `web.st`**（原设计只靠 HTTP 判活），所以 dsh-go 的 probe 永远得到 `pid = null` → 判不可复用 → 启动新实例。

实测证据（对插件式目录运行 dsh-go 的 `probeScript`）：只输出 `DSHAPP home` 行，**没有 `DSHAPP alive` 行** → `pid = null` → `reusable = false`。

## 决策

1. **默认远端状态目录改为 `$HOME/.dsh-app-remote`**（`REMOTE_STATE_DIR`），即与 dsh-go 共用同一目录。仍可按主机通过 `remoteStateDir` 覆盖。
2. 插件的 `_bootstrapScript` 在**自己启动**实例后，补写与 dsh-go 兼容的 `web.pid` 与 `web.st`：
   - 启动改为 `nohup dsh web … & P=$!`（不再用 `( … & )` 包裹子 shell），以拿到真实 pid；
   - `web.st` 的算法与 dsh-go 的 `_st()` 字节级一致（Linux 取 `/proc/<pid>/stat` 第 22 字段，否则 `ps -p <pid> -o lstart=`）。
3. **复用分支绝不覆盖 `web.pid` / `web.st`**：它们属于真正启动该实例的一方。复用（命中 `same_cmd && reachable`）直接返回日志 URL 并退出。
4. 重启旧实例时仅在 `web.pid` 存活 **且** `web.st` 匹配时才 `kill`，避免 pid 回收后误杀别的进程。

结果：双向复用成立——dsh-go 能认领插件启动的实例（`web.pid` + `web.st` 齐备），插件能认领 dsh-go 启动的实例（`web.log` 有带 token 的 URL 即可）。

## 为什么 token 可复用（修正 ADR-0001 的前提）

ADR-0001 曾断言「远端 `dsh web` 的 launch token 每进程随机、仅存内存、只打印一次、无法从文件恢复」，据此否决 attach 既有实例。实测证伪：

- `~/.dsh-app-remote/web.log` 中明文字段为 `dsh web: http://127.0.0.1:<port>/?token=<token>`，token **可从文件读取**；
- 同一 token 连续多次 `GET /?token=…` 均返回 `303`（无 token 为 `401`），即 token **非一次性、进程存续期内长期有效**；
- dsh-go 的 `DshLaunchUrl.tryParse` 用 `https?://\S+` 从整行抠 URL，故日志行前缀 `dsh web: ` 不影响解析。

因此「从日志取 token 复用远端实例」在机制上成立，共用状态目录是可行路径。（ADR-0001 保留其「launch-and-own 由本插件拥有实例」的主体决策，仅修正其「token 不可恢复」这一被证伪的前提。）

## 备选方案

- **插件保留独立目录 `~/.dsh-ssh-remote`，仅单向复用 dsh-go**：无法消除 dsh-go → 插件方向的重复启动；且需 dsh-go 侧改成扫多目录（Dart 改动 + 重发 APK），成本更高。否决。
- **镜像双写两份目录**：需同步 `web.pid/web.st/web.log/web.cmd`，逻辑复杂且易漂移，收益不比共用目录多。否决。

## 影响

- 改动集中在 `index.js` 的 `_bootstrapScript`（写 pid/st、启动方式、重启前校验）与默认状态目录常量；UI/文案、README、GLOSSARY 同步更新。
- 共用 `web.log`：后启动者会 `: > web.log` 截断重写，复用者只读最新 URL，不影响复用；但两套实现不应同时「首次启动」同一目录下的实例（并发下会竞争，属已知边界）。
- 已验证（`.1`）：源码抽取的真实引导脚本 → 启动后 `web.pid/web.st` 齐备 → dsh-go `ours()`=YES 且 `reusable=true`；二次运行复用成功且不覆盖 pid；最终仅 1 个 `dsh web` 进程。
