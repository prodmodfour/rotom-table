#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import process from 'node:process'

const ROOT = resolve(import.meta.dirname, '../..')
const OUTPUT = resolve(ROOT, 'data/release-readiness/documentary-read-proof.v1.json')
const SOURCE_ROOTS = ['server', 'shared', 'src']
const ROOT_FILES = ['nuxt.config.ts']
const FORBIDDEN = ['books', 'ptu-data', 'encounter_tables', 'notepad', 'pokesheet.pdf']
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.vue'])
const sha256 = value => createHash('sha256').update(value).digest('hex')
const extension = path => path.slice(path.lastIndexOf('.'))
const files = []
const visit = path => {
  const stat = statSync(path)
  if (stat.isDirectory()) {
    for (const name of readdirSync(path).sort()) visit(join(path, name))
  } else if (SOURCE_EXTENSIONS.has(extension(path))) files.push(path)
}
for (const root of SOURCE_ROOTS) visit(resolve(ROOT, root))
for (const file of ROOT_FILES) files.push(resolve(ROOT, file))
files.sort()

const violations = []
for (const path of files) {
  const source = readFileSync(path, 'utf8')
  const relativePath = relative(ROOT, path)
  const imports = [...source.matchAll(/(?:from\s*|import\s*\(|require\s*\()\s*['"]([^'"]+)['"]/gu)].map(match => match[1])
  for (const imported of imports) {
    if (FORBIDDEN.some(root => imported === root || imported.startsWith(`${root}/`) || imported.includes(`/${root}/`))) {
      violations.push(`${relativePath}: imports documentary source ${imported}`)
    }
  }
  const hasDocumentaryLiteral = FORBIDDEN.some(root => source.includes(`'${root}`) || source.includes(`"${root}`) || source.includes(`, '${root}`) || source.includes(`, "${root}`))
  const hasFilesystemOrProcessRead = /from ['"]node:(?:fs|child_process)['"]|require\(['"]node:(?:fs|child_process)['"]\)/u.test(source)
  if (hasDocumentaryLiteral && hasFilesystemOrProcessRead) {
    violations.push(`${relativePath}: combines a documentary path with filesystem/process access`)
  }
}
if (existsSync(resolve(ROOT, 'server/api/pokedex/restore-from-books.post.ts'))) {
  violations.push('server/api/pokedex/restore-from-books.post.ts: retired documentary restore route still exists')
}

const traceIndex = process.argv.indexOf('--trace')
if (traceIndex >= 0) {
  const tracePath = process.argv[traceIndex + 1]
  if (!tracePath) violations.push('--trace requires a strace output path')
  else {
    const trace = readFileSync(resolve(tracePath), 'utf8')
    for (const root of FORBIDDEN) {
      const documentaryPath = resolve(ROOT, root)
      if (trace.includes(documentaryPath)) violations.push(`runtime opened documentary path: ${documentaryPath}`)
    }
  }
}
if (violations.length) {
  for (const violation of violations) process.stderr.write(`ERROR: ${violation}\n`)
  process.exit(1)
}
const graphLines = files.map(path => `${relative(ROOT, path)}\0${sha256(readFileSync(path))}`)
const artifact = {
  artifact: 'release-production-documentary-read-proof',
  schemaVersion: 1,
  status: 'Certified',
  productionRoots: SOURCE_ROOTS,
  rootFiles: ROOT_FILES,
  forbiddenDocumentaryRoots: FORBIDDEN,
  productionSourceFiles: files.length,
  productionSourceGraphSha256: sha256(graphLines.join('\n')),
  staticViolations: 0,
  runtimeProbe: traceIndex >= 0 ? 'passed' : 'checked-separately-by-registered-command',
  retiredRuntimeSeam: '/api/pokedex/restore-from-books',
  allowedProvenanceMetadata: 'Path labels in immutable app-owned registries and source comments are allowed only when no production filesystem/process reader is colocated.',
  command: 'npm run check:release-readiness:documentary-reads',
}
const serialized = `${JSON.stringify(artifact, null, 2)}\n`
if (process.argv.includes('--write')) {
  writeFileSync(OUTPUT, serialized)
  process.stdout.write(`Wrote documentary-read proof for ${files.length} production source files.\n`)
} else if (process.argv.includes('--check')) {
  if (!existsSync(OUTPUT) || readFileSync(OUTPUT, 'utf8') !== serialized) {
    process.stderr.write('Production documentary-read proof drifted; review and regenerate it.\n')
    process.exitCode = 1
  } else process.stdout.write(`Static documentary-read proof passed for ${files.length} production source files.\n`)
} else {
  process.stdout.write(`Documentary-read scan passed for ${files.length} production source files${traceIndex >= 0 ? ' and runtime trace' : ''}.\n`)
}
