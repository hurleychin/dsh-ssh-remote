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
        add: 'Add host', addTitle: 'Add host', editTitle: 'Edit host',
        save: 'Save', cancel: 'Cancel', delete: 'Delete', confirmDelete: 'Confirm delete',
        deleteWarn: 'Delete this host and its connection?',
        connect: 'Connect', reconnect: 'Reconnect', disconnect: 'Disconnect',
        open: 'Open remote Harness', copyUrl: 'Copy URL', copied: 'Copied',
        name: 'Name', namePlaceholder: 'Home PC',
        host: 'Host', hostPlaceholder: 'user@example.com or an ~/.ssh/config alias',
        port: 'SSH port', portPlaceholder: '22',
        remoteStateDir: 'Remote state dir',
        remoteStateDirPlaceholder: '~/.dsh-app-remote',
        remoteStateDirHint: 'Leave blank to use ~/.dsh-app-remote (shared with dsh-go); holds web.cmd/web.pid/web.st/web.log so both implementations reuse one dsh web.',
        settings: 'Settings',
        status_idle: 'Not connected', status_connecting: 'Connecting…',
        status_probing: 'Launching remote dsh web…', status_tunneling: 'Opening tunnel…',
        status_checking: 'Checking remote Harness…', status_connected: 'Connected',
        status_reconnecting: 'Reconnecting…', status_failed: 'Failed',
        online: 'Online', offline: 'Offline', probing: 'Checking…', saveFailed: 'Save failed',
        error: 'Error', retry: 'Retry',
        configTitle: 'Host', logTitle: 'Connection log',
      },
      zh: {
        panel: '远程主机',
        heading: 'SSH 远程主机',
        subheading: '通过 SSH 连接到另一台机器上运行的 DeepSeek Harness。',
        empty: '还没有主机。添加一个开始吧。',
        add: '添加主机', addTitle: '添加主机', editTitle: '修改主机',
        save: '保存', cancel: '取消', delete: '删除', confirmDelete: '确认删除',
        deleteWarn: '删除这台主机及其连接？',
        connect: '连接', reconnect: '重连', disconnect: '断开',
        open: '打开远端 Harness', copyUrl: '复制链接', copied: '已复制',
        name: '名称', namePlaceholder: '家里的电脑',
        host: '主机', hostPlaceholder: 'user@example.com 或 ~/.ssh/config 别名',
        port: 'SSH 端口', portPlaceholder: '22',
        remoteStateDir: '远端状态目录',
        remoteStateDirPlaceholder: '~/.dsh-app-remote',
        remoteStateDirHint: '留空则用 ~/.dsh-app-remote（与 dsh-go 共用）；存 web.cmd/web.pid/web.st/web.log，让两套实现复用同一个 dsh web。',
        settings: '设置',
        status_idle: '未连接', status_connecting: '连接中…',
        status_probing: '正在启动远端 dsh web…', status_tunneling: '正在建立隧道…',
        status_checking: '正在检查远端 Harness…', status_connected: '已连接',
        status_reconnecting: '重连中…', status_failed: '失败',
        online: '在线', offline: '离线', probing: '探测中…', saveFailed: '保存失败',
        error: '错误', retry: '重试',
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

    // Online indicator: green=online, red=offline, yellow=probing/unknown.
    function onlineColor(state) {
      if (state === 'online') return 'var(--dsw-alias-success, #2ea043)'
      if (state === 'offline') return 'var(--dsw-alias-danger, #d1242f)'
      return 'var(--dsw-alias-warning, #bf8700)' // probing / unknown
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
      .dshsr-card { border: 1px solid var(--dsw-alias-border-l1, #444); border-radius: 12px; padding: 12px 14px;
        margin-bottom: 10px; background: var(--dsw-alias-bg-1, transparent); }
      .dshsr-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
      .dshsr-name { font-weight: 600; }
      .dshsr-addr { color: var(--dsw-alias-text-2, inherit); opacity: .8; font-size: 12px;
        font-family: monospace; cursor: pointer; border-bottom: 1px dotted transparent; }
      .dshsr-addr:hover { border-bottom-color: currentColor; }
      .dshsr-dot { width: 9px; height: 9px; border-radius: 50%; flex: none; }
      .dshsr-status { font-size: 12px; margin-left: auto; opacity: .9; white-space: nowrap; }
      .dshsr-spacer { flex: 1; }
      .dshsr-actions { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
      .dshsr-iconbtn { border: 1px solid var(--dsw-alias-border-l1, #555); background: var(--dsw-alias-bg-2, transparent);
        color: inherit; border-radius: 8px; width: 30px; height: 30px; padding: 0; cursor: pointer;
        display: inline-flex; align-items: center; justify-content: center; flex: none; }
      .dshsr-iconbtn:hover { background: var(--dsw-alias-bg-3, rgba(128,128,128,.12)); }
      .dshsr-empty { color: var(--dsw-alias-text-2, inherit); opacity: .7; padding: 40px 0; text-align: center; }
      .dshsr-form { display: grid; grid-template-columns: 120px 1fr; gap: 12px 14px; align-items: center; }
      .dshsr-form label { font-size: 13px; color: var(--dsw-alias-text-2, inherit); }
      .dshsr-form input { width: 100%; box-sizing: border-box; padding: 7px 9px; border-radius: 8px;
        border: 1px solid var(--dsw-alias-border-l1, #555); background: var(--dsw-alias-bg-2, transparent);
        color: inherit; font-size: 13px; }
      .dshsr-hostrow { display: flex; gap: 8px; }
      .dshsr-hostrow input.dshsr-hostinput { flex: 1; min-width: 0; }
      .dshsr-hostrow input.dshsr-portinput { width: 64px; flex: none; text-align: center; }
      .dshsr-hint { grid-column: 2; font-size: 12px; opacity: .6; margin-top: -6px; }
      .dshsr-err { color: var(--dsw-alias-danger, #d1242f); font-size: 12px; margin-top: 8px; word-break: break-word; }
      .dshsr-log { font-family: monospace; font-size: 11px; white-space: pre-wrap; word-break: break-word;
        max-height: 160px; overflow: auto; background: var(--dsw-alias-bg-2, rgba(0,0,0,.15));
        border-radius: 8px; padding: 8px; margin-top: 8px; opacity: .85; }
      .dshsr-url { display: flex; gap: 8px; align-items: center; margin-top: 8px; }
      .dshsr-url code { flex: 1; font-size: 11px; overflow: auto; white-space: nowrap; padding: 6px 8px;
        background: var(--dsw-alias-bg-2, rgba(0,0,0,.15)); border-radius: 6px; }
      a.dshsr-link { color: var(--dsw-alias-accent, #247bbf); text-decoration: none; font-weight: 600; }
      /* modal */
      .dshsr-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.45); display: flex;
        align-items: center; justify-content: center; z-index: 1000; padding: 20px; }
      .dshsr-modal { width: 100%; max-width: 460px; background: var(--dsw-alias-bg-0, #1e1e1e);
        border: 1px solid var(--dsw-alias-border-l1, #444); border-radius: 14px; padding: 18px 20px;
        box-shadow: 0 12px 40px rgba(0,0,0,.5); max-height: 85vh; overflow: auto;
        color: var(--dsw-alias-text-1, inherit); }
      .dshsr-modal-title { font-size: 16px; font-weight: 600; margin: 0 0 16px; }
      .dshsr-modal-actions { display: flex; gap: 8px; align-items: center; margin-top: 18px; }
      .dshsr-modal-actions .dshsr-spacer { flex: 1; }
    `

    // ── form fields (fully controlled by the modal, which owns the state) ─────
    function HostFormBody({ t, value, setValue }) {
      const set = (k) => (e) => setValue((v) => ({ ...v, [k]: e.target.value }))
      return h('div', { className: 'dshsr-form' },
        h('label', null, t('name')),
        h('input', { value: value.name, placeholder: t('namePlaceholder'), autoFocus: true, onChange: set('name') }),
        h('label', null, t('host')),
        h('div', { className: 'dshsr-hostrow' },
          h('input', { className: 'dshsr-hostinput', value: value.host, placeholder: t('hostPlaceholder'), onChange: set('host') }),
          h('input', { className: 'dshsr-portinput', value: value.port, inputMode: 'numeric', placeholder: t('portPlaceholder'), onChange: set('port') }),
        ),
        h('label', null, t('remoteStateDir')),
        h('input', { value: value.remoteStateDir, placeholder: t('remoteStateDirPlaceholder'), onChange: set('remoteStateDir') }),
        h('div', { className: 'dshsr-hint' }, t('remoteStateDirHint')),
      )
    }

    // ── modal (shared by add + settings) ─────────────────────────────────────
    function HostModal({ t, initial, busy, error, onClose, onSave, onDelete }) {
      const isEdit = !!(initial && initial.id)
      const [confirmDel, setConfirmDel] = useState(false)
      const [value, setValue] = useState({
        name: initial?.name || '',
        host: initial?.host ? (initial.user ? initial.user + '@' + initial.host : initial.host) : '',
        port: initial?.port ? String(initial.port) : '22',
        remoteStateDir: initial?.remoteStateDir && initial.remoteStateDir !== '$HOME/.dsh-app-remote' ? initial.remoteStateDir : '',
      })
      useEffect(() => {
        const onKey = (e) => { if (e.key === 'Escape' && !busy) onClose() }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [busy, onClose])
      const save = () => onSave({ id: initial?.id, ...value })
      const canSave = !busy && String(value.host || '').trim().length > 0
      return h('div', { className: 'dshsr-overlay', onClick: () => { if (!busy) onClose() } },
        h('div', { className: 'dshsr-modal', onClick: (e) => e.stopPropagation() },
          h('div', { className: 'dshsr-modal-title' }, isEdit ? t('editTitle') : t('addTitle')),
          h(HostFormBody, { t, value, setValue }),
          error ? h('div', { className: 'dshsr-err' }, t('error') + ': ' + error) : null,
          h('div', { className: 'dshsr-modal-actions' },
            isEdit
              ? (confirmDel
                  ? h('button', { className: 'dshsr-btn danger', disabled: busy, onClick: () => onDelete(initial.id) }, t('confirmDelete'))
                  : h('button', { className: 'dshsr-btn danger', disabled: busy, onClick: () => setConfirmDel(true) }, t('delete')))
              : null,
            confirmDel ? h('span', { className: 'dshsr-status', style: { marginLeft: 0 } }, t('deleteWarn')) : null,
            h('div', { className: 'dshsr-spacer' }),
            confirmDel
              ? h('button', { className: 'dshsr-btn', disabled: busy, onClick: () => setConfirmDel(false) }, t('cancel'))
              : h('button', { className: 'dshsr-btn', disabled: busy, onClick: onClose }, t('cancel')),
            h('button', { className: 'dshsr-btn primary', disabled: !canSave, onClick: save }, t('save')),
          ),
        ),
      )
    }

    // ── host card (single row) ───────────────────────────────────────────────
    function GearIcon() {
      return h('svg', { viewBox: '0 0 24 24', width: 16, height: 16, fill: 'none', 'aria-hidden': true },
        h('circle', { cx: 12, cy: 12, r: 3.2, stroke: 'currentColor', strokeWidth: 1.8 }),
        h('path', {
          d: 'M19.4 13a7.4 7.4 0 0 0 0-2l1.9-1.4-1.9-3.3-2.3.9a7.2 7.2 0 0 0-1.7-1L15 3.5h-3.9l-.4 2.6a7.2 7.2 0 0 0-1.7 1l-2.3-.9L4.8 9.6 6.6 11a7.4 7.4 0 0 0 0 2l-1.8 1.4 1.9 3.3 2.3-.9a7.2 7.2 0 0 0 1.7 1l.4 2.6H15l.4-2.6a7.2 7.2 0 0 0 1.7-1l2.3.9 1.9-3.3z',
          stroke: 'currentColor', strokeWidth: 1.5, strokeLinejoin: 'round',
        }),
      )
    }

    function HostCard({ t, host, online, onConnect, onDisconnect, onEdit, copy }) {
      const status = host.status || { phase: 'idle' }
      const phase = status.phase
      const busy = phase === 'connecting' || phase === 'probing' || phase === 'tunneling' ||
        phase === 'checking' || phase === 'reconnecting'
      // Online state: connected forces green (connection proves reachability);
      // otherwise use the last probe result; unknown/probing -> yellow.
      let onlineState = online // 'online' | 'offline' | undefined (probing/unknown)
      if (phase === 'connected') onlineState = 'online'
      const onlineTitle = onlineState === 'online' ? t('online')
        : onlineState === 'offline' ? t('offline') : t('probing')
      const connected = phase === 'connected' && status.url
      return h('div', { className: 'dshsr-card' },
        h('div', { className: 'dshsr-row' },
          h('span', { className: 'dshsr-dot', style: { background: onlineColor(onlineState) }, title: onlineTitle }),
          h('span', { className: 'dshsr-name' }, host.name),
          h('span', {
            className: 'dshsr-addr', title: t('copyUrl'),
            onClick: () => copy(host.address),
          }, host.address),
          h('span', { className: 'dshsr-status' }, t(STATUS_KEY[phase] || 'status_idle')),
          connected
            ? h('a', { className: 'dshsr-link', href: status.url, target: '_blank', rel: 'noopener' }, t('open'))
            : null,
          h('div', { className: 'dshsr-actions' },
            connected
              ? h('button', { className: 'dshsr-btn', onClick: () => onDisconnect(host.id) }, t('disconnect'))
              : h('button', {
                  className: 'dshsr-btn primary', disabled: busy,
                  onClick: () => onConnect(host.id),
                }, phase === 'failed' || phase === 'reconnecting' ? t('retry') : t('connect')),
            h('button', {
              className: 'dshsr-iconbtn', title: t('settings'), 'aria-label': t('settings'),
              onClick: () => onEdit(host),
            }, h(GearIcon)),
          ),
        ),
        status.error ? h('div', { className: 'dshsr-err' }, t('error') + ': ' + status.error) : null,
      )
    }

    // ── panel ────────────────────────────────────────────────────────────────
    function Panel({ t }) {
      const [hosts, setHosts] = useState([])
      const [editing, setEditing] = useState(null) // { ...host } | 'new' | null
      const [log, setLog] = useState([])
      const [busy, setBusy] = useState(false)
      const [modalError, setModalError] = useState(null)
      const [copied, setCopied] = useState(false)
      const [online, setOnline] = useState({}) // id -> 'online' | 'offline'
      const esRef = useRef(null)
      const visibleRef = useRef(true)

      const refresh = useCallback(async () => {
        try {
          const data = await api('GET', '/hosts')
          setHosts(data.hosts || [])
        } catch (e) { /* ignore transient */ }
      }, [])

      const probe = useCallback(async () => {
        try {
          const data = await api('GET', '/probe')
          const map = {}
          for (const [id, ok] of Object.entries(data.online || {})) map[id] = ok ? 'online' : 'offline'
          setOnline(map)
        } catch (e) { /* ignore transient */ }
      }, [])

      useEffect(() => {
        refresh()
        probe()
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
      }, [refresh, probe])

      // Poll reachability every 30s while the panel is visible; pause when hidden.
      useEffect(() => {
        const tick = () => { if (visibleRef.current && document.visibilityState === 'visible') probe() }
        const onVis = () => { visibleRef.current = document.visibilityState === 'visible'; if (visibleRef.current) probe() }
        document.addEventListener('visibilitychange', onVis)
        const timer = setInterval(tick, 30000)
        return () => { clearInterval(timer); document.removeEventListener('visibilitychange', onVis) }
      }, [probe])

      const copy = (text) => {
        try {
          navigator.clipboard.writeText(text)
          setCopied(true); setTimeout(() => setCopied(false), 1500)
        } catch (e) { /* ignore */ }
      }

      const openNew = () => { setModalError(null); setEditing('new') }
      const openEdit = (h0) => { setModalError(null); setEditing(h0) }
      const closeModal = () => { if (!busy) { setEditing(null); setModalError(null) } }

      const save = async (value) => {
        setBusy(true); setModalError(null)
        try { await api('POST', '/hosts', value); setEditing(null); await refresh(); probe() }
        catch (e) { setModalError(String(e && e.message ? e.message : e)) }
        finally { setBusy(false) }
      }
      const removeFromModal = async (id) => {
        setBusy(true); setModalError(null)
        try { await api('DELETE', '/hosts/' + id); setEditing(null); await refresh(); probe() }
        catch (e) { setModalError(String(e && e.message ? e.message : e)) }
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

      return h('div', { className: 'dshsr-root' },
        h('style', null, CSS),
        h('div', { className: 'dshsr-head' },
          h('h2', { className: 'dshsr-title' }, t('heading')),
          h('button', {
            className: 'dshsr-btn primary',
            disabled: editing !== null,
            onClick: openNew,
          }, '+ ' + t('add')),
        ),
        h('p', { className: 'dshsr-sub' }, t('subheading')),
        hosts.length === 0 && editing === null
          ? h('div', { className: 'dshsr-empty' }, t('empty'))
          : null,
        hosts.map((host) =>
          h(HostCard, {
            key: host.id, t, host, online: online[host.id], copy,
            onConnect: connect, onDisconnect: disconnect,
            onEdit: (hh) => openEdit(hh),
          }),
        ),
        log.length
          ? h('div', null,
              h('div', { className: 'dshsr-sub', style: { marginTop: 16, marginBottom: 0 } }, t('logTitle')),
              h('div', { className: 'dshsr-log' }, log.join('\n')),
            )
          : null,
        editing !== null
          ? h(HostModal, {
              t, busy, error: modalError,
              initial: editing === 'new' ? null : editing,
              onClose: closeModal, onSave: save, onDelete: removeFromModal,
            })
          : null,
        copied
          ? h('div', {
              style: {
                position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
                background: 'var(--dsw-alias-bg-0, #1e1e1e)', color: 'inherit',
                border: '1px solid var(--dsw-alias-border-l1, #444)', borderRadius: 8,
                padding: '6px 14px', fontSize: 12, zIndex: 1001,
              },
            }, t('copied'))
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
