/**
 * patch-lockfile.js
 *
 * Adds @emnapi/runtime and @emnapi/core to package-lock.json if they are
 * missing. These packages are bundled inside @tailwindcss/oxide-wasm32-wasi
 * (cpu: wasm32) so npm on Windows/macOS never writes a separate lock entry.
 * Cloudflare's Linux npm ci then fails because it validates all transitive
 * deps. This script keeps the entries present after every npm install.
 */
const fs = require('fs')
const path = require('path')

const lockPath = path.join(__dirname, '..', 'package-lock.json')

if (!fs.existsSync(lockPath)) {
  console.log('[patch-lockfile] No package-lock.json found, skipping.')
  process.exit(0)
}

const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'))
const pkgs = lock.packages || {}

let patched = false

if (!pkgs['node_modules/@emnapi/runtime']) {
  pkgs['node_modules/@emnapi/runtime'] = {
    version: '1.10.0',
    resolved: 'https://registry.npmjs.org/@emnapi/runtime/-/runtime-1.10.0.tgz',
    integrity: 'sha512-ewvYlk86xUoGI0zQRNq/mC+16R1QeDlKQy21Ki3oSYXNgLb45GV1P6A0M+/s6nyCuNDqe5VpaY84BzXGwVbwFA==',
    optional: true,
    license: 'MIT',
    dependencies: { tslib: '^2.4.0' },
  }
  patched = true
  console.log('[patch-lockfile] Added @emnapi/runtime@1.10.0')
}

if (!pkgs['node_modules/@emnapi/core']) {
  pkgs['node_modules/@emnapi/core'] = {
    version: '1.10.0',
    resolved: 'https://registry.npmjs.org/@emnapi/core/-/core-1.10.0.tgz',
    integrity: 'sha512-yq6OkJ4p82CAfPl0u9mQebQHKPJkY7WrIuk205cTYnYe+k2Z8YBh11FrbRG/H6ihirqcacOgl2BIO8oyMQLeXw==',
    optional: true,
    license: 'MIT',
    dependencies: { '@emnapi/wasi-threads': '1.2.1', tslib: '^2.4.0' },
  }
  patched = true
  console.log('[patch-lockfile] Added @emnapi/core@1.10.0')
}

if (patched) {
  fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n')
  console.log('[patch-lockfile] package-lock.json updated.')
} else {
  console.log('[patch-lockfile] All @emnapi entries present, nothing to do.')
}
