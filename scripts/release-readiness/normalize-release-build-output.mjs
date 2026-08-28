#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import process from 'node:process'

const ROOT = resolve(import.meta.dirname, '../..')
const ASSET_DECLARATION = '\nconst assets = '

const fail = message => { throw new Error(message) }
const compareCodePoints = (left, right) => left < right ? -1 : left > right ? 1 : 0

export function sourceDateStamp(sourceDateEpoch) {
  if (!/^\d+$/u.test(sourceDateEpoch ?? '')) fail('Release output normalization requires an integer SOURCE_DATE_EPOCH.')
  const seconds = Number(sourceDateEpoch)
  if (!Number.isSafeInteger(seconds) || seconds < 0) fail('SOURCE_DATE_EPOCH is outside the supported integer range.')
  const date = new Date(seconds * 1_000)
  if (Number.isNaN(date.getTime())) fail('SOURCE_DATE_EPOCH does not identify a valid date.')
  return date.toISOString()
}

function jsonObjectEnd(source, start) {
  if (source[start] !== '{') return -1
  let depth = 0
  let inString = false
  let escaped = false
  for (let index = start; index < source.length; index += 1) {
    const character = source[index]
    if (inString) {
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === '"') inString = false
      continue
    }
    if (character === '"') inString = true
    else if (character === '{') depth += 1
    else if (character === '}') {
      depth -= 1
      if (depth === 0) return index + 1
      if (depth < 0) return -1
    }
  }
  return -1
}

function isPublicAssetMap(value) {
  const entries = value && typeof value === 'object' && !Array.isArray(value)
    ? Object.entries(value)
    : []
  return entries.length > 0 && entries.every(([key, metadata]) => (
    key.startsWith('/')
    && metadata
    && typeof metadata === 'object'
    && !Array.isArray(metadata)
    && typeof metadata.etag === 'string'
    && typeof metadata.mtime === 'string'
    && typeof metadata.path === 'string'
    && typeof metadata.size === 'number'
  ))
}

export function normalizeNitroBundle(source, stamp) {
  const candidates = []
  let cursor = 0
  while (true) {
    const declaration = source.indexOf(ASSET_DECLARATION, cursor)
    if (declaration < 0) break
    const start = declaration + ASSET_DECLARATION.length
    const end = jsonObjectEnd(source, start)
    if (end > start) {
      try {
        const value = JSON.parse(source.slice(start, end))
        if (isPublicAssetMap(value)) candidates.push({ start, end, value })
      }
      catch {
        // Other bundled variables named `assets` are not necessarily JSON.
      }
    }
    cursor = Math.max(start + 1, end)
  }
  if (candidates.length !== 1) fail(`Expected exactly one Nitro public-asset map, found ${candidates.length}.`)

  const [{ start, end, value }] = candidates
  const normalized = Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => compareCodePoints(left, right))
      .map(([key, metadata]) => [key, { ...metadata, mtime: stamp }]),
  )
  const normalizedJson = JSON.stringify(normalized, null, 2)
  return {
    source: `${source.slice(0, start)}${normalizedJson}${source.slice(end)}`,
    publicAssetCount: Object.keys(normalized).length,
  }
}

export function normalizeReleaseBuildOutput({ outputDirectory, sourceDateEpoch }) {
  const stamp = sourceDateStamp(sourceDateEpoch)
  const outputRoot = resolve(outputDirectory)
  const nitroMetadataPath = resolve(outputRoot, 'nitro.json')
  const nitroBundlePath = resolve(outputRoot, 'server/chunks/nitro/nitro.mjs')
  for (const path of [nitroMetadataPath, nitroBundlePath]) {
    if (!existsSync(path)) fail(`Release output normalization input is missing: ${path}`)
  }

  const nitroMetadata = JSON.parse(readFileSync(nitroMetadataPath, 'utf8'))
  if (!nitroMetadata || typeof nitroMetadata !== 'object' || typeof nitroMetadata.date !== 'string') {
    fail('Nitro metadata does not contain its generated date field.')
  }
  nitroMetadata.date = stamp

  const normalizedBundle = normalizeNitroBundle(readFileSync(nitroBundlePath, 'utf8'), stamp)
  writeFileSync(nitroMetadataPath, `${JSON.stringify(nitroMetadata, null, 2)}\n`)
  writeFileSync(nitroBundlePath, normalizedBundle.source)

  return { sourceDateStamp: stamp, publicAssetCount: normalizedBundle.publicAssetCount }
}

export function main() {
  if (process.argv.length !== 2) fail('Release output normalization accepts no arguments.')
  if (process.env.ROTOM_RELEASE_BUILD !== '1') {
    process.stdout.write('Skipped deterministic output normalization for a non-release build.\n')
    return
  }
  const result = normalizeReleaseBuildOutput({
    outputDirectory: resolve(ROOT, '.output'),
    sourceDateEpoch: process.env.SOURCE_DATE_EPOCH?.trim(),
  })
  process.stdout.write(`Normalized ${result.publicAssetCount} Nitro public assets to ${result.sourceDateStamp}.\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    main()
  }
  catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
