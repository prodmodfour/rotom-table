import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { buildLegacyMoveAutomationAudit } from './move_automation_legacy_audit'
import {
  assertLegacyMoveAutomationFingerprintIndexCurrent,
  assertLegacyMoveAutomationManifestLinksCurrent,
  buildLegacyMoveAutomationFingerprintIndex,
  linkLegacyMoveAutomationManifest,
} from './move_automation_legacy_manifest_links'

const DEFAULT_MANIFEST_PATH = 'data/move-automation/manifest.json'
const DEFAULT_FINGERPRINT_PATH = 'data/move-automation/legacy-v1-fingerprints.json'

const usage = (): string => [
  'Usage: npm run link:move-automation-legacy -- [--check] [--manifest PATH] [--fingerprints PATH]',
  '',
  '  --check              Verify committed links without writing files.',
  '  --manifest PATH      Manifest to link (defaults to data/move-automation/manifest.json).',
  '  --fingerprints PATH  Fingerprint index to write/check.',
].join('\n')

interface Options {
  readonly check: boolean
  readonly manifestPath: string
  readonly fingerprintPath: string
}

const parseOptions = (args: readonly string[]): Options => {
  let check = false
  let manifestPath = DEFAULT_MANIFEST_PATH
  let fingerprintPath = DEFAULT_FINGERPRINT_PATH
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--check') {
      check = true
      continue
    }
    if (argument === '--manifest' || argument === '--fingerprints') {
      const path = args[index + 1]
      if (!path) throw new Error(`${argument} requires a path.\n${usage()}`)
      if (argument === '--manifest') manifestPath = path
      else fingerprintPath = path
      index += 1
      continue
    }
    if (argument === '--help') {
      console.log(usage())
      process.exit(0)
    }
    throw new Error(`Unknown argument ${JSON.stringify(argument)}.\n${usage()}`)
  }
  return { check, manifestPath, fingerprintPath }
}

const readJson = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'))
const jsonBytes = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`

const run = (args: readonly string[]): void => {
  const options = parseOptions(args)
  const manifestPath = resolve(options.manifestPath)
  const fingerprintPath = resolve(options.fingerprintPath)
  const manifest = readJson(manifestPath)
  const fingerprints = buildLegacyMoveAutomationFingerprintIndex(
    buildLegacyMoveAutomationAudit(),
  )

  if (options.check) {
    assertLegacyMoveAutomationFingerprintIndexCurrent(
      readJson(fingerprintPath),
      fingerprints,
    )
    assertLegacyMoveAutomationManifestLinksCurrent(manifest, fingerprints)
    console.log(`Legacy v1 manifest links valid: ${fingerprints.entries.length} fingerprints.`)
    return
  }

  const linkedManifest = linkLegacyMoveAutomationManifest(manifest, fingerprints)
  writeFileSync(fingerprintPath, jsonBytes(fingerprints), 'utf8')
  writeFileSync(manifestPath, jsonBytes(linkedManifest), 'utf8')
  console.log(`Linked ${fingerprints.entries.length} legacy v1 implementation fingerprints.`)
}

try {
  run(process.argv.slice(2))
}
catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
