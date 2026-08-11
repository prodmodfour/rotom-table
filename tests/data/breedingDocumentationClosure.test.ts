import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  BREEDING_DOCUMENTATION_CLOSURE_DEFINITION_SHA256,
  BREEDING_DOCUMENTATION_CLOSURE_V1,
} from '../../scripts/breedingDocumentationClosure'
import { stableJsonStringify } from '../../shared/automation/stableJson'
import { BREEDING_ARCHIVE_MAXIMUM_BYTES } from '../../shared/breeding/archives'
import { BREEDING_CAMPAIGN_CLOCK_EGG_BATCH_MAXIMUM } from '../../shared/breeding/campaignClockBatch'
import { BREEDING_CONSENT_WORKFLOW_API_PATH, BREEDING_CONSENT_WORKFLOW_INTENTS } from '../../shared/breeding/consentWorkflow'
import { POKEMON_EGG_SOURCE_KINDS, POKEMON_EGG_STATUSES } from '../../shared/breeding/egg'
import { BREEDING_HATCH_WORKFLOW_API_PATH, BREEDING_HATCH_WORKFLOW_INTENTS } from '../../shared/breeding/hatchWorkflow'
import { BREEDING_OPERATION_COMMAND_KINDS } from '../../shared/breeding/operations'
import { BREEDING_PROJECT_STATUSES } from '../../shared/breeding/project'
import { BREEDING_PROJECT_CHOICES_API_PATH } from '../../shared/breeding/projectChoices'
import { BREEDING_PROJECT_GUIDANCE_API_PATH } from '../../shared/breeding/projectGuidance'
import {
  BREEDING_PROJECT_WIZARD_ADDITIONAL_MINUTES,
  BREEDING_PROJECT_WIZARD_API_PATH,
  BREEDING_PROJECT_WIZARD_CHECK_DC,
  BREEDING_PROJECT_WIZARD_INITIAL_MINUTES,
} from '../../shared/breeding/projectWizard'
import { BREEDING_PROJECTION_AUDIENCES } from '../../shared/breeding/projections'
import { BREEDING_WORKSHOP_API_PATH } from '../../shared/breeding/workshop'
import { BREEDING_WORKSHOP_ACTIVITY_API_PATH } from '../../shared/breeding/workshopActivity'
import { BREEDING_COMMAND_JSON_MAXIMUM_BYTES } from '../../server/security/breedingRequestBody'
import { LATEST_STORAGE_SCHEMA_VERSION } from '../../server/storage/migrations'

const ROOT = resolve(import.meta.dirname, '../..')
const read = (path: string): string => readFileSync(resolve(ROOT, path), 'utf8')
const sha256 = (value: unknown): string => createHash('sha256')
  .update(stableJsonStringify(value))
  .digest('hex')
const apiPaths = [
  BREEDING_WORKSHOP_API_PATH,
  BREEDING_WORKSHOP_ACTIVITY_API_PATH,
  BREEDING_PROJECT_WIZARD_API_PATH,
  BREEDING_PROJECT_GUIDANCE_API_PATH,
  BREEDING_PROJECT_CHOICES_API_PATH,
  BREEDING_HATCH_WORKFLOW_API_PATH,
  BREEDING_CONSENT_WORKFLOW_API_PATH,
]
const routePaths = [
  'server/api/breeding/workshop.get.ts',
  'server/api/breeding/workshop/activity.get.ts',
  'server/api/breeding/projects/wizard.post.ts',
  'server/api/breeding/projects/wizard/guidance.post.ts',
  'server/api/breeding/projects/wizard/choices.post.ts',
  'server/api/breeding/hatch.post.ts',
  'server/api/breeding/consent.post.ts',
]

