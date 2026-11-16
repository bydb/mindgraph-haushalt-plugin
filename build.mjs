// build.mjs — baut das Haushalt-Plugin nach dist/ (= Artefakt-Wurzel für Packen und Signieren):
//   dist/manifest.json  kanonisch (JSON.stringify(v, null, 2) + LF), deterministische Bytes
//   dist/main.js        self-contained CommonJS für den Main-Prozess, `module.exports = entry`
//   dist/renderer.js    self-contained Single-File-ESM mit eigenem React (minifiziert)
//   dist/styles.css     vom Host als <style> eingehängt
//
// Prüfungen nach dem Build (rot bei Verstoß): keine Node-/Electron-Built-ins im Main-Bundle, kein
// import/require, kein eval/new Function und kein import.meta im Renderer (der Host lehnt sie ab).

import * as esbuild from 'esbuild'
import { builtinModules } from 'node:module'
import { copyFileSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'

const BANNED = new Set([...builtinModules, ...builtinModules.map((m) => `node:${m}`), 'electron'])
const banBuiltins = {
  name: 'ban-node-builtins',
  setup(build) {
    build.onResolve({ filter: /.*/ }, (args) => {
      if (args.kind !== 'import-statement' && args.kind !== 'require-call') return undefined
      if (BANNED.has(args.path)) {
        return { errors: [{ text: `Node-/Electron-Built-in '${args.path}' ist im Plugin-Bundle verboten (nur Host).` }] }
      }
      return undefined
    })
  },
}

rmSync('dist', { recursive: true, force: true })
mkdirSync('dist', { recursive: true })

const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'))
const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
if (manifest.version !== pkg.version) {
  throw new Error(`Version weicht ab: manifest.json ${manifest.version} ≠ package.json ${pkg.version}`)
}
writeFileSync('dist/manifest.json', JSON.stringify(manifest, null, 2) + '\n')

await esbuild.build({
  entryPoints: ['src/main/index.ts'],
  outfile: 'dist/main.js',
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'node20',
  legalComments: 'none',
  // fflate wählt unter platform:node seine Node-Variante (importiert 'module' für Worker).
  // Wir nutzen nur die synchronen Funktionen — die Browser-Variante kommt ohne Built-ins aus.
  alias: { fflate: './node_modules/fflate/esm/browser.js' },
  plugins: [banBuiltins],
  footer: { js: '\nif (module.exports && module.exports.default !== undefined) { module.exports = module.exports.default }\n' },
})

await esbuild.build({
  entryPoints: ['src/renderer/index.tsx'],
  outfile: 'dist/renderer.js',
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['es2022', 'chrome120'],
  jsx: 'automatic',
  minify: true,
  legalComments: 'none',
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [banBuiltins],
})

copyFileSync('src/renderer/styles.css', 'dist/styles.css')

// — Prüfungen —
const renderer = readFileSync('dist/renderer.js', 'utf8')
const problems = []
if (/\bimport\s*\(|^\s*import\s|\bfrom\s*["']/m.test(renderer.replace(/"[^"\n]*"|'[^'\n]*'|`[^`]*`/g, '""'))) problems.push('renderer.js importiert weitere Module')
if (/\beval\s*\(|new\s+Function\s*\(/.test(renderer)) problems.push('renderer.js nutzt eval/new Function')
if (/import\.meta/.test(renderer)) problems.push('renderer.js nutzt import.meta')
if (!/export\s*\{[^}]*\bas\s+default\b|export\s+default/.test(renderer)) problems.push('renderer.js hat keinen Default-Export')
if (problems.length) throw new Error(`Renderer-Bundle ungültig:\n- ${problems.join('\n- ')}`)

const kb = (f) => `${(statSync(f).size / 1024).toFixed(1)} KB`
console.log(`Build fertig (v${manifest.version}): main.js ${kb('dist/main.js')}, renderer.js ${kb('dist/renderer.js')}, styles.css ${kb('dist/styles.css')}`)
