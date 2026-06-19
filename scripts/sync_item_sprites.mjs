#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { dirname, join } from 'node:path'
import { pipeline } from 'node:stream/promises'

const ITEM_MAP_URL = 'https://raw.githubusercontent.com/msikma/pokesprite/master/data/item-map.json'
const SPRITE_BASE_URL = 'https://raw.githubusercontent.com/msikma/pokesprite/master/items'
const OUT_DIR = 'public/item-sprites'
const MANIFEST_PATH = 'data/itemSpriteManifest.json'
const CONCURRENCY = 16

const slugify = (value) => String(value ?? '')
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/['’]/g, '')
  .replace(/&/g, ' and ')
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')

const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'))

const fetchJson = async (url) => {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`)
  return response.json()
}

const itemMap = await fetchJson(ITEM_MAP_URL)

const TYPE_SLUGS = {
  Normal: 'normal', Fighting: 'fighting', Flying: 'flying', Poison: 'poison', Ground: 'ground', Rock: 'rock',
  Bug: 'bug', Ghost: 'ghost', Steel: 'steel', Fire: 'fire', Water: 'water', Grass: 'grass', Electric: 'electric',
  Psychic: 'psychic', Ice: 'ice', Dragon: 'dragon', Dark: 'dark', Fairy: 'fairy',
}

// item-map.json only lists sprites that correspond to a concrete game item ID.
// PokéSprite also ships complete type-colored TM/TR discs, which PTU needs for
// older TM lists such as TM 15 - Hyper Beam (Normal) and TM 55 - Scald (Water).
const EXTRA_SPRITE_PATHS = [
  ...Object.values(TYPE_SLUGS).flatMap((type) => [`tm/${type}`, `tr/${type}`]),
  ...['normal', 'fighting', 'flying', 'water'].map((type) => `hm/${type}`),
]

const spritePaths = [...new Set([...Object.values(itemMap), ...EXTRA_SPRITE_PATHS])].sort()
const pathSet = new Set(spritePaths)

const referenceItems = Object.values(await readJson('data/reference/items.json'))
const referenceMoves = Object.values(await readJson('data/reference/moves.json'))
const moveBySlug = new Map(referenceMoves.map((move) => [slugify(move.name), move]))

const PLATE_BY_TYPE = {
  Fire: 'flame', Water: 'splash', Electric: 'zap', Grass: 'meadow', Ice: 'icicle', Fighting: 'fist',
  Poison: 'toxic', Ground: 'earth', Flying: 'sky', Psychic: 'mind', Bug: 'insect', Rock: 'stone',
  Ghost: 'spooky', Dragon: 'draco', Dark: 'dread', Steel: 'iron', Fairy: 'pixie',
}

const TYPE_BOOSTER_BY_TYPE = {
  Normal: 'hold-item/silk-scarf',
  Fire: 'hold-item/charcoal',
  Water: 'hold-item/mystic-water',
  Electric: 'hold-item/magnet',
  Grass: 'hold-item/miracle-seed',
  Ice: 'hold-item/never-melt-ice',
  Fighting: 'hold-item/black-belt',
  Poison: 'hold-item/poison-barb',
  Ground: 'hold-item/soft-sand',
  Flying: 'hold-item/sharp-beak',
  Psychic: 'hold-item/twisted-spoon',
  Bug: 'hold-item/silver-powder',
  Rock: 'hold-item/hard-stone',
  Ghost: 'hold-item/spell-tag',
  Dragon: 'hold-item/dragon-fang',
  Dark: 'hold-item/black-glasses',
  Steel: 'hold-item/metal-coat',
  Fairy: 'plate/pixie',
}

const TYPE_ITEM_VARIANT_RE = new RegExp(`^(${Object.keys(TYPE_SLUGS).join('|')})\\s+Type\\s+(Gem|Plate|Booster|Brace)$`, 'i')

const toCanonicalTypeName = (value) => value[0].toUpperCase() + value.slice(1).toLowerCase()

const typeVariantPath = (label) => {
  const match = String(label ?? '').match(TYPE_ITEM_VARIANT_RE)
  if (!match) return null

  const type = toCanonicalTypeName(match[1])
  const kind = match[2].toLowerCase()
  if (kind === 'gem') return `gem/${TYPE_SLUGS[type]}`
  if (kind === 'plate') {
    const plate = PLATE_BY_TYPE[type]
    return plate ? `plate/${plate}` : null
  }
  if (kind === 'booster') return TYPE_BOOSTER_BY_TYPE[type] ?? null
  return null
}

const STAT_ITEM_BY_ALIAS = {
  'attack choice item': 'hold-item/choice-band',
  'special attack choice item': 'hold-item/choice-specs',
  'speed choice item': 'hold-item/choice-scarf',
  'accuracy choice item': 'hold-item/wide-lens',
  'evasion choice item': 'hold-item/bright-powder',
  'attack lagging item': 'hold-item/lagging-tail',
  'defense lagging item': 'hold-item/lagging-tail',
  'special attack lagging item': 'hold-item/lagging-tail',
  'special defense lagging item': 'hold-item/lagging-tail',
  'speed lagging item': 'hold-item/lagging-tail',
  'accuracy lagging item': 'hold-item/lagging-tail',
  'evasion lagging item': 'hold-item/lagging-tail',
  'attack stat booster': 'ev-item/power-bracer',
  'defense stat booster': 'ev-item/power-belt',
  'special attack stat booster': 'ev-item/power-lens',
  'special defense stat booster': 'ev-item/power-band',
  'speed stat booster': 'ev-item/power-anklet',
  'accuracy stat booster': 'hold-item/wide-lens',
  'evasion stat booster': 'hold-item/bright-powder',
}

const MANUAL_PATHS = {
  'Basic Ball': 'ball/poke',
  'Poké Ball': 'ball/poke',
  'Poke Ball': 'ball/poke',
  'X Defend': 'battle-item/x-defense',
  'X Special': 'battle-item/x-sp-atk',
  'X Sp. Def': 'battle-item/x-sp-def',
  'Guard Spec': 'battle-item/guard-spec',
  'Enriched Water': 'medicine/fresh-water',
  'Shuckle’s Berry Juice': 'medicine/berry-juice',
  "Shuckle's Berry Juice": 'medicine/berry-juice',
  'Super Soda Pop': 'medicine/soda-pop',
  'Sparkling Lemonade': 'medicine/lemonade',
  'Candy Bar': 'medicine/rage-candy-bar',
  'Honey': 'other-item/honey',
  'Mental Herb': 'hold-item/mental-herb',
  'Power Herb': 'hold-item/power-herb',
  'White Herb': 'hold-item/white-herb',
  'Deepseascale/Deepseatooth': 'evo-item/deep-sea-scale',
  'Deepseascale': 'evo-item/deep-sea-scale',
  'Deepseatooth': 'evo-item/deep-sea-tooth',
  'Dowsing Rod': 'key-item/dowsing-machine',
  'Fishing Rod': 'key-item/fishing-rod',
  'Poffin Mixer': 'key-item/poffin-case',
  'Poké Ball Tool Box': 'key-item/apricorn-box',
  'Poke Ball Tool Box': 'key-item/apricorn-box',
  'Portable Grower / Berry Planter': 'key-item/berry-pots',
  'Portable Grower': 'key-item/berry-pots',
  'Berry Planter': 'key-item/berry-pots',
  'Shards': 'shard/red',
  'Cleanse Tags': 'hold-item/cleanse-tag',
  'Mega Ring': 'key-item/mega-ring',
  'Go-Goggles': 'key-item/go-goggles',
  'Rare Leek': 'hold-item/stick',
  'Pink Pearl': 'valuable-item/pearl',
  'Choice Item': 'hold-item/choice-band',
  'Lagging Item': 'hold-item/lagging-tail',
  'Stat Boosters': 'ev-item/power-bracer',
  'Type Gem': 'gem/normal',
  'Type Plate': 'plate/flame',
  'Mega Stone': 'mega-stone/gengarite',
  'Mulch': 'mulch/growth',
  'Magic Flute': 'key-item/poke-flute',
  'Heart Scale': 'other-item/heart-scale',
  'Rare Candy': 'medicine/rare-candy',
  'Stat Suppressants': 'medicine/heal-powder',
  'HP Up': 'medicine/hp-up',
  'PP Up': 'medicine/pp-up',
}

const addIfPathExists = (manifest, key, path) => {
  if (!key || !path || !pathSet.has(path)) return false
  manifest[slugify(key)] = `/item-sprites/${path}.png`
  return true
}

const pathFromName = (name) => {
  const slug = slugify(name)
  const direct = spritePaths.find((path) => slugify(path.split('/').at(-1)) === slug)
  if (direct) return direct
  const full = spritePaths.find((path) => slugify(path) === slug)
  if (full) return full
  return null
}

const pokeballPath = (item) => {
  if (!item.categories?.includes('Poké Ball')) return null
  if (item.name === 'Basic Ball') return 'ball/poke'
  const match = item.name.match(/^(.+?)\s+Ball$/i)
  if (!match) return null
  const path = `ball/${slugify(match[1])}`
  return pathSet.has(path) ? path : null
}

const apricornPath = (item) => {
  if (!item.categories?.includes('Apricorn')) return null
  const match = item.name.match(/^(Red|Blue|Yellow|Green|Pink|White|Black)\s+Apricorns?$/i)
  if (!match) return null
  const path = `apricorn/${slugify(match[1])}`
  return pathSet.has(path) ? path : null
}

const tmHmPath = (item) => {
  if (!item.categories?.some((category) => category === 'TM' || category === 'HM')) return null
  const isHm = item.categories.includes('HM')
  const moveName = item.name.replace(/^TM\s*\d+\s*-\s*/i, '').replace(/^HM\s*A?\d+\s*-\s*/i, '').trim()
  const move = moveBySlug.get(slugify(moveName))
  const typeSlug = move?.type ? TYPE_SLUGS[move.type] : null
  if (!typeSlug) return isHm ? 'hm/normal' : 'tm/normal'
  const path = `${isHm ? 'hm' : 'tm'}/${typeSlug}`
  return pathSet.has(path) ? path : null
}

const inferReferencePath = (item) => {
  const labels = [item.name, ...(item.aliases ?? [])]

  for (const label of labels) {
    const typePath = typeVariantPath(label)
    if (typePath && pathSet.has(typePath)) return typePath
  }

  for (const value of labels) {
    const manual = MANUAL_PATHS[value]
    if (manual && pathSet.has(manual)) return manual
  }

  const categoryPath = pokeballPath(item) ?? apricornPath(item) ?? tmHmPath(item)
  if (categoryPath) return categoryPath

  const direct = pathFromName(item.name)
  if (direct) return direct

  for (const label of labels) {
    const labelSlug = slugify(label)
    const statAlias = STAT_ITEM_BY_ALIAS[labelSlug.replace(/-/g, ' ')]
    if (statAlias && pathSet.has(statAlias)) return statAlias

    const labelDirect = pathFromName(label)
    if (labelDirect) return labelDirect
  }

  return null
}

const manifest = {}

// Generic PokéSprite lookups by sprite path and common in-game display names.
for (const path of spritePaths) {
  const [group, stem] = path.split('/')
  addIfPathExists(manifest, stem, path)
  addIfPathExists(manifest, path.replace('/', ' '), path)

  if (group === 'ball') addIfPathExists(manifest, `${stem} ball`, path)
  if (group === 'berry') addIfPathExists(manifest, `${stem} berry`, path)
  if (group === 'apricorn') {
    addIfPathExists(manifest, `${stem} apricorn`, path)
    addIfPathExists(manifest, `${stem} apricorns`, path)
  }
  if (group === 'shard') {
    addIfPathExists(manifest, `${stem} shard`, path)
    addIfPathExists(manifest, `${stem} shards`, path)
  }
  if (group === 'scarf') addIfPathExists(manifest, `${stem} scarf`, path)
  if (group === 'incense') addIfPathExists(manifest, `${stem} incense`, path)
  if (group === 'mulch') addIfPathExists(manifest, `${stem} mulch`, path)
  if (group === 'flute') addIfPathExists(manifest, `${stem} flute`, path)
  if (group === 'petal') addIfPathExists(manifest, `${stem} petal`, path)
}

// Type-specific aliases used by PTU generic item rows.
for (const [type, typeSlug] of Object.entries(TYPE_SLUGS)) {
  addIfPathExists(manifest, `${type} Type Gem`, `gem/${typeSlug}`)
  addIfPathExists(manifest, `${type} Gem`, `gem/${typeSlug}`)
  addIfPathExists(manifest, `${type} Type Booster`, TYPE_BOOSTER_BY_TYPE[type])
  const plate = PLATE_BY_TYPE[type]
  if (plate) addIfPathExists(manifest, `${type} Type Plate`, `plate/${plate}`)
}
for (const [alias, path] of Object.entries(STAT_ITEM_BY_ALIAS)) addIfPathExists(manifest, alias, path)
for (const [name, path] of Object.entries(MANUAL_PATHS)) addIfPathExists(manifest, name, path)

// Canonical PTU item names and aliases.
let matchedReferenceItems = 0
for (const item of referenceItems) {
  const path = inferReferencePath(item)
  if (!path) continue
  matchedReferenceItems++
  addIfPathExists(manifest, item.name, typeVariantPath(item.name) ?? path)
  for (const alias of item.aliases ?? []) addIfPathExists(manifest, alias, typeVariantPath(alias) ?? path)
}

const orderedManifest = Object.fromEntries(Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b)))
await mkdir(dirname(MANIFEST_PATH), { recursive: true })
await writeFile(MANIFEST_PATH, `${JSON.stringify(orderedManifest, null, 2)}\n`)

const downloadOne = async (path) => {
  const outPath = join(OUT_DIR, `${path}.png`)
  await mkdir(dirname(outPath), { recursive: true })

  const response = await fetch(`${SPRITE_BASE_URL}/${path}.png`)
  if (!response.ok || !response.body) throw new Error(`Failed to fetch sprite ${path}: ${response.status}`)
  await pipeline(response.body, createWriteStream(outPath))
}

let nextIndex = 0
let downloaded = 0
const workers = Array.from({ length: CONCURRENCY }, async () => {
  while (nextIndex < spritePaths.length) {
    const path = spritePaths[nextIndex++]
    await downloadOne(path)
    downloaded++
    if (downloaded % 100 === 0 || downloaded === spritePaths.length) {
      process.stdout.write(`Downloaded ${downloaded}/${spritePaths.length} item sprites\n`)
    }
  }
})
await Promise.all(workers)

console.log(`Wrote ${MANIFEST_PATH} with ${Object.keys(orderedManifest).length} lookup keys.`)
console.log(`Matched ${matchedReferenceItems}/${referenceItems.length} PTU item rows.`)
