import { exec, spawn, type ChildProcess } from 'node:child_process'
import type { LogLine, ServerState } from '../shared/types'

const ANSI_RE = /\x1b(?:\[[0-9;]*[A-Za-z]|\][^\x07]*(?:\x07|\x1b\\))/g
const RING_CAPACITY = 500
const STOP_TIMEOUT_MS = 30000
/** Vanilla and modded servers alike print `Done (Xs)! …` once the world is ready. */
const DONE_RE = /Done \(\d/

export interface ServerStartConfig {
  serverId: string
  javaPath: string
  args: string[]
  cwd: string
  worldPath: string
  instanceWorldDir: string
  address: string
  localAddress: string
}

export interface ServerEmitter {
  log(serverId: string, line: LogLine): void
  state(serverId: string, state: ServerState, worldPath: string | null, address: string | null, localAddress: string | null): void
}

type Listener = () => void

export class ServerProcessManager {
  private proc: ChildProcess | null = null
  private emitter: ServerEmitter | null = null
  private _state: ServerState = 'stopped'
  private ring: LogLine[] = []
  private outBuf = ''
  private errBuf = ''
  private stopTimer: NodeJS.Timeout | null = null
  private stopRequested = false
  private _worldPath: string | null = null
  private _instanceWorldDir: string | null = null
  private _address: string | null = null
  private _localAddress: string | null = null
  private _port: number | null = null
  private _cwd: string | null = null
  private stoppedListeners: Listener[] = []

  constructor(public readonly serverId: string) {}

  get state(): ServerState {
    return this._state
  }

  get worldPath(): string | null {
    return this._worldPath
  }

  get instanceWorldDir(): string | null {
    return this._instanceWorldDir
  }

  get address(): string | null {
    return this._address
  }

  get localAddress(): string | null {
    return this._localAddress
  }

  get port(): number | null {
    return this._port
  }

  get cwd(): string | null {
    return this._cwd
  }

  get recentLogs(): LogLine[] {
    return [...this.ring]
  }

  get busy(): boolean {
    return this._state !== 'stopped' && this._state !== 'crashed'
  }

  onceStopped(listener: Listener): void {
    if (!this.busy) {
      listener()
      return
    }
    this.stoppedListeners.push(listener)
  }

  start(config: ServerStartConfig, emitter: ServerEmitter): void {
    if (this.busy) throw new Error('This server is already running — stop it first')

    this.emitter = emitter
    this.ring = []
    this.outBuf = ''
    this.errBuf = ''
    this.stopRequested = false
    this._worldPath = config.worldPath
    this._instanceWorldDir = config.instanceWorldDir
    this._address = config.address
    this._localAddress = config.localAddress
    this._port = Number(/:(\d+)$/.exec(config.localAddress ?? '')?.[1] ?? 0) || null
    this._cwd = config.cwd

    this.pushLine({
      stream: 'out',
      text: `Starting server — ${config.address} (java "${config.javaPath}" in ${config.cwd})`,
      level: 'info',
      ts: Date.now()
    })
    this.setState('starting')

    try {
      this.proc = spawn(config.javaPath, config.args, { cwd: config.cwd, windowsHide: true })
    } catch (err) {
      this.pushLine({
        stream: 'err',
        text: `Failed to spawn Java: ${String(err)}`,
        level: 'error',
        ts: Date.now()
      })
      this.setState('crashed')
      this.proc = null
      return
    }

    const proc = this.proc
    proc.stdin?.on('error', () => undefined)
    proc.stdout?.on('data', (chunk: Buffer) => this.onChunk('out', chunk))
    proc.stderr?.on('data', (chunk: Buffer) => this.onChunk('err', chunk))
    proc.on('error', (err) => {
      this.pushLine({ stream: 'err', text: `Process error: ${err.message}`, level: 'error', ts: Date.now() })
      this.setState('crashed')
    })
    proc.on('exit', (code) => {
      if (this.stopTimer) {
        clearTimeout(this.stopTimer)
        this.stopTimer = null
      }
      this.pushLine({
        stream: 'out',
        text: this.stopRequested ? `Server process exited (code ${code ?? 0})` : `Server process exited unexpectedly (code ${code ?? 0})`,
        level: this.stopRequested || code === 0 ? 'info' : 'error',
        ts: Date.now()
      })
      this.setState(this.stopRequested || code === 0 ? 'stopped' : 'crashed')
      this.proc = null
      const listeners = this.stoppedListeners
      this.stoppedListeners = []
      for (const listener of listeners) listener()
    })
  }

  send(command: string): boolean {
    const trimmed = command.trim()
    if (!trimmed) return false
    if (!this.proc?.stdin?.writable) return false
    try {
      this.proc.stdin.write(`${trimmed}\n`)
    } catch {
      return false
    }
    this.pushLine({ stream: 'out', text: `> ${trimmed}`, level: 'info', ts: Date.now() })
    return true
  }

  requestStop(): boolean {
    if (!this.busy || !this.proc) return false
    if (this._state === 'stopping') return true
    this.stopRequested = true
    this.setState('stopping')
    this.send('stop')
    this.stopTimer = setTimeout(() => {
      this.pushLine({
        stream: 'err',
        text: 'Server did not stop in time — force killing process tree',
        level: 'warn',
        ts: Date.now()
      })
      this.forceKill()
    }, STOP_TIMEOUT_MS)
    return true
  }

  forceKill(): void {
    const pid = this.proc?.pid
    if (pid) {
      exec(`taskkill /PID ${pid} /T /F`, () => undefined)
    }
  }

  private onChunk(stream: 'out' | 'err', chunk: Buffer): void {
    const text = chunk.toString('utf8')
    const buffered = (stream === 'out' ? this.outBuf : this.errBuf) + text
    const parts = buffered.split(/\r?\n/)
    const remainder = parts.pop() ?? ''
    if (stream === 'out') this.outBuf = remainder
    else this.errBuf = remainder
    for (const line of parts) {
      if (line.trim().length === 0) continue
      // `Done (12.345s)! For help …` — the server is up and accepting commands.
      if (this._state === 'starting' && DONE_RE.test(line)) this.setState('running')
      this.pushLine({ stream, text: line, level: 'info', ts: Date.now() })
    }
  }

  private pushLine(line: LogLine): void {
    const text = line.text.replace(ANSI_RE, '')
    const level = this.classify(text)
    const enriched: LogLine = { ...line, text, level }
    this.ring.push(enriched)
    if (this.ring.length > RING_CAPACITY) this.ring.shift()
    this.emitter?.log(this.serverId, enriched)
  }

  private classify(text: string): LogLine['level'] {
    if (/\/ERROR\]|SEVERE|^Exception |^Error:|Could not save|Crash report/.test(text)) return 'error'
    if (/\/WARN\]|^WARN /.test(text)) return 'warn'
    return 'info'
  }

  private setState(state: ServerState): void {
    this._state = state
    this.emitter?.state(this.serverId, state, this._worldPath, this._address, this._localAddress)
  }
}

