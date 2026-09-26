/** Map runtime-unresolvable bare imports in the extracted packaged app shell tree. */
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join, dirname, resolve, sep } from 'node:path'

const root = resolve(process.argv[2])
const excl = join(root, 'dsh') // the bundled dsh runtime is a self-contained subtree

const files = []
function walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (p === excl || p.startsWith(excl + sep)) continue
    if (e.isDirectory()) walk(p)
    else if (/\.(?:js|cjs|mjs)$/u.test(e.name)) files.push(p)
  }
}
walk(root)

const re = /(?:^|[;\s}])(?:import|export)\s+(?:[^'"]*?\s+from\s+)?['"]([^'".][^'"]*)['"]|require\(\s*['"]([^'"]+)['"]\s*\)|import\(\s*['"]([^'".][^'"]*)['"]\s*\)/gu
const missing = new Map() // pkg -> { count, importers:Set, spec }
function pkgName(spec) {
  if (spec.startsWith('@')) { const [a, b] = spec.split('/'); return `${a}/${b ?? ''}` }
  return spec.split('/')[0]
}
function resolvable(fromFile, pkg) {
  let dir = dirname(fromFile)
  while (true) {
    if (existsSync(join(dir, 'node_modules', pkg, 'package.json'))) return true
    const parent = dirname(dir)
    if (parent === dir || dir.length <= root.length) break
    dir = parent
  }
  if (existsSync(join(root, 'node_modules', pkg, 'package.json'))) return true
  return false
}
for (const f of files) {
  let src
  try { src = readFileSync(f, 'utf8') } catch { continue }
  for (const m of src.matchAll(re)) {
    const spec = m[1] ?? m[2] ?? m[3]
    if (!spec || spec.startsWith('.') || spec.startsWith('/') || /^[a-zA-Z]:/u.test(spec)) continue
    if (spec === 'electron' || spec.startsWith('node:') || /^(?:assert|buffer|child_process|cluster|console|crypto|dgram|dns|events|fs|http|http2|https|net|os|path|process|querystring|readline|repl|stream|string_decoder|timers|tls|tty|url|util|vm|worker_threads|zlib|module|sys|v8|inspector|async_hooks|perf_hooks|diagnostics_channel|domain|punycode)(?:\/|$)/u.test(spec)) continue
    const pkg = pkgName(spec)
    if (!resolvable(f, pkg)) {
      const rec = missing.get(pkg) ?? { count: 0, importers: new Set() }
      rec.count++
      if (rec.importers.size < 3) rec.importers.add(f.replace(root + sep, ''))
      missing.set(pkg, rec)
    }
  }
}
const rows = [...missing.entries()].sort((a, b) => b[1].count - a[1].count)
console.log(`scanned ${files.length} js files (excluding \\dsh subtree)`)
console.log(` MISSING packages at shell root: ${rows.length}`)
for (const [pkg, rec] of rows) {
  console.log(`\n${pkg}  (${rec.count} imports)`)
  for (const i of rec.importers) console.log(`   <- ${i}`)
}
