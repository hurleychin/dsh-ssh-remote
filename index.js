/**
 * dsh-ssh-remote — Host half.
 *
 * Connects this DeepSeek Harness to the DSH running on another machine over
 * SSH. The flow mirrors the dsh-go / dsh-tauri SSH plugin:
 *
 *   1. connect   — spawn `ssh` (own ControlMaster-free connection) with a
 *                  loopback `-L` forward (local ephemeral port -> remote dsh port).
 *   2. probe/own — if the configured remote port/token are blank, SSH in,
 *                  start `dsh web --host 127.0.0.1 --port 0 --no-open` (its
 *                  stdout captured to a per-host remote log), and read the
 *                  `dsh web: http://127.0.0.1:<port>/?token=...` line. The
 *                  remote pid/start-time/log live in remote state files so a
 *                  later connect can reuse the instance we started.
 *   3. tunnel    — keep the `-L` forward alive on a fixed local port.
 *   4. check     — HTTP the tunnel root; 401/303/200 means the remote DSH is
 *                  reachable, connection refused means it is not.
 *   5. keepalive — periodic health checks; on loss reconnect with backoff.
 *
 * Non-secret host config is persisted to a JSON file under $DSH_HOME. Nothing
 * is installed into the profile patch here; the user's own patch holds rows.
 *
 * The Client half (client.js) renders a sidebar panel that talks to this
 * plugin over same-origin `/dsh-ssh-remote/*` routes.
 */
import { request as httpRequest } from 'node:http'
import { randomBytes } from 'node:crypto'
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'

export const name = 'ssh-remote'
export const inject = ['subprocess', 'webServer']

const ROUTE = '/dsh-ssh-remote'

/** Per-host remote state directory (mirrors dsh-go's ~/.dsh-app-remote). */
const REMOTE_STATE_DIR = '$HOME/.dsh-ssh-remote'
const TAG = 'DSHSSH'

const DEFAULT_REMOTE_PORT = 0
const HEALTH_INTERVAL_MS = 15000
const HEALTH_TIMEOUT_MS = 6000
const BACKOFF_BASE_MS = 1000
const BACKOFF_MAX_MS = 30000

// ── tiny helpers ────────────────────────────────────────────────────────────