describe('BR-088 Breeding documentation closure', () => {
  it('is self-hashed and covers contributor, operator, GM, player, API, data, clock, and QA categories', () => {
    const closure = BREEDING_DOCUMENTATION_CLOSURE_V1
    expect(sha256(closure)).toBe(BREEDING_DOCUMENTATION_CLOSURE_DEFINITION_SHA256)
    expect(closure).toMatchObject({
      schemaVersion: 1,
      closureId: 'ptu-1.05-breeding-documentation-closure-v1',
      ticket: 'BR-088',
    })
    expect(closure.categories.map(value => value.categoryId)).toEqual([
      'contributor',
      'operator',
      'gm',
      'player',
      'api',
      'data-model',
      'campaign-clock',
      'qa',
    ])
    expect(closure.prohibitedAuthorityClaims).toHaveLength(8)
    expect(new Set(closure.requiredCrossLinks).size).toBe(closure.requiredCrossLinks.length)
    expect(closure.requiredCrossLinks.every(path => existsSync(resolve(ROOT, path)))).toBe(true)
  })

  it('requires every reviewed heading and keeps all local Breeding documentation links resolvable', () => {
    for (const category of BREEDING_DOCUMENTATION_CLOSURE_V1.categories) {
      const source = read(category.path)
      for (const heading of category.requiredHeadings) {
        expect(source, `${category.categoryId}: ${heading}`).toContain(heading)
      }
    }

    const allDocumentation = [...new Set(BREEDING_DOCUMENTATION_CLOSURE_V1.categories.map(value => value.path))]
      .map(read)
      .join('\n')
    const links = [...allDocumentation.matchAll(/docs\/breeding\/[a-z0-9-]+\.md/gu)].map(match => match[0])
    expect(links.length).toBeGreaterThanOrEqual(12)
    for (const link of links) expect(existsSync(resolve(ROOT, link)), link).toBe(true)
  })

  it('mirrors every Workshop route, strict request intent, and ingress boundary', () => {
    const api = read('docs/breeding/api-reference.md')
    expect(apiPaths).toHaveLength(BREEDING_DOCUMENTATION_CLOSURE_V1.runtimeBindings.workshopApiCount)
    expect(new Set(apiPaths).size).toBe(apiPaths.length)
    for (const path of apiPaths) expect(api).toContain(path)
    for (const path of routePaths) expect(existsSync(resolve(ROOT, path))).toBe(true)
    for (const intent of BREEDING_HATCH_WORKFLOW_INTENTS) expect(api).toContain(`\`${intent}\``)
    for (const intent of BREEDING_CONSENT_WORKFLOW_INTENTS) expect(api).toContain(`\`${intent}\``)
    expect(BREEDING_COMMAND_JSON_MAXIMUM_BYTES)
      .toBe(BREEDING_DOCUMENTATION_CLOSURE_V1.runtimeBindings.postBodyMaximumUtf8Bytes)
    expect(api).toContain('30 writes per minute')
    expect(api).toContain('120 per minute')
    expect(api).toContain('selectors only')
  })

  it('mirrors aggregate vocabularies, storage version, audiences, and archive limits', () => {
    const model = read('docs/breeding/data-model-and-campaign-clock.md')
    const security = read('docs/breeding/security-and-privacy.md')
    const bindings = BREEDING_DOCUMENTATION_CLOSURE_V1.runtimeBindings
    expect(BREEDING_PROJECT_STATUSES).toHaveLength(bindings.projectStatusCount)
    expect(POKEMON_EGG_STATUSES).toHaveLength(bindings.eggStatusCount)
    expect(POKEMON_EGG_SOURCE_KINDS).toHaveLength(bindings.eggSourceKindCount)
    expect(BREEDING_OPERATION_COMMAND_KINDS).toHaveLength(bindings.commandKindCount)
    expect(BREEDING_PROJECTION_AUDIENCES).toHaveLength(bindings.baseAudienceCount)
    expect(LATEST_STORAGE_SCHEMA_VERSION).toBe(bindings.storageSchemaVersion)
    expect(BREEDING_ARCHIVE_MAXIMUM_BYTES).toBe(bindings.archiveMaximumUtf8Bytes)
    for (const status of [...BREEDING_PROJECT_STATUSES, ...POKEMON_EGG_STATUSES, ...POKEMON_EGG_SOURCE_KINDS]) {
      expect(model).toContain(`\`${status}\``)
    }
    const audienceLabels: Record<(typeof BREEDING_PROJECTION_AUDIENCES)[number], string> = {
      public: 'Public',
      owner: 'Owner',
      'participating-owner': 'Participating owner',
      gm: 'GM',
      diagnostic: 'Diagnostic operator',
    }
    for (const audience of BREEDING_PROJECTION_AUDIENCES) {
      expect(security).toContain(`**${audienceLabels[audience]}**`)
    }
    expect(model).toContain('version 28')
    expect(model).toContain('64 MiB')
  })

  it('mirrors campaign-clock thresholds and explicitly rejects every alternate time authority', () => {
    const model = read('docs/breeding/data-model-and-campaign-clock.md')
    const guide = read('docs/breeding/gm-and-player-guide.md')
    const bindings = BREEDING_DOCUMENTATION_CLOSURE_V1.runtimeBindings
    expect(BREEDING_PROJECT_WIZARD_INITIAL_MINUTES).toBe(bindings.initialProjectMinutes)
    expect(BREEDING_PROJECT_WIZARD_CHECK_DC).toBe(bindings.breederCheckDifficultyClass)
    expect(BREEDING_PROJECT_WIZARD_ADDITIONAL_MINUTES).toBe(bindings.additionalProjectMinutes)
    expect(BREEDING_PROJECT_WIZARD_INITIAL_MINUTES + BREEDING_PROJECT_WIZARD_ADDITIONAL_MINUTES)
      .toBe(bindings.minimumProjectMinutesBeforeEgg)
    expect(BREEDING_CAMPAIGN_CLOCK_EGG_BATCH_MAXIMUM).toBe(bindings.campaignClockEggBatchMaximum)
    expect(model).toContain('exactly 240 credited campaign minutes')
    expect(model).toContain('DC 12')
    expect(model).toContain('at most 100')
    expect(model).toContain('Wall-clock time is never')
    expect(guide).toContain('Browser time, real-world waiting, scenes, maps, encounters, time zones, and page reloads do not count.')
  })

  it('documents structural privacy, dual consent, atomic hatch, orphan repair, and release commands without stale claims', () => {
    const guide = read('docs/breeding/gm-and-player-guide.md')
    const model = read('docs/breeding/data-model-and-campaign-clock.md')
    const qa = read('docs/breeding/qa-and-release-guide.md')
    const operator = read('docs/breeding/operator-guide.md')
    const contributor = read('docs/breeding/contributor-guide.md')
    const combined = [guide, model, qa, operator, contributor, read('docs/breeding/workshop.md')].join('\n')

    expect(guide).toContain('GM authority substitutes for neither participant')
    expect(guide).toContain('Privacy is enforced by server schemas, not CSS')
    expect(model).toContain('No accepted partial child may survive rollback')
    expect(model).toContain('diagnostics alone never authorize mutation')
    expect(qa).toContain('npm run test:breeding-production-acceptance')
    expect(qa).toContain('bash scripts/quality-gate.sh')
    expect(contributor).toContain(BREEDING_DOCUMENTATION_CLOSURE_V1.verificationCommand)
    expect(combined).not.toContain('exact 101-artifact semantic registry')
    expect(combined).not.toContain('Planned dedicated repositories own')
    expect(combined).not.toContain('Final interaction acceptance remains owned by BR-078')
    expect(combined).not.toContain('submit an exact-retry command')
  })
})
