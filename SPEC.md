# ServerController — Technical Task Prompt (v1.0, prototype)

Build a local Minecraft server controller as an Electron desktop app.

**Stack:** Electron + TypeScript (main & preload) · React + TypeScript (renderer) · plain CSS (no CSS frameworks) · electron-vite build tooling. Windows is the target platform for the prototype.

## 1. Product definition

The user selects a Minecraft world folder (typically `%APPDATA%\.minecraft\saves\<world>`). The app then:

1. **Shows and edits the world's data** — parse `level.dat` (gzip'd NBT) and present world info (name, game version, DataVersion, seed, gamemode, difficulty, hardcore, cheats, folder size, player count). Key fields are editable (world name, gamemode, difficulty, hardcore, cheats) with a timestamped backup written before every save.
2. **Hosts the world as a local dedicated server** — the server runs as a separate Java process managed by the app, and keeps running whether or not anyone (including the owner) is currently in the world or in the game at all.
3. **Provides a live server console** — every command typed into the app's console executes at the server console's permission level (**op level 4**), **regardless of whether cheats are enabled in the world**. Mechanism: the level.dat `allowCommands` flag only gates in-game chat commands; commands written to a dedicated server's process stdin always run at full console permission. This is the core requirement of the product.
4. **Accepts unofficial/cracked launchers** — the generated `server.properties` defaults to `online-mode=false` and `enforce-secure-profile=false` (toggleable in Settings), so players on unofficial launchers can join over LAN.
5. **Protects the original world** — the server always runs on a **copy** of the world (world mode: copy + sync-back). After stopping, a **Sync back** action copies the played world back into the original saves folder. The server process never writes into the original saves folder.
6. **Supports modded servers** — five server sources:
   - **Vanilla** — auto-download `server.jar` from Mojang's official version manifest (sha1-verified, cached).
   - **Fabric** — auto-download the Fabric server launcher jar from `meta.fabricmc.net` (user picks game + loader version; the launcher jar self-installs libraries on first run).
   - **NeoForge** — auto-install: version list from `maven.neoforged.net`, installer downloaded and `--installServer` run by the app into a managed folder, then reused. Handles both version schemes: pre-2025 `21.1.57 → MC 1.21.1` (with the `47.x → 1.20.1` special case) and year-based `26.3.0.16 → MC 26.3`; betas are offered marked `(beta)`.
   - **Forge** — auto-install: versions from the Forge maven-metadata.xml (modern `<mc>-<build>` format, MC 1.17+; recommended/latest tags from promotions_slim.json), installer downloaded and `--installServer` run by the app, then reused.
   - **Custom server folder** — user points at an already-installed modded server directory. The app runs the server **in that folder**, injecting only its world copy, `server.properties`, and `eula.txt`. Launch entry detection: root `win_args.txt` (`java @win_args.txt`), the NeoForge 26.x layout `libraries/net/neoforged/neoforge/<v>/win_args.txt`, otherwise the newest jar matching `/(server|forge|fabric|neoforge|minecraft).*\.jar$/i` with `-jar <jar>`.
7. **Client pack folder** — for any non-custom source, Settings can point at a client instance folder (or its `mods` folder). On every host, `mods`, `config`, `defaultconfigs` and `kubejs` are mirrored (wipe + copy) from there into the server. Client-only mods are copied as-is — loaders ignore/tolerate them; no filtering is attempted.
8. **Creates new worlds** — "Create new world" (name + optional seed) makes an empty folder in `.minecraft/saves` marked with `.sc-new-world.json`. Hosting it skips the world copy entirely; the server generates the world on first start (`level-seed` written into server.properties). After Sync back it is a normal save.

## 2. Core user flows

- **Select world → info card.** Folder picker (default path points at `.minecraft/saves`). App validates `level.dat` exists and parses it. A created-but-never-hosted world (marker file, no level.dat) shows a dedicated "New world" card instead.
- **Create new world.** Modal (name + optional seed) → creates the marked saves folder and selects it. Host generates it; Sync back materializes the save.
- **Edit world data.** Form edits level.dat fields; Save is blocked while the server for that world is running. A `level.dat.bak-<timestamp>` backup is written next to the original before saving.
- **Host.** One click: app ensures server jar (downloads with progress if needed), copies the world into an instance directory (progress events), writes `server.properties` + `eula.txt` (only after one-time EULA consent dialog), spawns `javaw -Xms512M -Xmx<NG>G <entry> nogui`, and switches to the Console page.
- **Console.** Live log stream (stdout+stderr, ANSI-stripped, INFO/WARN/ERROR colored), autoscroll with pause-on-scroll-up, command input with ↑/↓ history (persisted), quick-command chips (`list`, `save-all`, `time set day`, `weather clear`, `say`, `op <player>`, `stop`), status pill (Stopped/Starting/Running/Stopping/Crashed), address pill `localhost:<port>`.
- **Stop / Restart.** Stop sends `stop` on stdin (graceful save), waits ≤ 30 s, then force-kills the process tree (`taskkill /PID <pid> /T /F`). Closing the window while running asks for confirmation and stops the server first.
- **Sync back.** Enabled when the server is stopped and an instance copy exists. Backs up the saves `level.dat`, then swaps the instance world copy into the saves folder via temp-dir + rename.