const shQuote = (s) => `'` + String(s).replace(/'/g, `'\\''`) + `'`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const now = () => Date.now()

function newHostId() {
  return 'ssh-' + randomBytes(6).toString('hex')
}

/** Parse `user@host:port` / `user@host` / ssh-config alias into parts. */
function parseAddress(raw) {
  const text = String(raw || '').trim()
  let user = ''
  let host = text
  let port = 22
  const at = host.lastIndexOf('@')
  if (at >= 0) {
    user = host.slice(0, at)
    host = host.slice(at + 1)
  }
  const colon = host.lastIndexOf(':')
  if (colon > 0 && /^\d+$/.test(host.slice(colon + 1))) {
    port = parseInt(host.slice(colon + 1), 10)
    host = host.slice(0, colon)
  }
  return { user, host, port }
}

function normalizeHost(input) {
  const id = input.id || newHostId()
  const address = String(input.host || '').trim()
  const { user: addrUser, host, port: addrPort } = parseAddress(address)
  const user = String(input.user || '').trim() || addrUser
  const port = Number.isFinite(+input.port) && +input.port > 0 ? +input.port : addrPort
  return {
    id,
    name: String(input.name || '').trim() || host || 'remote',
    host: host,
    user: user,
    port: port || 22,
    address: user ? `${user}@${host}` : host,
    remotePort: Number.isFinite(+input.remotePort) && +input.remotePort > 0 ? +input.remotePort : 0,
    token: String(input.token || '').trim(),
    createdAt: input.createdAt || now(),
  }
}

/** ssh argv shared by every invocation (tunnel + remote exec). */
function sshBaseArgs(host) {
  const args = [
    '-o', 'BatchMode=yes',
    '-o', 'StrictHostKeyChecking=accept-new',
    '-o', 'ServerAliveInterval=15',
    '-o', 'ServerAliveCountMax=3',
    '-o', 'ExitOnForwardFailure=yes',
    '-o', 'ConnectTimeout=12',
    '-p', String(host.port),
  ]
  return args
}

// ── the service ─────────────────────────────────────────────────────────────

class SshRemoteService {
  constructor(ctx, config) {
    this.ctx = ctx
    this.config = config
    /** @type {Map<string, HostRecord>} id -> live record */
    this.records = new Map()
    /** @type {Array<object>} persisted host configs (no secrets) */
    this.hosts = []
    this.readyPromise = this._init()
  }

  async _init() {
    try {
      this.configPath = await this._configPath()
      await this._load()
    } catch (error) {
      console.error('[dsh-ssh-remote] init failed', error)
      this.hosts = []
    }
  }

  async _configPath() {
    // $DSH_HOME is set in a profile-launched Harness; fall back to ~/.dsh.
    let base = process.env.DSH_HOME
    if (!base) base = join(homedir(), '.dsh')
    const dir = join(base, 'ssh-remote')
    await mkdir(dir, { recursive: true, mode: 0o700 })
    return join(dir, 'hosts.json')
  }

  async _load() {
    try {
      const text = await readFile(this.configPath, 'utf8')
      const parsed = JSON.parse(text)
      this.hosts = Array.isArray(parsed) ? parsed.map(normalizeHost) : []
    } catch (error) {
      if (error && error.code !== 'ENOENT') console.error('[dsh-ssh-remote] load failed', error)
      this.hosts = []
    }
  }

  async _save() {
    const tmp = this.configPath + '.tmp'
    await writeFile(tmp, JSON.stringify(this.hosts, null, 2), { mode: 0o600 })
    await rename(tmp, this.configPath)
  }

  // ── host config CRUD ────────────────────────────────────────────────────

  listHosts() {
    return this.hosts.map((h) => ({ ...h, status: this._statusOf(h.id) }))
  }

  _statusOf(id) {
    const rec = this.records.get(id)
    if (!rec) return { phase: 'idle' }
    return { phase: rec.phase, error: rec.error, url: rec.url, localPort: rec.localPort }
  }

  async saveHost(input) {
    await this.readyPromise
    const host = normalizeHost(input)
    const idx = this.hosts.findIndex((h) => h.id === host.id)
    if (idx >= 0) this.hosts[idx] = host
    else this.hosts.push(host)
    await this._save()
    // A config change invalidates any live connection for this host.
    await this._teardown(host.id)
    return { ...host, status: this._statusOf(host.id) }
  }

  async deleteHost(id) {
    await this.readyPromise
    await this._teardown(id)
    this.hosts = this.hosts.filter((h) => h.id !== id)
    await this._save()
    return { ok: true }
  }

  async getHost(id) {
    await this.readyPromise
    return this.hosts.find((h) => h.id === id) || null
  }

  // ── connect / disconnect ─────────────────────────────────────────────────

  async connect(id) {
    await this.readyPromise
    const host = this.hosts.find((h) => h.id === id)
    if (!host) throw new Error('unknown host: ' + id)
    let rec = this.records.get(id)
    if (rec && (rec.phase === 'connected' || rec.phase === 'connecting' || rec.phase === 'reconnecting')) {
      return this._statusOf(id) // already going
    }
    rec = { id, host, phase: 'connecting', error: null, url: null, localPort: 0, stopped: false, log: [] }
    this.records.set(id, rec)
    this._connectLoop(rec).catch((e) => this._fail(rec, e))
    return this._statusOf(id)
  }

  async disconnect(id) {
    const rec = this.records.get(id)
    if (rec) rec.stopped = true
    await this._teardown(id)
    return this._statusOf(id)
  }

  _fail(rec, error) {
    rec.phase = 'failed'
    rec.error = String(error && error.message ? error.message : error)
    this._log(rec, 'error: ' + rec.error)
    this._emit(rec)
  }

  _setPhase(rec, phase, extra = {}) {
    rec.phase = phase
    Object.assign(rec, extra)
    this._log(rec, 'phase: ' + phase + (extra.error ? ' (' + extra.error + ')' : ''))
    this._emit(rec)
  }

  _log(rec, line) {
    rec.log.push(`${new Date().toISOString()} ${line}`)
    if (rec.log.length > 200) rec.log.shift()
  }

  _emit(rec) {
    try {
      this._broadcast({ type: 'status', id: rec.id, status: this._statusOf(rec.id), log: rec.log.slice(-40) })
    } catch { /* no peers */ }
  }

  async _connectLoop(rec) {
    let attempt = 0
    while (!rec.stopped) {
      try {
        await this._connectOnce(rec)
        // Connected: run keepalive until it reports loss.
        this._setPhase(rec, 'connected', { url: rec.url, localPort: rec.localPort, error: null })
        const alive = await this._keepAlive(rec)
        if (rec.stopped) return
        if (!alive) {
          this._log(rec, 'keepalive lost; reconnecting')
          await this._teardownTransport(rec)
        }
      } catch (error) {
        if (rec.stopped) return
        this._log(rec, 'connect error: ' + (error && error.message ? error.message : error))
        await this._teardownTransport(rec)
      }
      attempt += 1
      const backoff = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.min(attempt - 1, 5))
      this._setPhase(rec, 'reconnecting', { error: rec.error })
      this._log(rec, `retry in ${backoff}ms`)
      await sleep(backoff)
    }
  }

  async _connectOnce(rec) {
    const host = rec.host
    rec.error = null
    this._setPhase(rec, 'connecting')

    // 1. Resolve the remote dsh endpoint (port + token). If not configured,
    //    launch-and-own a remote `dsh web` and read its log.
    let remotePort = host.remotePort
    let token = host.token
    if (!remotePort) {
      this._setPhase(rec, 'probing')
      const endpoint = await this._ensureRemoteDsh(rec)
      remotePort = endpoint.port
      token = endpoint.token || token
    }
    if (!token) throw new Error('no token: set one on the host or leave remote port blank so it can be read from the remote log')

    // 2. Local port for the forwarder (stable across reconnects while the rec lives).
    if (!rec.localPort) rec.localPort = 47000 + Math.floor(Math.random() * 1500)
    const localPort = rec.localPort

    // 3. Open the SSH tunnel: local 127.0.0.1:<localPort> -> 127.0.0.1:<remotePort>.
    this._setPhase(rec, 'tunneling')
    const tunnel = await this._spawnTunnel(rec, localPort, remotePort)
    rec.tunnel = tunnel

    // 4. Health-check through the tunnel.
    this._setPhase(rec, 'checking')
    const check = await this._health(localPort, HEALTH_TIMEOUT_MS)
    if (!check.ok) {
      throw new Error('remote DSH not reachable through tunnel (' + check.reason + ')')
    }
    rec.url = `http://127.0.0.1:${localPort}/?token=${encodeURIComponent(token)}`
    rec.error = null
  }

  async _spawnTunnel(rec, localPort, remotePort) {
    const host = rec.host
    const args = [
      ...sshBaseArgs(host),
      '-N',
      '-L', `127.0.0.1:${localPort}:127.0.0.1:${remotePort}`,
      host.address,
    ]
    this._log(rec, 'spawn: ssh ' + args.join(' '))
    const handle = this.ctx.subprocess.spawn({
      argv: ['ssh', ...args],
      cwd: process.cwd(),
      stdio: { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' },
      graceMs: 3000,
    })
    rec.tunnelExited = false
    if (handle.stdout) handle.stdout.on('data', () => {})
    if (handle.stderr) handle.stderr.on('data', (b) => { this._log(rec, 'tunnel stderr: ' + b.toString().trim().slice(0, 200)) })
    handle.done.then((outcome) => {
      if (!rec.stopped && rec.tunnel === handle) {
        this._log(rec, 'tunnel exited: ' + JSON.stringify(outcome))
        rec.tunnelExited = true
      }
    }).catch(() => {})
    // Give the forward a moment to bind; ExitOnForwardFailure makes a bad bind exit fast.
    await sleep(400)
    if (rec.tunnelExited) throw new Error('ssh tunnel exited immediately (forward bind failed?)')
    return handle
  }

  async _keepAlive(rec) {
    while (!rec.stopped) {
      await sleep(HEALTH_INTERVAL_MS)
      if (rec.stopped) return false
      if (rec.tunnelExited) return false
      const check = await this._health(rec.localPort, HEALTH_TIMEOUT_MS)
      if (!check.ok) return false
    }
    return false
  }

  /** HTTP the tunnel root; connection refused => down, 401/303/200 => alive. */
  _health(port, timeoutMs) {
    return new Promise((resolve) => {
      let done = false
      const finish = (v) => { if (!done) { done = true; resolve(v) } }
      const r = httpRequest(
        { host: '127.0.0.1', port, path: '/', method: 'GET', timeout: timeoutMs },
        (res) => { res.resume(); finish({ ok: true, status: res.statusCode }) },
      )
      r.on('timeout', () => { r.destroy(); finish({ ok: false, reason: 'timeout' }) })
      r.on('error', (e) => finish({ ok: false, reason: e.code || String(e) }))
      r.end()
    })
  }

  // ── remote dsh launch-and-own ────────────────────────────────────────────

  /**
   * Ensure a remote `dsh web` we own is running; return {port, token}.
   * Reuses a previously-owned instance when its pid is alive and command
   * matches; otherwise starts a fresh one and reads the token from its log.
   */
  async _ensureRemoteDsh(rec) {
    const host = rec.host
    const script = this._bootstrapScript()
    this._log(rec, 'remote bootstrap')
    const out = await this._runRemote(host, script, 90000)
    // Parse structured DSHSSH lines.
    const lines = out.split(/\r?\n/)
    let result = null
    const logs = []
    for (const line of lines) {
      if (!line.startsWith(TAG + ' ')) { if (line.trim()) logs.push(line); continue }
      const rest = line.slice(TAG.length + 1)
      const sp = rest.indexOf(' ')
      const kind = sp < 0 ? rest : rest.slice(0, sp)
      const value = sp < 0 ? '' : rest.slice(sp + 1)
      if (kind === 'url') result = value
      else if (kind === 'log') logs.push(value)
      else if (kind === 'nodsh') throw new Error('remote: `dsh` not found on PATH')
      else if (kind === 'exited' || kind === 'timeout') {
        throw new Error('remote dsh web failed to start: ' + logs.slice(-6).join(' | '))
      }
    }
    if (!result) throw new Error('remote dsh web did not print a URL: ' + logs.slice(-6).join(' | '))
    const m = /^https?:\/\/127\.0\.0\.1:(\d+)\/\?token=([A-Za-z0-9_\-]+)/.exec(result.trim())
    if (!m) throw new Error('could not parse remote dsh URL: ' + result)
    return { port: parseInt(m[1], 10), token: m[2] }
  }

  _bootstrapScript() {
    // Runs under POSIX sh (Linux/mac natively; Windows via git-bash + nohup).
    // Reuse detection is HTTP-based on the logged URL rather than a pid liveness
    // check, because the background child's shell pid does not map to a killable
    // process across separate SSH sessions on MINGW/Windows. Output is tagged so
    // login banners can't be mistaken for results.
    const T = TAG
    return [
      'set -u',
      'D="$HOME/.dsh-ssh-remote"',
      'mkdir -p "$D" 2>/dev/null; chmod 700 "$D" 2>/dev/null',
      // Non-interactive, non-login `sh` (what `ssh host "sh -s"` gives us) does
      // NOT source ~/.profile or ~/.bashrc, so a `dsh` installed under a
      // user-level bin dir (e.g. `~/.local/bin/dsh`, the standard
      // `npm i -g --prefix ~/.local` / pipx-style location) is invisible to
      // `command -v dsh`. Prepend the usual user bin dirs so launch-and-own
      // works without the user having to wire PATH into a non-login shell.
      'for d in "$HOME/.local/bin" "$HOME/.opencode/bin" "$HOME/.cargo/bin" "$HOME/.deno/bin" "$HOME/bin"; do [ -d "$d" ] && PATH="$d:$PATH"; done; export PATH',
      'same_cmd() { [ "$(cat "$D/web.cmd" 2>/dev/null)" = "dsh web" ]; }',
      'emit_url() { grep -aoE "https?://[^ ]*\\?token=[A-Za-z0-9_-]+" "$D/web.log" 2>/dev/null | tail -n 1; }',
      'reachable() { u=$(emit_url); [ -n "$u" ] || return 1; c=$(curl -s -o /dev/null -w "%{http_code}" --max-time 4 "$u" 2>/dev/null); [ "$c" = "401" ] || [ "$c" = "200" ] || [ "$c" = "303" ]; }',
      'if same_cmd && reachable; then',
      '  emit_url | sed "s/^/' + T + ' url /"; exit 0',
      'fi',
      '# Not reusable: best-effort stop of the old instance, then start fresh.',
      'if same_cmd; then P=$(cat "$D/web.pid" 2>/dev/null || true); [ -n "${P:-}" ] && { kill "$P" 2>/dev/null; sleep 1; kill -9 "$P" 2>/dev/null; }; fi',
      'rm -f "$D/web.pid"',
      'if ! command -v dsh >/dev/null 2>&1; then printf "' + T + ' nodsh\\n"; exit 127; fi',
      'printf "%s" "dsh web" > "$D/web.cmd"',
      ': > "$D/web.log"',
      'NO_COLOR=1; export NO_COLOR',
      'N=""; if command -v nohup >/dev/null 2>&1; then N=nohup; fi',
      '( $N dsh web --host 127.0.0.1 --port 0 --no-open </dev/null >>"$D/web.log" 2>&1 & )',
      'i=0',
      'while [ $i -lt 60 ]; do',
      '  L=$(emit_url)',
      '  if [ -n "$L" ]; then printf "' + T + ' url %s\\n" "$L"; exit 0; fi',
      '  sleep 1; i=$((i+1))',
      'done',
      'tail -n 20 "$D/web.log" 2>/dev/null | sed "s/^/' + T + ' log /"',
      'printf "' + T + ' timeout\\n"; exit 1',
    ].join('\n')
  }

  /** Run one POSIX script on the remote, tearing down the process on timeout. */
  _runRemote(host, script, timeoutMs) {
    const args = [...sshBaseArgs(host), host.address, 'sh -s']
    return new Promise((resolve, reject) => {
      let settled = false
      const handle = this.ctx.subprocess.spawn({
        argv: ['ssh', ...args],
        cwd: process.cwd(),
        stdio: {
          stdin: { data: script },
          stdout: 'pipe',
          stderr: 'pipe',
        },
        graceMs: 3000,
      })
      // Collect incrementally so we can resolve the instant the tagged URL line
      // arrives: on MINGW the backgrounded `dsh web` keeps the ssh stdout pipe
      // open, so waiting for process exit would stall until timeout.
      let stdout = ''
      let stderr = ''
      const finish = (fn, value) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        try { handle.terminate() } catch { /* ignore */ }
        fn(value)
      }
      if (handle.stdout) handle.stdout.on('data', (b) => {
        stdout += b.toString()
        if (/DSHSSH url /.test(stdout)) finish(resolve, stdout)
      })
      if (handle.stderr) handle.stderr.on('data', (b) => { stderr += b.toString() })
      const timer = setTimeout(() => {
        finish(reject, new Error('remote command timed out after ' + timeoutMs + 'ms'))
      }, timeoutMs)
      handle.done.then((outcome) => {
        if (settled) return
        if (outcome.exitCode !== 0 && !stdout.includes(TAG + ' url')) {
          finish(reject, new Error(`remote exited ${outcome.exitCode}: ${(stderr || stdout).trim().slice(-500)}`))
        } else {
          finish(resolve, stdout || stderr)
        }
      }).catch((e) => finish(reject, e))
    })
  }

  async _teardownTransport(rec) {
    if (rec.tunnel) {
      try { rec.tunnel.terminate() } catch { /* ignore */ }
      rec.tunnel = null
    }
    rec.tunnelExited = false
    rec.url = null
  }

  async _teardown(id) {
    const rec = this.records.get(id)
    if (!rec) return
    rec.stopped = true
    await this._teardownTransport(rec)
    this.records.delete(id)
  }

  async dispose() {
    for (const id of [...this.records.keys()]) await this._teardown(id)
  }

  // ── client event fan-out (SSE) ────────────────────────────────────────────

  _clients = new Set()

  _broadcast(message) {
    const data = `data: ${JSON.stringify(message)}\n\n`
    for (const res of this._clients) {
      try { res.write(data) } catch { /* ignore */ }
    }
  }
}

