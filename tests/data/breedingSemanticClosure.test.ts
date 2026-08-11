import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { stableJsonStringify } from '../../shared/automation/stableJson'
import { POKEMON_EGG_SOURCE_KINDS, POKEMON_EGG_STATUSES } from '../../shared/breeding/egg'
import {
  BREEDING_OPERATION_COMMAND_KINDS,
  BREEDING_OPERATION_OUTCOME_KINDS,
  BREEDING_OPERATION_SCOPE_KINDS,
} from '../../shared/breeding/operations'
import { BREEDING_PROJECT_STATUSES } from '../../shared/breeding/project'
import { BREEDING_PROJECTION_AUDIENCES } from '../../shared/breeding/projections'

const ROOT = resolve(import.meta.dirname, '../..')
const readJson = <T>(path: string): T => JSON.parse(readFileSync(resolve(ROOT, path), 'utf8')) as T
const hash = (value: unknown): string => createHash('sha256').update(stableJsonStringify(value)).digest('hex')
const listJson = (directory: string): string[] => readdirSync(directory, { withFileTypes: true })
  .flatMap(entry => entry.isDirectory()
    ? listJson(join(directory, entry.name))
    : entry.isFile() && entry.name.endsWith('.json') ? [join(directory, entry.name)] : [])
  .map(path => relative(ROOT, path).replaceAll('\\', '/'))
  .sort()

const manifest = readJson<Record<string, any>>('data/breeding-automation/semantic-closure-manifest.json')
const registry = readJson<Record<string, any>>('data/breeding-automation/semantic-registry.json')
const compiled = readJson<Record<string, any>>('data/breeding-automation/compiled-registry.json')
const modifiers = readJson<Record<string, any>>('data/breeding-automation/modifier-inventory.json')

describe('breeding semantic closure manifest', () => {
  it('self-hashes and accounts for every breeding JSON artifact exactly once', () => {
    expect(manifest).toMatchObject({
      schemaVersion: 1,
      manifestId: 'ptu-1.05-breeding-semantic-closure-v1',
      rulesetId: 'ptu-1.05-breeding-v1',
      definitionSha256: hash(manifest.definition),
    })
    expect(manifest.definition).toMatchObject({ ticket: 'BR-080', status: 'strict-closed' })
    expect(registry.definition.artifacts).toHaveLength(106)
    expect(manifest.definition.semanticRegistry.expectedArtifactCountIncludingThisManifest).toBe(106)

    const artifactIds = registry.definition.artifacts.map((artifact: any) => artifact.id)
    const artifactPaths = registry.definition.artifacts.map((artifact: any) => artifact.path)
    expect(new Set(artifactIds).size).toBe(artifactIds.length)
    expect(new Set(artifactPaths).size).toBe(artifactPaths.length)
    const expectedDataPaths = artifactPaths
      .filter((path: string) => path.startsWith('data/breeding-automation/') && path.endsWith('.json'))
      .concat('data/breeding-automation/semantic-registry.json')
      .sort()
    expect(listJson(resolve(ROOT, 'data/breeding-automation'))).toEqual(expectedDataPaths)
  })

  it('equals every closed runtime enum and compiled spec identity without fallback rows', () => {
    expect(manifest.definition.breedingSpecs).toMatchObject({
      compiledRegistryDefinitionSha256: compiled.definitionSha256,
      familyCount: compiled.familySpecs.length,
      speciesCount: compiled.speciesSpecs.length,
      producibleSpeciesCount: compiled.speciesSpecs.filter((row: any) => row.speciesId !== 'ditto').length,
      unknownOrIncompleteSpecPolicy: 'fail-closed-not-emitted',
    })
    expect(manifest.definition.projects.statuses).toEqual(BREEDING_PROJECT_STATUSES)
    expect(manifest.definition.eggs.statuses).toEqual(POKEMON_EGG_STATUSES)
    expect(manifest.definition.eggs.sourceKinds).toEqual(POKEMON_EGG_SOURCE_KINDS)
    expect(manifest.definition.operations.commandKinds).toEqual(BREEDING_OPERATION_COMMAND_KINDS)
    expect(manifest.definition.operations).toMatchObject({
      resilienceCertificationOwner: 'BR-083',
      resilienceCertificationStatus: 'certified-current-semantics',
      archiveReleaseCertificationOwner: 'BR-085',
      archiveReleaseCertificationStatus: 'certified-current-archive-and-repair-semantics',
      artifactIds: expect.arrayContaining([
        'breeding-resilience-certification',
        'breeding-archive-release-certification',
      ]),
    })
    expect(manifest.definition.operations.outcomeCount).toBe(BREEDING_OPERATION_OUTCOME_KINDS.length)
    expect(manifest.definition.operations.scopeCount).toBe(BREEDING_OPERATION_SCOPE_KINDS.length)
    expect(manifest.definition.projections.audiences).toEqual(BREEDING_PROJECTION_AUDIENCES)
    expect(manifest.definition.projections).toMatchObject({
      securityCertificationOwner: 'BR-084',
      securityCertificationStatus: 'certified-current-information-flow',
      artifactIds: expect.arrayContaining(['breeding-security-certification']),
    })
    expect(manifest.definition.operations.unparameterizedOrUnknownCommandPolicy).toBe('reject')
    expect(manifest.definition.eggs.preHatchSheetInventoryOrMapAuthority).toBe('forbidden')
  })

  it('closes all declared artifact, provider, projection route, and runtime-path identities', () => {
    const registeredIds = new Set(registry.definition.artifacts.map((artifact: any) => artifact.id))
    const sections = [
      manifest.definition.breedingSpecs,
      manifest.definition.projects,
      manifest.definition.eggs,
      manifest.definition.operations,
      manifest.definition.projections,
      manifest.definition.interactions,
    ]
    for (const section of sections) {
      expect(new Set(section.artifactIds).size).toBe(section.artifactIds.length)
      expect(section.artifactIds.every((id: string) => registeredIds.has(id))).toBe(true)
      expect(section.runtimePaths.every((path: string) => existsSync(resolve(ROOT, path)))).toBe(true)
    }
    expect(manifest.definition.projections.apiRoutes).toHaveLength(7)
    expect(manifest.definition.projections.apiRouteFiles).toHaveLength(7)
    expect(manifest.definition.projections.apiRouteFiles.every((path: string) => existsSync(resolve(ROOT, path)))).toBe(true)
    expect(manifest.definition.interactions).toMatchObject({
      inventoryId: modifiers.inventoryId,
      inventoryDefinitionSha256: modifiers.definitionSha256,
      entryCount: modifiers.entryCount,
      entryIds: modifiers.definition.entries.map((entry: any) => entry.id),
      certificationOwner: 'BR-082',
      certificationStatus: 'certified-current-semantics',
      artifactIds: expect.arrayContaining(['breeding-interaction-certification']),
      unknownInteractionPolicy: 'fail-closed-unavailable',
    })
  })
})
