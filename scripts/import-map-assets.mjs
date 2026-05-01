#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, copyFileSync, writeFileSync } from 'node:fs'
import { basename, extname, join, relative, resolve } from 'node:path'

const root = process.cwd()
const assetRoot = resolve(root, 'public/assets/map')
const allowedExt = new Set(['.svg', '.png', '.webp', '.jpg', '.jpeg'])
const categories = new Set(['props', 'decals', 'materials', 'icons'])

const usage = () => {
  console.log(`Usage:
  node scripts/import-map-assets.mjs --pack <pack> --from <folder> [--category props|decals|materials|icons]
       [--source-name <name>] [--source-url <url>] [--license <license>] [--notes <text>]
       [--allow-overwrite]

Copies local SVG/PNG/WebP/JPG files into public/assets/map/<pack>/<category>/,
normalizes filenames, and updates manifest.json. Remote runtime dependencies are
never added; download/extract packs first, then point --from at the folder.`)
}

const parseArgs = () => {
  const args = process.argv.slice(2)
  const out = { allowOverwrite: false }
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    if (arg === '--allow-overwrite') { out.allowOverwrite = true; continue }
    if (!arg.startsWith('--')) throw new Error(`unexpected positional argument: ${arg}`)
    const key = arg.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())
    const value = args[i + 1]
    if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value`)
    out[key] = value
    i += 1
  }
  return out
}

const slugify = (input) => {
  const stem = input.replace(extname(input), '')
  return stem
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_') || 'asset'
}

const titleCase = (id) => id.split(/[_-]+/).filter(Boolean).map((p) => p[0].toUpperCase() + p.slice(1)).join(' ')

const walk = (dir, out = []) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (entry.isFile() && allowedExt.has(extname(entry.name).toLowerCase())) out.push(full)
  }
  return out
}

const inferCategory = (file, fromRoot, explicit) => {
  if (explicit) return explicit
  const parts = relative(fromRoot, file).split(/[\\/]/).map((p) => p.toLowerCase())
  const found = parts.find((part) => categories.has(part))
  return found ?? 'props'
}

const readManifest = (packDir, pack) => {
  const file = join(packDir, 'manifest.json')
  if (!existsSync(file)) {
    return {
      id: pack,
      displayName: titleCase(pack),
      version: 1,
      sources: [],
      materials: {},
      decals: {},
      props: {},
      doors: {},
      icons: {},
    }
  }
  return JSON.parse(readFileSync(file, 'utf8'))
}

const ensureManifestShape = (manifest, pack) => {
  manifest.id ||= pack
  manifest.displayName ||= titleCase(pack)
  manifest.version ||= 1
  manifest.sources ||= []
  manifest.materials ||= {}
  manifest.decals ||= {}
  manifest.props ||= {}
  manifest.doors ||= {}
  manifest.icons ||= {}
  return manifest
}

const uniqueTarget = (dir, stem, ext, allowOverwrite) => {
  let candidate = join(dir, `${stem}${ext}`)
  if (allowOverwrite || !existsSync(candidate)) return candidate
  for (let i = 2; i < 10000; i += 1) {
    candidate = join(dir, `${stem}_${i}${ext}`)
    if (!existsSync(candidate)) return candidate
  }
  throw new Error(`could not allocate filename for ${stem}${ext}`)
}

const addManifestEntry = (manifest, category, id, relPath, ext) => {
  if (category === 'materials') {
    manifest.materials[id] ||= {
      displayName: titleCase(id),
      color: '#808890',
      texture: relPath,
      tags: ['imported'],
    }
  } else if (category === 'decals') {
    manifest.decals[id] ||= {
      displayName: titleCase(id),
      texture: relPath,
      defaultScale: { x: 1, z: 1 },
      tags: ['imported'],
    }
  } else if (category === 'icons') {
    manifest.icons[id] ||= {
      displayName: titleCase(id),
      texture: relPath,
      defaultScale: { x: 1, z: 1 },
      tags: ['imported', 'icon'],
    }
  } else {
    manifest.props[id] ||= {
      displayName: titleCase(id),
      texture: relPath,
      footprint: { x: 1, z: 1 },
      height: 1,
      width: 1,
      anchor: 'bottom-center',
      blocksMovementDefault: false,
      tags: ['imported'],
    }
  }
  manifest[`_${category}ImportNotes`] = `Imported ${ext.slice(1).toUpperCase()} assets; review footprints/blocking/tags before final map generation.`
}

const main = () => {
  const args = parseArgs()
  if (args.help || !args.pack || !args.from) { usage(); process.exit(args.help ? 0 : 1) }
  if (args.category && !categories.has(args.category)) throw new Error(`--category must be one of ${Array.from(categories).join(', ')}`)

  const from = resolve(root, args.from)
  if (!existsSync(from) || !statSync(from).isDirectory()) throw new Error(`--from must be an existing folder: ${from}`)
  const pack = args.pack.trim()
  if (!/^[a-z0-9_-]+$/i.test(pack)) throw new Error('--pack must be a safe folder name')

  const packDir = join(assetRoot, pack)
  mkdirSync(packDir, { recursive: true })
  const manifest = ensureManifestShape(readManifest(packDir, pack), pack)

  const source = {
    name: args.sourceName ?? `Imported local folder ${basename(from)}`,
    url: args.sourceUrl ?? `local://${relative(root, from) || from}`,
    license: args.license ?? 'unspecified - review before redistribution',
  }
  if (args.notes) source.notes = args.notes
  if (!manifest.sources.some((s) => s.name === source.name && s.url === source.url)) manifest.sources.push(source)

  const files = walk(from)
  if (!files.length) throw new Error(`no supported assets found under ${from}`)

  const copied = []
  for (const file of files) {
    const category = inferCategory(file, from, args.category)
    const ext = extname(file).toLowerCase() === '.jpeg' ? '.jpg' : extname(file).toLowerCase()
    const destDir = join(packDir, category)
    mkdirSync(destDir, { recursive: true })
    const stem = slugify(basename(file))
    const target = uniqueTarget(destDir, stem, ext, args.allowOverwrite)
    copyFileSync(file, target)
    const relPath = relative(packDir, target).split(/[\\/]/).join('/')
    const id = slugify(basename(target))
    addManifestEntry(manifest, category, id, relPath, ext)
    copied.push({ file, target, category, id })
  }

  writeFileSync(join(packDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8')
  console.log(`Imported ${copied.length} asset(s) into ${relative(root, packDir)}`)
  for (const item of copied) console.log(`- ${item.category}/${item.id}: ${relative(root, item.target)}`)
  console.log('Review manifest footprints, blocking defaults, tags, and license/source notes before using in maps.')
}

try {
  main()
} catch (err) {
  console.error(`import-map-assets: ${err.message}`)
  process.exit(1)
}