/**
 * All live server processes, keyed by profile id. One manager per server
 * profile; several can run at the same time as long as ports and folders
 * do not collide (checked before start).
 */
export class ServerRegistry {
  private readonly managers = new Map<string, ServerProcessManager>()

  get(serverId: string): ServerProcessManager | null {
    return this.managers.get(serverId) ?? null
  }

  ensure(serverId: string): ServerProcessManager {
    let manager = this.managers.get(serverId)
    if (!manager) {
      manager = new ServerProcessManager(serverId)
      this.managers.set(serverId, manager)
    }
    return manager
  }

  remove(serverId: string): void {
    this.managers.delete(serverId)
  }

  all(): ServerProcessManager[] {
    return [...this.managers.values()]
  }

  busy(): ServerProcessManager[] {
    return this.all().filter((m) => m.busy)
  }

  get busyAny(): boolean {
    return this.busy().length > 0
  }

  /** True when a server is (or is starting/stopping) on this port. */
  portInUse(port: number, exceptId?: string): boolean {
    return this.busy().some((m) => m.port === port && m.serverId !== exceptId)
  }

  /** True when a server is running out of this directory (custom folders / run dirs). */
  dirInUse(dir: string, exceptId?: string): boolean {
    const needle = dir.toLowerCase()
    return this.busy().some(
      (m) => m.serverId !== exceptId && m.instanceWorldDir && dirname(m.instanceWorldDir).toLowerCase() === needle
    )
  }

  requestStopAll(): void {
    for (const manager of this.busy()) manager.requestStop()
  }

  forceKillAll(): void {
    for (const manager of this.busy()) manager.forceKill()
  }

  onceAllStopped(listener: Listener): void {
    const busy = this.busy()
    if (busy.length === 0) {
      listener()
      return
    }
    let remaining = busy.length
    const done = (): void => {
      remaining--
      if (remaining <= 0) listener()
    }
    for (const manager of busy) manager.onceStopped(done)
  }
}

function dirname(path: string): string {
  const idx = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'))
  return idx === -1 ? path : path.slice(0, idx)
}

export const serverRegistry = new ServerRegistry()
