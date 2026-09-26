/** Walk the packaged shell's runtime import graph from main.js; list unresolvable packages. */
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'

const REPO = resolve(process.argv[2])
const EXTRACT = resolve(process.argv[3])
const ADDED = []
// External npm packages we will declare; simulate their presence after install.
const PROVIDED_EXTERNALLY = new Set([])

const nameToDir = new Map()
function scanDir(dir, depth) {
  if (depth > 2) return
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue
    const pj = join(dir, e.name, 'package.json')
    if (existsSync(pj)) {
      try { const n = JSON.parse(readFileSync(pj, 'utf8')).name; if (n) nameToDir.set(n, join(dir, e.name)) }
      catch { /* skip */ }
    } else scanDir(join(dir, e.name), depth + 1)
  }
}
for (const top of ['packages', 'apps', 'vendor', 'native']) scanDir(join(REPO, top), 0)

const addedSet = new Set(ADDED)
function pkgBaseDir(name) {
  if (addedSet.has(name) && nameToDir.has(name)) return nameToDir.get(name)
  const p = join(EXTRACT, 'node_modules', ...name.split('/'))
  return existsSync(p) ? p : undefined
}
function pickExport(exportsField, subpath) {
  const entry = exportsField?.[subpath]
  if (typeof entry === 'string') return entry
  if (entry && typeof entry === 'object') return entry.import ?? entry.default ?? entry.require ?? entry.types
  return undefined
}
function resolveFile(base) {
  const tries = [base, `${base}.js`, `${base}.mjs`, `${base}.cjs`, join(base, 'index.js')]
  return tries.find(t => { try { return statSync(t).isFile() } catch { return false } })
}
function resolveSpecifier(spec, fromFile) {
  if (spec.startsWith('.') || spec.startsWith('/') || /^[a-zA-Z]:/u.test(spec)) {
    return resolveFile(resolve(dirname(fromFile), spec))
  }
  const pkg = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]
  const sub = '.' + spec.slice(pkg.length)
  const base = pkgBaseDir(pkg)
  if (!base) return { unresolved: pkg, spec }
  let json = {}
  try { json = JSON.parse(readFileSync(join(base, 'package.json'), 'utf8')) } catch { return { unresolved: pkg, spec } }
  let rel = pickExport(json.exports, '.')
  if (sub !== '.') rel = pickExport(json.exports, sub) ?? rel
  if (!rel) rel = json.main ?? './lib/index.js'
  return resolveFile(join(base, rel)) ?? resolveFile(join(base, sub === '.' ? 'lib/index.js' : join('lib', sub)))
}
const re = /(?:^|[;\s}])(?:import|export)\s+(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\)|import\(\s*['"]([^'"]+)['"]\s*\)/gu
const seen = new Set()
const queue = [join(EXTRACT, 'lib', 'main.js')]
const missing = new Map()
let walked = 0
while (queue.length) {
  const file = queue.shift()
  if (seen.has(file)) continue
  seen.add(file); walked++
  let src
  try { src = readFileSync(file, 'utf8') } catch { continue }
  for (const m of src.matchAll(re)) {
    const spec = m[1] ?? m[2] ?? m[3]
    if (!spec || spec === 'electron' || spec.startsWith('node:')) continue
    if (/^(?:assert|buffer|child_process|cluster|console|constants|crypto|dgram|dns|domain|events|fs|http|http2|https|inspector|module|net|os|path|perf_hooks|process|punycode|querystring|readline|repl|sea|sqlite|stream|string_decoder|sys|test|timers|tls|tty|url|util|v8|vm|worker_threads|zlib|async_hooks|diagnostics_channel)(?:\/|$)/u.test(spec)) continue
    const r = resolveSpecifier(spec, file)
    if (typeof r === 'string') { if (/connection|typert|gateway/.test(r)) console.log('ENTER', r.replace(REPO, '~').replace(EXTRACT, '[asar]')); queue.push(r) }
    else if (r?.unresolved && !PROVIDED_EXTERNALLY.has(r.unresolved)) {
      const rec = missing.get(r.unresolved) ?? new Set()
      if (rec.size < 4) rec.add(`${file.replace(REPO, '~').replace(EXTRACT, '[asar]')} :: ${spec}`)
      missing.set(r.unresolved, rec)
    }
  }
}
console.log(`files walked: ${walked}`)
console.log(`LAUNCH-GRAPH UNRESOLVED packages (ADDED=${ADDED.join(',')}): ${missing.size}`)
for (const [pkg, refs] of [...missing.entries()].sort()) {
  console.log(`  ${pkg}`)
  for (const r of refs) console.log(`    <- ${r}`)
}
