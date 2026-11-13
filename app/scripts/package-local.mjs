// Local Apple Silicon build: separate identity, no signing account, no notarization or publishing.
// Apple Silicon requires a valid signature even for a local app after Electron's fuses are changed.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { signAsync } from '@electron/osx-sign'
import signing from './sign.cjs'
const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const bundle = join(appDir, 'dist/mac-arm64/Yogurt Projects.app')
const appId = readFileSync(join(appDir, 'electron-builder.yml'), 'utf8').match(/^appId:\s*(\S+)/m)?.[1]
if (!appId) throw new Error('electron-builder.yml has no appId')
// Package what the source says now, never an older out/ left by a previous build
const compiled = spawnSync('pnpm', ['exec', 'electron-vite', 'build'], { cwd: appDir, stdio: 'inherit' })
if (compiled.status !== 0) process.exit(compiled.status ?? 1)
const packaged = spawnSync('pnpm', ['exec', 'electron-builder', '--mac', '--arm64', '--dir', '--publish', 'never'], {
  cwd: appDir, stdio: 'inherit', env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' },
})
if (packaged.status !== 0) process.exit(packaged.status ?? 1)
const temporary = mkdtempSync(join(tmpdir(), 'yogurt-local-sign-'))
try {
  const build = join(appDir, 'build')
  for (const kind of ['mac', 'mac.inherit']) {
    // A local ad-hoc signature has no Apple Team ID. The engine's native libraries must still load.
    const text = readFileSync(join(build, `entitlements.${kind}.plist`), 'utf8')
      .replace('</dict>', '<key>com.apple.security.cs.disable-library-validation</key><true/></dict>')
    writeFileSync(join(temporary, `${kind}.plist`), text)
  }
  await signAsync({ app: bundle, identity: '-', identityValidation: false, platform: 'darwin',
    gatekeeperAssess: false, preAutoEntitlements: false,
    optionsForFile: file => ({ hardenedRuntime: true, timestamp: 'none',
      // Ad-hoc signatures are otherwise identified by their code hash, which changes with every build, so macOS
      // would forget Accessibility, microphone and call-audio access after each rebuild. The bundle ID stays the same.
      ...(resolve(file) === bundle ? { requirements: `=designated => identifier "${appId}"` } : {}),
      entitlements: signing.helperEntitlements(file, build) ?? join(temporary, resolve(file) === bundle ? 'mac.plist' : 'mac.inherit.plist'),
    }),
  })
  console.log(`Local ad-hoc signed app: ${bundle}`)
} finally { rmSync(temporary, { recursive: true, force: true }) }
