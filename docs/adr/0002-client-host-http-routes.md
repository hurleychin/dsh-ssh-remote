# ADR-0002：客户端与宿主半之间用同源 HTTP 路由通信，而非 Typert RPC

- 状态：已采纳
- 日期：2026-11-11

## 背景

本插件是「bundle 包」形态（`dsh.bundle.patch` + `dsh.client`），有 host 半（Node）与 client 半（浏览器 React）。两者需要通信（列举/新增/删除主机、发起连接、接收状态推送）。

## 决策

host 半用 `ctx.webServer.register({ kind: 'prefix', path: '/dsh-ssh-remote', handler })` 注册一组同源 HTTP 路由；client 半在面板里用 `fetch('/dsh-ssh-remote/*')` 调用，并用 `EventSource('/dsh-ssh-remote/events')` 接收状态推送（SSE）。

## 为什么不用 ctx.remote.<ns>（Typert RPC）

装好的 bundle 客户端若要 `ctx.remote.<namespace>`，需要由 Host FaceModel **代码生成器**产出 `typert.remote-client.js`（见 `dsh-schedule` 包里的 `typert.*.js`、`@deepseek-ai/dsh-typert-generator`）。这对第一版而言是额外的生成/构建负担。同源 HTTP 路由无需任何 codegen，完全自包含，浏览器与 host 都在同一 origin（`127.0.0.1:<port>`）。

## 备选方案

- **Typert `@Remote` + 生成代码**：最“正规”，但要引入生成器链路，第一版成本高，留待后续。
- **`harness.handle` + `host.call`**：那是动态 `cordis_define` 插件（`dsh-cordis-client-runner` 闭包）的机制，不适用于 bundle 包。

## 结果 / 限制

- 路由位于同源页面下，靠 token 门控访问；第一版未额外校验 peer 是否 owner，属已知限制（同源 + 本机回环监听已提供基本边界）。
- 后续若需要更严格的访问控制或类型化契约，可迁移到 Typert RPC。
