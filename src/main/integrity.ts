import { app, BrowserWindow, clipboard, ipcMain, shell } from 'electron'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { join } from 'node:path'
import { DISCORD_USERNAME, REPO_URL } from './updater'
import { RELEASES_API, netFetchText } from './github'

/**
 * Second-line tamper defense, on top of the asar-integrity fuse.
 *
 * The fuse (scripts/after-pack-fuses.cjs) kills the process before any app
 * code runs when app.asar was swapped — no UI is possible in that case. But
 * someone who patches the exe's embedded hash, or recompiles the public
 * source into their own build, makes the app run again. For those cases the
 * packaged app verifies itself at startup against the official record:
 * every CI release carries an `asar.sha256` asset with the official hash of
 * app.asar, and the app compares it with its own on-disk app.asar.
 *
 * Mismatch — or a build whose version has no official release — shows the
 * independent "unofficial copy" warning window instead of the app. Network
 * errors are ignored (offline users must not be locked out); dev runs skip
 * the check entirely.
 */

const HASH_ASSET = 'asar.sha256'

function sha256OfFile(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(path)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

/** True = verified or unverifiable (offline) → run normally. False = unofficial copy. */
async function verifyIntegrity(): Promise<boolean> {
  let ownHash: string
  try {
    // Electron patches fs to treat app.asar as a directory; hashing the raw
    // archive file needs the patch temporarily off.
    const noAsarBefore = process.noAsar
    process.noAsar = true
    try {
      ownHash = await sha256OfFile(join(process.resourcesPath, 'app.asar'))
    } finally {
      process.noAsar = noAsarBefore
    }
  } catch {
    return true // no readable asar (weird environment) — the fuse handles tampering anyway
  }

  const release = await netFetchText(`${RELEASES_API}/v${app.getVersion()}`, 10000)
  if (!release) return true // network error — offline or blocked, skip the check
  if (release.status === 404) return false // this version was never released by us
  if (release.status !== 200) return true // GitHub hiccup — don't punish the user

  let parsed: { assets?: Array<{ name: string; browser_download_url: string }> }
  try {
    parsed = JSON.parse(release.text) as typeof parsed
  } catch {
    return true
  }
  const asset = parsed.assets?.find((a) => a.name === HASH_ASSET)
  if (!asset) return false // official releases always carry the integrity hash

  const hash = await netFetchText(asset.browser_download_url, 15000)
  if (!hash || hash.status !== 200) return true
  return hash.text.trim().toLowerCase() === ownHash
}

/** Just the two handlers the warning window needs — a tampered copy must not run the full IPC surface. */
function registerWarningIpc(): void {
  ipcMain.handle('util:openRepo', () => shell.openExternal(REPO_URL))
  ipcMain.handle('util:copyDiscord', () => {
    clipboard.writeText(DISCORD_USERNAME)
    return true
  })
}

const GITHUB_SVG =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg>'
const DISCORD_SVG =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z"/></svg>'

const WARNING_HTML = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { height: 100%; }
  body {
    background: #0e1116;
    color: #e6e9ef;
    font-family: 'Inter', 'Segoe UI', system-ui, sans-serif;
    font-size: 13.5px;
    line-height: 1.55;
    display: flex;
    flex-direction: column;
    padding: 30px 32px 20px;
    overflow: auto;
  }
  .warn-icon {
    width: 96px; height: 96px;
    display: flex; align-items: center; justify-content: center;
    align-self: center;
    border-radius: 20px;
    background: rgba(248, 81, 73, 0.12);
    border: 1px solid rgba(248, 81, 73, 0.4);
    color: #f85149;
    margin-bottom: 22px;
    animation: blink 1.1s ease-in-out infinite;
  }
  .warn-icon svg { width: 56px; height: 56px; }
  @keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
  h1 { font-size: 17px; letter-spacing: -0.01em; margin-bottom: 10px; }
  .lead { color: #b8c0d0; margin-bottom: 14px; }
  .do-now { font-weight: 700; margin-bottom: 6px; }
  ol { margin: 0 0 16px 22px; }
  li { margin-bottom: 6px; }
  .link { color: #58a6ff; cursor: pointer; }
  .link:hover { text-decoration: underline; }
  .actions {
    display: flex; align-items: center; justify-content: center; gap: 10px;
    margin-top: auto; padding-top: 16px;
  }
  .btn {
    display: inline-flex; align-items: center; gap: 8px;
    padding: 9px 16px;
    border: 1px solid rgba(46, 160, 67, 0.8);
    border-radius: 8px;
    background: linear-gradient(180deg, #46b658, #2ea043);
    color: #fff; font: inherit; font-weight: 600; cursor: pointer;
    white-space: nowrap;
  }
  .btn:hover { background: linear-gradient(180deg, #52c165, #33b348); }
  .btn-icon {
    width: 36px; height: 36px;
    display: inline-flex; align-items: center; justify-content: center;
    border: 1px solid #232a36; border-radius: 8px;
    background: transparent; color: #8b93a7; cursor: pointer;
  }
  .btn-icon:hover { color: #e6e9ef; background: rgba(255, 255, 255, 0.04); }
  .license {
    margin-top: 12px; padding-top: 10px;
    border-top: 1px solid #232a36;
    font-size: 10.5px; color: #8b93a7; text-align: center;
  }
</style>
</head>
<body>
  <div class="warn-icon">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 3L2 20h20z"></path><path d="M12 9.5v5"></path><path d="M12 17.2v.3"></path>
    </svg>
  </div>
  <h1>Unofficial copy of ServerController</h1>
  <p class="lead">You have launched an unofficial, unverified copy of ServerController that may contain malware.</p>
  <p class="do-now">Do the following right now:</p>
  <ol>
    <li>Delete the app from your PC.</li>
    <li>Reset all of your passwords.</li>
    <li>Contact <span id="discord-link" class="link" title="Click to copy the Discord username">.extremism</span> on Discord and send the link to where you downloaded this app from.</li>
  </ol>
  <p class="lead">You can download the official version using the GitHub button below.</p>
  <div class="actions">
    <button id="github-btn" class="btn">${GITHUB_SVG}Official GitHub repository</button>
    <button id="discord-btn" class="btn-icon" title="Discord: .extremism — click to copy">${DISCORD_SVG}</button>
  </div>
  <div class="license">ServerController © 2026. All rights reserved.</div>
  <script>
    var api = window.api
    function copyDiscord() {
      if (!api) return
      api.copyDiscord().then(function () {
        var el = document.getElementById('discord-link')
        el.textContent = 'Copied!'
        setTimeout(function () { el.textContent = '.extremism' }, 1500)
      })
    }
    document.getElementById('github-btn').addEventListener('click', function () { if (api) api.openRepo() })
    document.getElementById('discord-link').addEventListener('click', copyDiscord)
    document.getElementById('discord-btn').addEventListener('click', copyDiscord)
  </script>
</body>
</html>`

function showIntegrityWarning(): void {
  const win = new BrowserWindow({
    width: 560,
    height: 690,
    resizable: false,
    minimizable: false,
    maximizable: false,
    autoHideMenuBar: true,
    backgroundColor: '#0e1116',
    title: 'ServerController — Unofficial copy',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  void win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(WARNING_HTML))
  win.on('closed', () => app.exit(0))
}

/**
 * Startup integrity gate. Returns true when the app should start normally;
 * false when the unofficial-copy warning is shown instead (the app then
 * exits when the warning window closes).
 */
export async function runIntegrityGate(): Promise<boolean> {
  if (!app.isPackaged) return true
  const ok = await verifyIntegrity()
  if (!ok) {
    console.error('[integrity] app.asar does not match the official release — showing unofficial-copy warning')
    registerWarningIpc()
    showIntegrityWarning()
    return false
  }
  return true
}
