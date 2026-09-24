// electron-builder afterPack hook: flips Electron fuses on the packaged exe.
// These close the cheap tamper/bypass routes for release builds:
//   - EnableEmbeddedAsarIntegrityValidation: the exe refuses to run when
//     app.asar was modified (electron-builder embeds its expected hash).
//   - OnlyLoadAppFromAsar: no loading a replaced app from loose files.
//   - runAsNode / NODE_OPTIONS / --inspect off: the shipped binary can't be
//     repurposed to run someone else's JS or be debugged into it.
// Dev builds (npm run dev) are untouched — fuses only apply to packaged exes.
// NOTE: fuse options go at the TOP LEVEL keyed by the FuseV1Options enum —
// nesting them under [FuseVersion.V1] is silently misread by the library.

const { join } = require('node:path')
const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses')

async function flipAppFuses(context) {
  const exePath = join(context.appOutDir, `${context.packager.appInfo.productFilename}.exe`)
  await flipFuses(exePath, {
    version: FuseVersion.V1,
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableCookieEncryption]: true,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
    [FuseV1Options.OnlyLoadAppFromAsar]: true
    // GrantFileProtocolExtraPrivileges is deliberately left at its default
    // (enabled): the app's own UI loads via file:// from inside app.asar —
    // disabling it broke renderer loading (ERR_FILE_NOT_FOUND) in testing.
  })
}

module.exports = flipAppFuses
module.exports.default = flipAppFuses
