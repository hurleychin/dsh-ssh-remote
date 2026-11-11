window.__ModuleLoader__.load({
  id: '@hurleychin/dsh-ssh-remote',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useRef, useCallback } = React

    const NS = 'dsh-ssh-remote'
    const ROUTE = '/dsh-ssh-remote'
    const PANEL_ID = 'ssh-remote'

    const DICT = {
      en: {
        panel: 'Remote hosts',
        heading: 'SSH remote hosts',
        subheading: 'Connect to a DeepSeek Harness running on another machine over SSH.',
        empty: 'No hosts yet. Add one to get started.',
        add: 'Add host', save: 'Save', cancel: 'Cancel', delete: 'Delete',
        connect: 'Connect', reconnect: 'Reconnect', disconnect: 'Disconnect',
        open: 'Open remote Harness', copyUrl: 'Copy URL', copied: 'Copied',
        name: 'Name', namePlaceholder: 'Home PC',
        host: 'Host', hostPlaceholder: 'user@example.com or an ~/.ssh/config alias',
        port: 'SSH port', remotePort: 'Remote dsh port',
        remotePortHint: 'Leave blank to launch and detect automatically.',
        remoteStateDir: 'Remote state dir',
        remoteStateDirPlaceholder: '~/.dsh-ssh-remote',
        remoteStateDirHint: 'Leave blank to use ~/.dsh-ssh-remote; holds web.cmd/web.pid/web.log for reusing a launched instance.',
        token: 'Remote token', tokenHint: 'Leave blank to read it from the remote log.',
        status_idle: 'Not connected', status_connecting: 'Connecting…',
        status_probing: 'Launching remote dsh web…', status_tunneling: 'Opening tunnel…',
        status_checking: 'Checking remote Harness…', status_connected: 'Connected',
        status_reconnecting: 'Reconnecting…', status_failed: 'Failed',
        error: 'Error', retry: 'Retry', confirmDelete: 'Delete this host?',
        configTitle: 'Host', logTitle: 'Connection log',
      },
      zh: {
        panel: '远程主机',
        heading: 'SSH 远程主机',
        subheading: '通过 SSH 连接到另一台机器上运行的 DeepSeek Harness。',
        empty: '还没有主机。添加一个开始吧。',
        add: '添加主机', save: '保存', cancel: '取消', delete: '删除',
        connect: '连接', reconnect: '重连', disconnect: '断开',
        open: '打开远端 Harness', copyUrl: '复制链接', copied: '已复制',
        name: '名称', namePlaceholder: '家里的电脑',
        host: '主机', hostPlaceholder: 'user@example.com 或 ~/.ssh/config 别名',
        port: 'SSH 端口', remotePort: '远端 dsh 端口',
        remotePortHint: '留空则自动启动并探测。',
        remoteStateDir: '远端状态目录',
        remoteStateDirPlaceholder: '~/.dsh-ssh-remote',
        remoteStateDirHint: '留空则用 ~/.dsh-ssh-remote；存 web.cmd/web.pid/web.log，用于复用已启动实例。',
        token: '远端 token', tokenHint: '留空则从远端日志读取。',
        status_idle: '未连接', status_connecting: '连接中…',
        status_probing: '正在启动远端 dsh web…', status_tunneling: '正在建立隧道…',
        status_checking: '正在检查远端 Harness…', status_connected: '已连接',
        status_reconnecting: '重连中…', status_failed: '失败',
        error: '错误', retry: '重试', confirmDelete: '删除这台主机？',
        configTitle: '主机', logTitle: '连接日志',
      },
    }

    // ── host RPC over same-origin HTTP ─────────────────────────────────────
    async function api(method, path, body) {
      const res = await fetch(ROUTE + path, {
        method,
        headers: body ? { 'content-type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data && data.error ? data.error : 'request failed: ' + res.status)
      return data
    }

    const STATUS_KEY = {
      idle: 'status_idle', connecting: 'status_connecting', probing: 'status_probing',
      tunneling: 'status_tunneling', checking: 'status_checking', connected: 'status_connected',
      reconnecting: 'status_reconnecting', failed: 'status_failed',
    }

    function badgeColor(phase) {
      if (phase === 'connected') return 'var(--dsw-alias-success, #2ea043)'
      if (phase === 'failed') return 'var(--dsw-alias-danger, #d1242f)'
      if (phase && phase !== 'idle') return 'var(--dsw-alias-warning, #bf8700)'
      return 'var(--dsw-alias-border-l1, #666)'
    }

    // ── shared styling ──────────────────────────────────────────────────────
    const CSS = `
      .dshsr-root { padding: 20px 24px; height: 100%; overflow: auto; box-sizing: border-box;
        color: var(--dsw-alias-text-1, inherit); font-size: 14px; }
      .dshsr-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 4px; }
      .dshsr-title { font-size: 18px; font-weight: 600; margin: 0; }
      .dshsr-sub { color: var(--dsw-alias-text-2, inherit); opacity: .75; margin: 0 0 16px; }
      .dshsr-btn { border: 1px solid var(--dsw-alias-border-l1, #555); background: var(--dsw-alias-bg-2, transparent);
        color: inherit; border-radius: 8px; padding: 6px 12px; font-size: 13px; cursor: pointer; }
      .dshsr-btn:hover { background: var(--dsw-alias-bg-3, rgba(128,128,128,.12)); }
      .dshsr-btn.primary { background: var(--dsw-alias-accent, #247bbf); border-color: transparent; color: #fff; }
      .dshsr-btn.danger { color: var(--dsw-alias-danger, #d1242f); }
      .dshsr-btn:disabled { opacity: .5; cursor: default; }
      .dshsr-card { border: 1px solid var(--dsw-alias-border-l1, #444); border-radius: 12px; padding: 14px 16px;
        margin-bottom: 12px; background: var(--dsw-alias-bg-1, transparent); }
      .dshsr-row { display: flex; align-items: center; gap: 10px; }
      .dshsr-name { font-weight: 600; }
      .dshsr-addr { color: var(--dsw-alias-text-2, inherit); opacity: .75; font-size: 12px; font-family: monospace; }
      .dshsr-dot { width: 9px; height: 9px; border-radius: 50%; flex: none; }
      .dshsr-status { font-size: 12px; margin-left: 4px; }
      .dshsr-spacer { flex: 1; }
      .dshsr-actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; }
      .dshsr-empty { color: var(--dsw-alias-text-2, inherit); opacity: .7; padding: 40px 0; text-align: center; }
      .dshsr-form { display: grid; grid-template-columns: 140px 1fr; gap: 10px 14px; align-items: center; }
      .dshsr-form label { font-size: 13px; color: var(--dsw-alias-text-2, inherit); }
      .dshsr-form input { width: 100%; box-sizing: border-box; padding: 7px 9px; border-radius: 8px;
        border: 1px solid var(--dsw-alias-border-l1, #555); background: var(--dsw-alias-bg-2, transparent);
        color: inherit; font-size: 13px; }
      .dshsr-hint { grid-column: 2; font-size: 12px; opacity: .6; margin-top: -4px; }
      .dshsr-err { color: var(--dsw-alias-danger, #d1242f); font-size: 12px; margin-top: 8px; word-break: break-word; }
      .dshsr-log { font-family: monospace; font-size: 11px; white-space: pre-wrap; word-break: break-word;
        max-height: 160px; overflow: auto; background: var(--dsw-alias-bg-2, rgba(0,0,0,.15));
        border-radius: 8px; padding: 8px; margin-top: 8px; opacity: .85; }
      .dshsr-url { display: flex; gap: 8px; align-items: center; margin-top: 8px; }
      .dshsr-url code { flex: 1; font-size: 11px; overflow: auto; white-space: nowrap; padding: 6px 8px;
        background: var(--dsw-alias-bg-2, rgba(0,0,0,.15)); border-radius: 6px; }
      a.dshsr-link { color: var(--dsw-alias-accent, #247bbf); text-decoration: none; font-weight: 600; }
    `

    // ── host form ────────────────────────────────────────────────────────────
    function HostForm({ t, initial, onCancel, onSave, busy }) {
      const [name, setName] = useState(initial?.name || '')
      const [host, setHost] = useState(initial?.host ? (initial.user ? initial.user + '@' + initial.host : initial.host) : '')
      const [port, setPort] = useState(initial?.port ? String(initial.port) : '22')
      const [remotePort, setRemotePort] = useState(initial?.remotePort ? String(initial.remotePort) : '')
      const [remoteStateDir, setRemoteStateDir] = useState(initial?.remoteStateDir && initial.remoteStateDir !== '$HOME/.dsh-ssh-remote' ? initial.remoteStateDir : '')
      const [token, setToken] = useState(initial?.token || '')
      return h('div', { className: 'dshsr-card' },
        h('div', { className: 'dshsr-form' },
          h('label', null, t('name')),
          h('input', { value: name, placeholder: t('namePlaceholder'), onChange: (e) => setName(e.target.value) }),
          h('label', null, t('host')),
          h('input', { value: host, placeholder: t('hostPlaceholder'), onChange: (e) => setHost(e.target.value) }),
          h('label', null, t('port')),
          h('input', { value: port, inputMode: 'numeric', onChange: (e) => setPort(e.target.value) }),
          h('label', null, t('remotePort')),
          h('input', { value: remotePort, inputMode: 'numeric', onChange: (e) => setRemotePort(e.target.value) }),
          h('div', { className: 'dshsr-hint' }, t('remotePortHint')),
          h('label', null, t('remoteStateDir')),
          h('input', { value: remoteStateDir, placeholder: t('remoteStateDirPlaceholder'), onChange: (e) => setRemoteStateDir(e.target.value) }),
          h('div', { className: 'dshsr-hint' }, t('remoteStateDirHint')),
          h('label', null, t('token')),
          h('input', { value: token, onChange: (e) => setToken(e.target.value) }),
          h('div', { className: 'dshsr-hint' }, t('tokenHint')),
        ),
        h('div', { className: 'dshsr-actions' },
          h('button', {
            className: 'dshsr-btn primary', disabled: busy || !host.trim(),
            onClick: () => onSave({ id: initial?.id, name, host, port, remotePort, remoteStateDir, token }),
          }, t('save')),
          h('button', { className: 'dshsr-btn', disabled: busy, onClick: onCancel }, t('cancel')),
        ),
      )
    }

    // ── host card ────────────────────────────────────────────────────────────
    function HostCard({ t, host, onConnect, onDisconnect, onDelete, onEdit, copy }) {
      const status = host.status || { phase: 'idle' }
      const phase = status.phase
      const busy = phase === 'connecting' || phase === 'probing' || phase === 'tunneling' ||
        phase === 'checking' || phase === 'reconnecting'
      return h('div', { className: 'dshsr-card' },
        h('div', { className: 'dshsr-row' },
          h('span', { className: 'dshsr-dot', style: { background: badgeColor(phase) } }),
          h('span', { className: 'dshsr-name' }, host.name),
          h('span', { className: 'dshsr-addr' }, host.address + (host.remotePort ? ' · remote:' + host.remotePort : '')),
          h('span', { className: 'dshsr-spacer' }),
          h('span', { className: 'dshsr-status' }, t(STATUS_KEY[phase] || 'status_idle')),
        ),
        phase === 'connected' && status.url
          ? h('div', { className: 'dshsr-url' },
              h('code', null, status.url),
              h('button', { className: 'dshsr-btn primary', onClick: () => window.open(status.url, '_blank', 'noopener') }, t('open')),
              h('button', { className: 'dshsr-btn', onClick: () => copy(status.url) }, t('copyUrl')),
            )
          : null,
        status.error
          ? h('div', { className: 'dshsr-err' }, t('error') + ': ' + status.error)
          : null,
        h('div', { className: 'dshsr-actions' },
          phase === 'connected'
            ? h('button', { className: 'dshsr-btn', onClick: () => onDisconnect(host.id) }, t('disconnect'))
            : h('button', {
                className: 'dshsr-btn primary', disabled: busy,
                onClick: () => onConnect(host.id),
              }, phase === 'failed' || phase === 'reconnecting' ? t('retry') : t('connect')),
          h('button', { className: 'dshsr-btn', onClick: () => onEdit(host) }, t('configTitle')),
          h('button', { className: 'dshsr-btn danger', onClick: () => onDelete(host) }, t('delete')),
        ),
      )
    }

    // ── panel ────────────────────────────────────────────────────────────────
    function Panel({ t }) {
      const [hosts, setHosts] = useState([])
      const [editing, setEditing] = useState(null) // { ...host } | 'new' | null
      const [log, setLog] = useState([])
      const [busy, setBusy] = useState(false)
      const [copied, setCopied] = useState(false)
      const esRef = useRef(null)

      const refresh = useCallback(async () => {
        try {
          const data = await api('GET', '/hosts')
          setHosts(data.hosts || [])
        } catch (e) { /* ignore transient */ }
      }, [])

      useEffect(() => {
        refresh()
        const es = new EventSource(ROUTE + '/events')
        esRef.current = es
        es.onmessage = (ev) => {
          try {
            const msg = JSON.parse(ev.data)
            if (msg.type === 'status') {
              setHosts((prev) => prev.map((x) => x.id === msg.id ? { ...x, status: msg.status } : x))
              if (msg.log) setLog(msg.log)
            }
          } catch (e) { /* ignore */ }
        }
        es.onerror = () => { /* browser auto-reconnects */ }
        return () => { es.close(); esRef.current = null }
      }, [refresh])

      const copy = (url) => {
        try {
          navigator.clipboard.writeText(url)
          setCopied(true); setTimeout(() => setCopied(false), 1500)
        } catch (e) { /* ignore */ }
      }

      const save = async (value) => {
        setBusy(true)
        try { await api('POST', '/hosts', value); setEditing(null); await refresh() }
        catch (e) { console.error(e) }
        finally { setBusy(false) }
      }

      const connect = async (id) => {
        setLog([])
        try { await api('POST', '/hosts/' + id + '/connect'); await refresh() }
        catch (e) { console.error(e) }
      }
      const disconnect = async (id) => {
        try { await api('POST', '/hosts/' + id + '/disconnect'); await refresh() }
        catch (e) { console.error(e) }
      }
      const remove = async (host) => {
        if (!window.confirm(t('confirmDelete'))) return
        try { await api('DELETE', '/hosts/' + host.id); await refresh() }
        catch (e) { console.error(e) }
      }

      return h('div', { className: 'dshsr-root' },
        h('style', null, CSS),
        h('div', { className: 'dshsr-head' },
          h('h2', { className: 'dshsr-title' }, t('heading')),
          h('button', {
            className: 'dshsr-btn primary',
            disabled: editing !== null,
            onClick: () => setEditing('new'),
          }, '+ ' + t('add')),
        ),
        h('p', { className: 'dshsr-sub' }, t('subheading')),
        editing === 'new'
          ? h(HostForm, { t, initial: null, busy, onCancel: () => setEditing(null), onSave: save })
          : null,
        editing && editing !== 'new'
          ? h(HostForm, { t, initial: editing, busy, onCancel: () => setEditing(null), onSave: save })
          : null,
        hosts.length === 0 && editing === null
          ? h('div', { className: 'dshsr-empty' }, t('empty'))
          : null,
        hosts.map((host) =>
          editing && editing !== 'new' && editing.id === host.id
            ? null
            : h(HostCard, {
                key: host.id, t, host, copy,
                onConnect: connect, onDisconnect: disconnect,
                onDelete: remove, onEdit: (hh) => setEditing(hh),
              }),
        ),
        log.length
          ? h('div', null,
              h('div', { className: 'dshsr-sub', style: { marginTop: 16, marginBottom: 0 } }, t('logTitle')),
              h('div', { className: 'dshsr-log' }, log.join('\n')),
            )
          : null,
      )
    }

    function PanelIcon({ active, size }) {
      const s = size || 20
      return h('svg', {
        viewBox: '0 0 64 64', width: s, height: s, fill: 'none',
        'aria-hidden': true,
        style: { display: 'block', color: active ? 'var(--dsw-alias-accent, #247bbf)' : 'currentColor' },
      },
        h('rect', { x: 6, y: 12, width: 52, height: 34, rx: 4, stroke: 'currentColor', strokeWidth: 3 }),
        h('path', { d: 'M6 20h52', stroke: 'currentColor', strokeWidth: 3 }),
        h('path', { d: 'M18 30l6 6-6 6', stroke: 'currentColor', strokeWidth: 3, strokeLinecap: 'round', strokeLinejoin: 'round' }),
        h('path', { d: 'M30 42h12', stroke: 'currentColor', strokeWidth: 3, strokeLinecap: 'round' }),
      )
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, DICT), 'ssh-remote: dictionaries')
        const t = ctx.locale.bind(NS)

        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main', key: PANEL_ID, locale: NS,
        }, () => h(Panel, { t })))

        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist', id: PANEL_ID, order: 20, locale: NS, label: () => t('panel'),
        }, PanelIcon))
      },
    }
  },
})