## 3. Architecture

```
Electron main (Node) ──IPC──► preload (contextBridge) ──window.api──► renderer (React)
```

- **Main process** owns all system access: dialogs, NBT codec, world copy/sync, Java detection, jar downloads, server process lifecycle, config store. Renderer has zero Node access (`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, CSP meta tag).
- **Preload** exposes a typed `window.api`: `ipcRenderer.invoke` wrappers + event subscriptions.
- **Renderer**: React 18, three pages (Worlds, Console, Settings) in a sidebar shell; state via React context; logs capped at 2000 lines client-side.

### Data layout (in `app.getPath('userData')`)

```
config.json                                  ← settings (java, memory, port, world mode, source, eula flag…)
jars/vanilla-<id>.jar                        ← downloaded server jars (top-level, NOT under
jars/fabric-<game>-<loader>.jar                Chromium's disposable cache/ — cleanup-tool safe;
jars/<kind>-<version>-installer.jar            the folder is re-created on demand by downloadTo)
servers/<kind>-<version>/                    ← app-installed loader servers (shared across worlds)
  .sc-install.json                           ← install completion marker
  libraries/…, run.bat, win_args.txt, mods/, config/ …
instances/<world-slug>-<hash8>/              ← per-world instance (vanilla/fabric)
  world/                                     ← copied world (session.lock skipped)
  server.jar | fabric-server-launch.jar
  server.properties, eula.txt, logs/ …
```

Loader-server mode (NeoForge/Forge): `servers/<kind>-<version>/` is the server cwd (same launch logic as custom folders); the world copy, pack folders, `server.properties`, `eula.txt` are written there.

Custom-folder mode: the chosen modded folder is the server cwd; only `world/`, `server.properties`, `eula.txt` are written there. The client pack folder setting does not apply in custom mode.

## 4. Main-process modules

| Module | Responsibility |
|---|---|
| `nbt.ts` | Dependency-free NBT codec: tags 0–12, big-endian, gzip; Long = BigInt; preserves tag order & unknown tags. `parseNbt`, `writeNbt`, `readLevelDat`, `writeLevelDat`. |
| `world.ts` | Validate world, read info (incl. MC 26.x layouts: seed in `data/minecraft/world_gen_settings.dat`, `difficulty_settings` compound with name-string difficulty), apply level.dat edits (with backup, dual-format difficulty/hardcore writes), recursive copy with progress (skip `session.lock`), sync-back via temp-dir swap, new-world creation (`.sc-new-world.json` marker). |
| `java.ts` | Detect runtimes: manual override → `JAVA_HOME` → `PATH` (`where`) → Minecraft launcher bundled runtimes → `Program Files\Java\*`, Eclipse Adoptium, Microsoft JDKs. Version probed via `java -version`; **candidates are ranked newest-first** so an old Java 8 on PATH never beats a newer runtime. |
| `jar.ts` | Mojang manifest + per-version JSON + sha1-verified download with progress (`downloadTo` exported for reuse); Fabric meta (game/loader/installer) + launcher jar download; cache in `cache/jars`. |
| `loader.ts` | NeoForge/Forge version lists + managed installer (`servers/<kind>-<version>/`): version APIs (`maven.neoforged.net` releases API; Forge maven-metadata.xml + promotions_slim.json), installer download (cached), `--installServer` run via the resolved Java (retries without the dir argument for older installers), `.sc-install.json` completion marker, launch-entry detection (root or NeoForge-26.x nested `win_args.txt`, fallback jar scan). Electron-free — testable outside the app. |
| `serverProcess.ts` | Spawn/stop lifecycle, line-buffered log capture, ANSI strip, ring buffer (500), state machine `stopped→starting→running→stopping→stopped|crashed`, running detected via `Done (` line, graceful stop + taskkill fallback. |
| `instance.ts` | Instance dir naming, world copy orchestration (skipped for new worlds — the server generates those), client-pack mirror (`mods`/`config`/`defaultconfigs`/`kubejs`, wipe + copy per host, pack root = picked folder or its parent when `mods` itself was picked), `server.properties` read-modify-write (level-seed for new worlds), `eula.txt`, jar staging, launch-arg construction, custom-folder + managed-loader entry resolution. |
| `store.ts` | JSON config load/save. |
| `ipc.ts` | All `ipcMain.handle` registrations + main→renderer events. |

## 5. IPC contract

**invoke:** `dialog:selectWorld` (opens at the configured default saves folder, falling back to `.minecraft/saves`), `dialog:pickFolder`, `java:pick`, `world:info(path)`, `world:saveLevel(path, edits)`, `world:syncBack(path)`, `world:createNew(name, seed?)` (creates in the default saves folder), `java:detect`, `jar:vanillaVersions`, `jar:fabricVersions`, `jar:ensure(kind, mc, loader?)`, `loader:versions(kind)`, `loader:status(kind, version)`, `loader:list()`, `loader:remove(kind, version)` (blocked while that server is running), `loader:ensure(kind, version)`, `custom:inspect(dir)`, `server:start(worldPath)`, `server:stop`, `server:send(cmd)`, `server:status`, `config:get`, `config:set(patch)`, `eula:accept`.

**events (main→renderer):** `server:log(LogLine)` (also used for loader installer output, `[loader]`-prefixed), `server:state(ServerState)`, `jar:progress(JarProgress)`, `world:progress(WorldProgress)`.

## 6. UI specification

Dark theme: bg `#0e1116`, panels `#161a22`, borders `#232a36`, text `#e6e9ef`, muted `#8b93a7`, accent `#3fb950`; status colors green/amber/red/gray. Inter/system UI font, Cascadia Mono/Consolas console. Styled scrollbars, focus rings, hover states, soft card shadows. Window 1280×820 (min 1120×700).

- **Worlds page**: empty state (drop-zone card + "Create new world…" secondary action) or world card (meta grid) + level.dat editor form + `Host this world` primary CTA + `Sync back`; a "Select world…" button is always available in the header (any view); a never-hosted created world renders a "New world" card (seed/status, generation note, no editor, no sync-back).
- **Console page**: status + address header, prep-progress bars (world copy / pack copy / jar download), loader installer output streams into the log view as `[loader]` lines, banners ("Commands run at console permission (op level 4) — works even with cheats off"; version downgrade/upgrade warning comparing world `Version.Name` to selected server version — NeoForge/Forge versions are mapped to their Minecraft version; modded note in custom mode; client-pack note when a pack folder is set), log view, command input + quick chips.
- **Settings page**: Java runtime picker (detected list + browse + version, ranked newest-first; red banner when the active runtime is older than the selected server needs — 17/21/25 by MC version), server source (Vanilla version dropdown / Fabric game+loader dropdowns / NeoForge game+build dropdowns / Forge game+build dropdowns with recommended/latest tags and (beta) marks + install status note / Custom folder browse with entry preview), client pack folder picker (non-custom sources), **Worlds card** (default saves folder — picker start location + new-world target; launcher instance saves folders work; falls back to `.minecraft/saves`), **Installed loader servers card** (persisted installations with Remove buttons — reinstalls automatically if selected again; removal blocked while that server is running), memory 1–8 GB slider, port, online-mode toggle, EULA status.

## 7. Non-goals (prototype)

No modpack browsing/download (CurseForge/Modrinth server packs), no client-only mod filtering (pack folders are copied as-is), no Java auto-download, no simultaneous instances, no RCON (stdin suffices), no world editing while server runs, no app packaging/installer (runs via `npm run dev`), Windows-only paths.

## 8. Acceptance criteria

a. Real saves folder parses; info card correct. b. Vanilla jar downloads with progress; server starts; `Done` line flips status to Running; client joins at `localhost:<port>`. c. `op <name>` / `gamemode creative <name>` succeed from the app console with world cheats **off**. d. Cracked/unofficial launcher can join. e. Graceful stop; sync-back updates the original world. f. level.dat edits persist (re-read + singleplayer show them); backup file exists. g. Fabric and custom modded folders launch with mods loaded. h. Clean, usable UI at 1280×720 with no layout breakage.

## 9. Known limitations (documented in README/app)

Offline-mode players get offline UUIDs → fresh `playerdata` (singleplayer inventory does not auto-transfer). Hosting a world with an older server than its DataVersion may lose data — the app warns, the user proceeds. The custom modded folder is mutated only in `world/`, `server.properties`, `eula.txt`. `eula.txt` (`eula=true`) is written only after explicit in-app consent.
