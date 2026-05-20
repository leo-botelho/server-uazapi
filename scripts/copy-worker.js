/**
 * copy-worker.js
 * Copia .open-next/worker.js → .open-next/assets/_worker.js
 *
 * O Cloudflare Pages serve arquivos estáticos da pasta pages_build_output_dir.
 * Se houver um _worker.js na raiz dessa pasta, ele é usado como Worker para
 * tratar todas as requisições que não forem arquivos estáticos (modo avançado).
 * O OpenNext gera o worker em .open-next/worker.js — este script o move para
 * o lugar certo antes do upload.
 */
const fs = require('fs')
const path = require('path')

const src = path.join(__dirname, '..', '.open-next', 'worker.js')
const dest = path.join(__dirname, '..', '.open-next', 'assets', '_worker.js')

if (!fs.existsSync(src)) {
  console.error('[copy-worker] Arquivo worker.js não encontrado em .open-next/worker.js')
  process.exit(1)
}

fs.copyFileSync(src, dest)
console.log('[copy-worker] .open-next/worker.js → .open-next/assets/_worker.js ✓')
