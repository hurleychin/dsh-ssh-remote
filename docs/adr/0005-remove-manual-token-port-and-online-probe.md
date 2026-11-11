# ADR-0005：移除远端 token/端口手动配置，改用 TCP 探测在线状态，主机管理改为弹窗

- 状态：已采纳
- 日期：2026-11-11

## 背景

经过 [ADR-0004](0004-share-dsh-go-state-dir.md) 后，插件已固定为「launch-and-own 远端 `dsh web`，并从远端日志读取 port+token」。这让原先暴露给用户的两个字段变得多余且易误导：

- **远端 token**：只有在用户「自备一个已在跑的 dsh 并填固定端口」时才有意义；一旦固定走 launch-and-own，token 总能从 `~/.dsh-app-remote/web.log` 自动解析（`dsh web: http://127.0.0.1:<port>/?token=…`）。保留手填入口只会让用户困惑「不填会不会 401」。
- **远端 dsh 端口**：同理，固定端口会让插件跳过 launch-and-own，反而破坏与 dsh-go 的实例复用。留空才是常态，字段本身是负担。

同时，主机列表的交互存在改进空间：

- 添加/编辑用内联卡片插在列表顶部，视觉上与列表项混杂；
- 卡片常驻 `连接 / 修改 / 删除` 三个按钮，拥挤且删除误点风险高；
- 名称前的小圆点只反映本机连接相位，不表达「这台远端主机是否在线」。

## 决策

1. **彻底移除 `token` 与 `remotePort` 概念**：
   - `normalizeHost()` 不再读写这两个字段；老 `hosts.json` 里残留的字段在加载时被忽略，下次保存自然消失（不主动重写文件）。
   - `_connectOnce()` 无条件走 launch-and-own，从远端日志取 port+token；不再有「无 token」分支。
2. **在线状态用 TCP 探测**：Host 半新增 `probeHosts()`，对每台主机用 `node:net` 打开短连接（默认 3.5s 超时）探测 `<host>:<port>`。选 TCP 而非 ICMP `ping` 的理由：浏览器无法发 ICMP；TCP 无需子进程与输出解析、跨平台一致；且它直接验证「SSH 端口是否可达」，比 ping 更贴近真实可用性。暴露 `GET /dsh-ssh-remote/probe` 返回 `{ online: { id: bool } }`。
3. **三态在线图标**：名称前圆点 → 绿=在线、红=离线、黄=探测中/未知；连接已 `connected` 时强制绿（连接成功本身即证明可达）。连接相位（未连接/连接中/已连接/失败）继续用右侧文字表达，不与在线图标重复。
4. **轮询策略**：面板挂载即探测一次，此后每 30s 轮询；当 `document.visibilityState !== 'visible'`（切走标签页/离开面板）时暂停，回来的 `visibilitychange` 立即补探一次。不提供手动刷新按钮。
5. **弹窗化主机管理**：添加与「设置」共用同一个 Modal（遮罩 + 居中卡片）；设置态标题「修改主机」并多出一个删除按钮，删除在该弹窗内做内联二次确认（同层级，不再叠一个 modal）。ESC / 点遮罩 / 取消 = 丢弃未保存修改；保存/删除进行中禁用所有关闭方式。
6. **单行卡片**：`● 名称  user@host（点击复制，toast 提示已复制）  状态文字  [打开] [连接/断开] [⚙]`。⚙ 图标替代原「修改」「删除」两按钮，打开设置弹窗。
7. **表单**：名称；`主机 [user@host……] [22]`（端口输入框紧贴主机框右侧、无标签、窄宽、默认 22，显式端口值优先于地址内嵌的 `:port`）；远端状态目录（默认 `~/.dsh-app-remote`）。移除 token / 远端 dsh 端口两个输入。

## 备选方案

- **只删 UI 字段、后端保留 `host.token` / `host.remotePort` 读取**：老配置可继续工作，但留下不可见的「幽灵配置」，后续维护更乱。否决。
- **在线探测用 ICMP `ping` 子进程**：需要按 Windows/Linux 分别解析 `ping` 输出、暴露命令注入面、且很多主机/防火墙禁 ICMP 会误报离线。否决。
- **在线探测用 `ssh -o ConnectTimeout true`**：更贴近 SSH 真实可用性，但慢、且在 BatchMode 缺密钥时会误报离线。否决。
- **保留内联表单 + 三按钮**：改动最小，但拥挤、删除误点、与弹窗化诉求冲突。否决。

## 影响

- `index.js`：`normalizeHost` 去字段；`_connectOnce` 无条件 launch-and-own；新增 `Socket` 导入、`_probeOne`/`probeHosts`、`/probe` 路由。
- `client.js`：`DICT`/`CSS`/表单/卡片/面板重写，新增 `HostModal`、`HostFormBody`、`GearIcon`、`onlineColor`，移除 `badgeColor` 与内联 `HostForm`。
- `locale/zh.json`、`locale/en.json`：删 `remotePort`/`remotePortHint`/`token`/`tokenHint`；增 `addTitle`/`editTitle`/`confirmDelete`/`deleteWarn`/`portPlaceholder`/`settings`/`online`/`offline`/`probing`/`saveFailed`。
- 配置契约变更（字段移除）→ 版本 `0.1.1 → 0.2.0`。
- 边界：已 `connected` 但 TCP 探测失败时仍显示绿（下一轮探测修正）；对多台主机每次轮询并发探测，主机很多时会产生等量短连接。
- 已知限制：TCP 探测按**主机名字面**解析 DNS。若主机填的是 `~/.ssh/config` 里由 `HostName`/`ProxyJump` 间接指向的别名（别名本身不是可解析的 DNS 名），探测会失败而显示「离线」，但 SSH 连接本身仍可用。此时仍可正常连接（连接成功后圆点强制变绿）。
