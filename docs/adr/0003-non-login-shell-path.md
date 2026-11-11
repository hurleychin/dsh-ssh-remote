# ADR-0003：引导脚本自行为非登录 shell 补齐用户级 PATH

- 状态：已采纳
- 日期：2026-11-11

## 背景

launch-and-own（ADR-0001）通过 `ssh <address> 'sh -s'` 把引导脚本送到远端执行。这条通道是非交互、非登录的 `sh`：它**不读** `~/.profile`、`~/.bashrc`、`~/.bash_profile`。因此远端只在这些启动文件里被加进 PATH 的用户级安装位置，在引导脚本里是**不可见**的。

典型触发场景：远端 `dsh` 通过 `npm i -g --prefix ~/.local`（或 pipx / 手工 symlink）装在 `~/.local/bin/dsh`。该目录通常只由 `~/.profile` 追加到交互登录 shell 的 PATH 中：

```
# 交互登录 shell
$ ssh host 'bash -lc "command -v dsh"'   → /home/<user>/.local/bin/dsh
# 引导脚本所用的非交互 sh
$ ssh host 'sh -c "command -v dsh"'      → (空) / NO_DSH
```

结果：引导脚本走 `DSHSSH nodsh` 分支，插件把 `remote: 'dsh' not found on PATH` 呈现给用户，连接反复在 `reconnecting`，看起来像「连不上」，实则是**远端已装 dsh、只是非登录 shell 找不到它**。

## 决策

在 `_bootstrapScript()` 里，于 `command -v dsh` 探测与启动之前，先把常见用户级 bin 目录前置进 PATH：

```sh
for d in "$HOME/.local/bin" "$HOME/.opencode/bin" "$HOME/.cargo/bin" "$HOME/.deno/bin" "$HOME/bin"; do
  [ -d "$d" ] && PATH="$d:$PATH"
done
export PATH
```

只追加已存在的目录，保持 PATH 干净；不改动用户在远端 shell 里的既有配置。

## 为什么不在别处解决

- **改用 `bash -lc` / `sh -l`**：登录 shell 会执行用户的启动文件，副作用不可控（可能打印 banner、耗时的 nvm/pyenv 初始化、甚至污染 stdout 干扰 `DSHSSH url` 解析）。引导脚本需要的是干净、可解析的输出。
- **要求用户把 PATH 写进非登录 shell**：可行但体验差，且用户往往只配了 `~/.profile`。作为隐式兜底更稳妥。
- **依赖绝对路径**：`dsh` 的安装位置因机器而异，无法写死。

## 结果 / 限制

- 覆盖了 `~/.local/bin`、`~/.opencode/bin`、`~/.cargo/bin`、`~/.deno/bin`、`~/bin` 这些常见用户级位置；若 `dsh` 装在这些之外的非常规目录，仍需用户在配置里显式提供可执行路径或自管 PATH。
- `dsh` 若是 `#!/usr/bin/env node` 且 `node` 也仅在交互 shell 可达，同样受此 PATH 补齐帮助（`node` 通常位于 `/usr/bin`，多数发行版不受影响）。
- 该改动只影响「未配置远端端口、需自行启动 dsh」的路径；显式配置了 `remotePort` 时直接开隧道，不经过此脚本。