// ── plugin apply ─────────────────────────────────────────────────────────────

export function apply(ctx, config) {
  const service = new SshRemoteService(ctx, config)
  ctx.effect(() => () => service.dispose(), 'ssh-remote: dispose connections')

  // JSON body reader.
  const readJson = (req) =>
    new Promise((resolve, reject) => {
      const chunks = []
      let size = 0
      req.on('data', (c) => {
        size += c.length
        if (size > 1024 * 1024) { reject(new Error('body too large')); req.destroy() }
        else chunks.push(c)
      })
      req.on('end', () => {
        if (!chunks.length) return resolve({})
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) }
        catch (e) { reject(new Error('invalid JSON body')) }
      })
      req.on('error', reject)
    })

  const sendJson = (res, status, value) => {
    const body = Buffer.from(JSON.stringify(value))
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': body.length })
    res.end(body)
  }

  ctx.effect(() => {
    return ctx.webServer.register({
      kind: 'prefix',
      path: ROUTE,
      handler: async (req, res) => {
        try {
          if (req.method === 'GET' && req.url === ROUTE + '/hosts') {
            return sendJson(res, 200, { hosts: service.listHosts() })
          }
          if (req.method === 'GET' && req.url === ROUTE + '/events') {
            res.writeHead(200, {
              'content-type': 'text/event-stream',
              'cache-control': 'no-cache',
              connection: 'keep-alive',
            })
            res.write(`data: ${JSON.stringify({ type: 'hello' })}\n\n`)
            service._clients.add(res)
            const ping = setInterval(() => { try { res.write(': ping\n\n') } catch { /* ignore */ } }, 15000)
            req.on('close', () => { clearInterval(ping); service._clients.delete(res) })
            return
          }
          const rest = req.url.slice(ROUTE.length) // e.g. /hosts/<id>/connect
          const parts = rest.split('/').filter(Boolean)

          if (req.method === 'POST' && parts[0] === 'hosts' && parts.length === 1) {
            const body = await readJson(req)
            return sendJson(res, 200, { host: await service.saveHost(body) })
          }
          if (parts[0] === 'hosts' && parts.length === 2 && req.method === 'DELETE') {
            return sendJson(res, 200, await service.deleteHost(parts[1]))
          }
          if (req.method === 'POST' && parts[0] === 'hosts' && parts.length === 3) {
            const id = parts[1]
            if (parts[2] === 'connect') return sendJson(res, 200, { status: await service.connect(id) })
            if (parts[2] === 'disconnect') return sendJson(res, 200, { status: await service.disconnect(id) })
          }
          return sendJson(res, 404, { error: 'not found' })
        } catch (error) {
          return sendJson(res, 500, { error: String(error && error.message ? error.message : error) })
        }
      },
    })
  }, 'ssh-remote: HTTP routes')

  ctx.logger?.info?.('dsh-ssh-remote ready at ' + ROUTE)
}
