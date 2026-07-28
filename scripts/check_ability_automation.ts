import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import actionExceptionsJson from '../data/ability-automation/action-exceptions.json'
import capabilityCatalogJson from '../data/ability-automation/capabilities.json'
import frequencyExceptionsJson from '../data/ability-automation/frequency-exceptions.json'
import interactionMatrixJson from '../data/ability-automation/interaction-matrix.json'
import legacyBaselineJson from '../data/ability-automation/legacy-baseline.json'
import manifestJson from '../data/ability-automation/manifest.json'
import parameterDefinitionsJson from '../data/ability-automation/parameter-definitions.json'
import privacyMatrixJson from '../data/ability-automation/privacy-matrix.json'
import protectionsJson from '../data/ability-automation/protections.json'
import scenarioRequirementsJson from '../data/ability-automation/scenario-requirements.json'
import timingConstraintsJson from '../data/ability-automation/timing-constraints.json'
import {
  parseAbilityActionExceptionCatalog,
  parseCanonicalAbilityActions,
} from '#shared/abilityAutomation/actionEconomy'
import {
  parseAbilityAutomationCapabilityCatalog,
} from '#shared/abilityAutomation/capabilities'
import {
  parseAbilityFrequencyExceptionCatalog,
  parseCanonicalAbilityFrequencies,
} from '#shared/abilityAutomation/frequency'
import { parseAbilityAutomationInteractionMatrix } from '#shared/abilityAutomation/interactionMatrix'
import {
  parseAbilityAutomationLegacyBaseline,
} from '#shared/abilityAutomation/legacyBaseline'
import {
  parseAbilityAutomationManifest,
} from '#shared/abilityAutomation/manifest'
import { parseAbilityAutomationPrivacyMatrix } from '#shared/abilityAutomation/privacy'
import { parseAbilityParameterDefinitionCatalog } from '#shared/abilityAutomation/parameters'
import { parseAbilityProtectionCatalog } from '#shared/abilityAutomation/protections'
import { parseAbilityTimingConstraintCatalog } from '#shared/abilityAutomation/timingConstraints'
import { assertAbilityAutomationEngineBudgets } from '#shared/abilityAutomation/performanceBudgets'
import {
  loadCanonicalAbilityCatalog,
} from '#shared/abilityAutomation/ruleset'
import {
  parseAbilityAutomationScenarioRequirementCatalog,
} from '#shared/abilityAutomation/scenarioRequirements'
import { abilityAutomationInteractionReviewSha256 } from '../server/domain/abilityAutomation/interactionMatrix'
import { ABILITY_AUTOMATION_RUNTIME_REGISTRY } from '../server/domain/abilityAutomation/registry'

const ROOT = resolve(import.meta.dirname, '..')
const ABILITIES_PATH = resolve(ROOT, 'data/reference/abilities.json')
const PLAN_PATH = resolve(ROOT, 'implementation-plans/ABILITY_AUTOMATION_PLAN.md')
const EXPECTED_ABILITY_COUNT = 483
const EXPECTED_TICKET_COUNT = 110
const FIRST_COHORT_TICKET = 60
const LAST_COHORT_TICKET = 100
const COHORT_SIZE = 12

interface AbilityAutomationCheckSummary {
  readonly canonical: number
  readonly complete: number
  readonly assisted: number
  readonly blocked: number
  readonly unimplemented: number
  readonly registeredRuntimes: number
  readonly frequencies: {
    readonly static: number
    readonly atWill: number
    readonly scene: number
    readonly daily: number
    readonly exceptional: number
  }
  readonly actionVariants: {
    readonly total: number
    readonly interruptReaction: number
    readonly priority: number
  }
  readonly timingConstraints: number
  readonly abilityProtections: number
  readonly parameterizedAbilities: number
  readonly interactions: {
    readonly unassessed: number
    readonly partial: number
    readonly complete: number
  }
  readonly capabilities: {
    readonly planned: number
    readonly implemented: number
  }
  readonly evidenceClasses: number
  readonly evidenceRequirements: number
  readonly legacyBaseline: {
    readonly abilitiesWithFragments: number
    readonly fragments: number
    readonly uncoveredAbilities: number
  }
  readonly privacyMatrix: {
    readonly threats: number
    readonly assets: number
  }
  readonly planTicketsDone: number | null
}

const fail = (message: string): never => {
  throw new Error(message)
}

const compareCodePoints = (left: string, right: string): number => (
  left === right ? 0 : left < right ? -1 : 1
)

const ticketId = (number: number): string => `AA-${String(number).padStart(3, '0')}`
const cohortIdForIndex = (index: number): string => (
  `aa-${String(FIRST_COHORT_TICKET + Math.floor(index / COHORT_SIZE)).padStart(3, '0')}`
)

interface PlanTicket {
  readonly id: string
  readonly checkbox: string
  readonly status: 'TODO' | 'IN_PROGRESS' | 'DONE' | 'BLOCKED'
  readonly lineIndex: number
}

const checkPlan = (input: {
  readonly plan: string
  readonly canonicalIds: readonly string[]
  readonly manifestCohorts: readonly (string | null)[]
  readonly sourceHash: string
  readonly summary: Omit<AbilityAutomationCheckSummary, 'planTicketsDone'>
}): number => {
  const lines = input.plan.split(/\r?\n/)
  const ticketPattern = /^- \[([ x])\] \*\*(AA-\d{3}) — .+\*\* — `(TODO|IN_PROGRESS|DONE|BLOCKED)`$/
  const tickets: PlanTicket[] = []
  lines.forEach((line, lineIndex) => {
    const match = ticketPattern.exec(line)
    if (!match) return
    tickets.push({
      checkbox: match[1]!,
      id: match[2]!,
      status: match[3] as PlanTicket['status'],
      lineIndex,
    })
  })
  if (tickets.length !== EXPECTED_TICKET_COUNT) {
    fail(`Ability plan must contain exactly ${EXPECTED_TICKET_COUNT} tickets; found ${tickets.length}.`)
  }
  tickets.forEach((ticket, index) => {
    const expectedId = ticketId(index + 1)
    if (ticket.id !== expectedId) fail(`Ability plan ticket order drifted at ${ticket.id}; expected ${expectedId}.`)
    const checked = ticket.checkbox === 'x'
    if (checked !== (ticket.status === 'DONE')) {
      fail(`${ticket.id} checkbox and status disagree.`)
    }
  })

  const done = tickets.filter(ticket => ticket.status === 'DONE').length
  const inProgress = tickets.filter(ticket => ticket.status === 'IN_PROGRESS')
  if (inProgress.length > 1) fail('Ability plan may have at most one IN_PROGRESS ticket.')
  const current = /^`CURRENT_TICKET: (AA-\d{3})`$/m.exec(input.plan)?.[1]
    ?? fail('Ability plan must declare CURRENT_TICKET.')
  const firstUnfinished = tickets.find(ticket => ticket.status !== 'DONE')
  if (firstUnfinished && current !== firstUnfinished.id) {
    fail(`CURRENT_TICKET must be ${firstUnfinished.id}; received ${current}.`)
  }
  if (inProgress.length === 1 && inProgress[0]!.id !== current) {
    fail(`The IN_PROGRESS ticket must match CURRENT_TICKET ${current}.`)
  }

  const planStatus = /^`PLAN_STATUS: (IN_PROGRESS|DONE)`$/m.exec(input.plan)?.[1]
    ?? fail('Ability plan must declare PLAN_STATUS.')
  if ((done === EXPECTED_TICKET_COUNT) !== (planStatus === 'DONE')) {
    fail('PLAN_STATUS may be DONE only when every ticket is DONE.')
  }
  const progress = /Plan tickets: \*\*(\d+) DONE \/ (\d+) total\*\*/.exec(input.plan)
    ?? fail('Ability plan progress snapshot is missing ticket totals.')
  if (Number(progress[1]) !== done || Number(progress[2]) !== EXPECTED_TICKET_COUNT) {
    fail('Ability plan ticket progress snapshot is stale.')
  }
  const sourceHash = /Current source SHA-256: `([a-f0-9]{64})`/.exec(input.plan)?.[1]
  if (sourceHash !== input.sourceHash) fail('Ability plan source SHA-256 is stale.')
  const canonicalCount = /Canonical inventory: \*\*(\d+)\*\*/.exec(input.plan)?.[1]
  if (Number(canonicalCount) !== input.summary.canonical) {
    fail('Ability plan canonical inventory snapshot is stale.')
  }
  const completeCount = /Semantically complete: \*\*(\d+)\*\*/.exec(input.plan)?.[1]
  const assistedCount = /Assisted: \*\*(\d+)\*\*/.exec(input.plan)?.[1]
  const blockedCount = /Blocked\/unimplemented: \*\*(\d+)\*\*/.exec(input.plan)?.[1]
  if (
    Number(completeCount) !== input.summary.complete
    || Number(assistedCount) !== input.summary.assisted
    || Number(blockedCount) !== input.summary.blocked
  ) {
    fail('Ability plan base-status progress snapshot is stale.')
  }
  const interactionLine = lines.find(line => line.startsWith('- Interaction status:'))
    ?? fail('Ability plan interaction-status snapshot is missing.')
  for (const status of ['unassessed', 'partial', 'complete'] as const) {
    const count = new RegExp(`(\\d+) ${status}`).exec(interactionLine)?.[1]
    const expected = input.summary.interactions[status]
    if (Number(count ?? 0) !== expected) {
      fail(`Ability plan ${status} interaction snapshot is stale.`)
    }
  }

  for (let ticketNumber = FIRST_COHORT_TICKET; ticketNumber <= LAST_COHORT_TICKET; ticketNumber += 1) {
    const ticket = tickets[ticketNumber - 1]!
    const namesLine = lines[ticket.lineIndex + 1]
    if (!namesLine?.startsWith('  - ')) fail(`${ticket.id} must list its canonical ability cohort.`)
    const actualNames = namesLine.slice(4).split(';').map(name => name.trim())
    const start = (ticketNumber - FIRST_COHORT_TICKET) * COHORT_SIZE
    const expectedNames = input.canonicalIds.slice(start, start + COHORT_SIZE)
    if (
      actualNames.length !== expectedNames.length
      || actualNames.some((name, index) => name !== expectedNames[index])
    ) {
      fail(`${ticket.id} canonical cohort membership drifted.`)
    }
  }
  if (input.manifestCohorts.some((cohort, index) => cohort !== cohortIdForIndex(index))) {
    fail('Ability manifest rollout cohorts no longer match the plan cohorts.')
  }
  return done
}

export const checkAbilityAutomationRepository = async (options: {
  readonly requireComplete?: boolean
  readonly checkPlan?: boolean
} = {}): Promise<AbilityAutomationCheckSummary> => {
  assertAbilityAutomationEngineBudgets()
  const catalog = await loadCanonicalAbilityCatalog(readFileSync(ABILITIES_PATH))
  if (catalog.abilities.length !== EXPECTED_ABILITY_COUNT) {
    fail(`Expected ${EXPECTED_ABILITY_COUNT} canonical abilities; found ${catalog.abilities.length}.`)
  }
  const frequencyExceptions = parseAbilityFrequencyExceptionCatalog(
    frequencyExceptionsJson,
    catalog,
  )
  const frequencyByAbility = parseCanonicalAbilityFrequencies(catalog, frequencyExceptions)
  const frequencies = [...frequencyByAbility.values()]
  const actionExceptions = parseAbilityActionExceptionCatalog(
    actionExceptionsJson,
    catalog,
    frequencyByAbility,
  )
  const actionVariants = [
    ...parseCanonicalAbilityActions(catalog, frequencyByAbility, actionExceptions).values(),
  ].flatMap(action => action.variants)
  const timingConstraints = parseAbilityTimingConstraintCatalog(timingConstraintsJson, catalog)
  const protections = parseAbilityProtectionCatalog(protectionsJson, catalog)
  const parameterDefinitions = parseAbilityParameterDefinitionCatalog(
    parameterDefinitionsJson,
    catalog,
  )
  const canonicalIds = catalog.abilities.map(ability => ability.canonicalId)
  if (new Set(canonicalIds).size !== EXPECTED_ABILITY_COUNT) fail('Canonical abilities must be unique.')
  if (canonicalIds.some((identity, index) => identity !== [...canonicalIds].sort(compareCodePoints)[index])) {
    fail('Canonical abilities must use code-point order.')
  }

  const capabilityCatalog = parseAbilityAutomationCapabilityCatalog(
    capabilityCatalogJson,
    catalog,
  )
  const scenarioCatalog = parseAbilityAutomationScenarioRequirementCatalog(
    scenarioRequirementsJson,
  )
  const legacyBaseline = parseAbilityAutomationLegacyBaseline(legacyBaselineJson, catalog)
  const privacyMatrix = parseAbilityAutomationPrivacyMatrix(privacyMatrixJson)
  for (const entry of legacyBaseline.entries) {
    for (const fragment of entry.fragments) {
      if (!existsSync(resolve(ROOT, fragment.sourceModule))) {
        fail(`${entry.canonicalId} legacy baseline source does not exist: ${fragment.sourceModule}.`)
      }
    }
  }
  const manifest = parseAbilityAutomationManifest(
    manifestJson,
    catalog,
    capabilityCatalogJson,
    scenarioRequirementsJson,
  )
  const manifestIds = manifest.abilities.map(ability => ability.canonicalId)
  if (
    manifestIds.length !== canonicalIds.length
    || manifestIds.some((identity, index) => identity !== canonicalIds[index])
  ) {
    fail('Ability manifest must contain every canonical ability exactly once in canonical order.')
  }
  const interactionMatrix = parseAbilityAutomationInteractionMatrix(interactionMatrixJson)
  if (
    interactionMatrix.rulesetId !== catalog.rulesetId
    || interactionMatrix.sourceDataSha256 !== catalog.sourceDataSha256
    || interactionMatrix.canonicalAbilityCount !== catalog.abilities.length
  ) fail('Ability interaction matrix ruleset snapshot is stale.')
  if (interactionMatrix.reviewedManifestSha256 !== abilityAutomationInteractionReviewSha256(manifest)) {
    fail('Ability interaction matrix manifest review snapshot is stale.')
  }
  for (const file of [
    ...interactionMatrix.domains.flatMap(domain => domain.evidenceFiles),
    ...interactionMatrix.crossDomainEvidenceFiles,
  ]) {
    if (!existsSync(resolve(ROOT, file))) fail(`Ability interaction evidence does not exist: ${file}.`)
  }
  if (manifest.abilities.some(ability => ability.interactionStatus !== 'complete')) {
    fail('Certified ability interaction matrix requires every manifest interaction status to be complete.')
  }

  const capabilityByCode = new Map(
    capabilityCatalog.capabilities.map(capability => [capability.code, capability]),
  )
  for (const ability of manifest.abilities) {
    if (ability.baseStatus === 'complete') {
      for (const code of ability.capabilityTags) {
        if (capabilityByCode.get(code)?.implementationStatus !== 'implemented') {
          fail(`${ability.canonicalId} claims complete with non-implemented capability ${code}.`)
        }
      }
    }
    if (ability.runtime.kind !== 'abilityspec-v1') continue
    const sourcePath = resolve(ROOT, ability.runtime.sourceModule!)
    if (!existsSync(sourcePath)) {
      fail(`${ability.canonicalId} runtime source does not exist: ${ability.runtime.sourceModule}.`)
    }
  }

  const complete = manifest.abilities.filter(ability => ability.baseStatus === 'complete').length
  const assisted = manifest.abilities.filter(ability => ability.baseStatus === 'assisted').length
  const blocked = manifest.abilities.filter(ability => ability.baseStatus === 'blocked').length
  const unimplemented = manifest.abilities.filter(ability => (
    ability.runtime.kind === 'unimplemented'
  )).length
  const interactions = {
    unassessed: manifest.abilities.filter(ability => ability.interactionStatus === 'unassessed').length,
    partial: manifest.abilities.filter(ability => ability.interactionStatus === 'partial').length,
    complete: manifest.abilities.filter(ability => ability.interactionStatus === 'complete').length,
  }
  const capabilities = {
    planned: capabilityCatalog.capabilities.filter(capability => (
      capability.implementationStatus === 'planned'
    )).length,
    implemented: capabilityCatalog.capabilities.filter(capability => (
      capability.implementationStatus === 'implemented'
    )).length,
  }
  if (ABILITY_AUTOMATION_RUNTIME_REGISTRY.size !== complete) {
    fail(
      `Production ability registry selects ${ABILITY_AUTOMATION_RUNTIME_REGISTRY.size} runtimes for ${complete} complete manifest rows.`,
    )
  }
  const withoutPlan: Omit<AbilityAutomationCheckSummary, 'planTicketsDone'> = {
    canonical: catalog.abilities.length,
    complete,
    assisted,
    blocked,
    unimplemented,
    registeredRuntimes: ABILITY_AUTOMATION_RUNTIME_REGISTRY.size,
    frequencies: {
      static: frequencies.filter(value => value.kind === 'static').length,
      atWill: frequencies.filter(value => value.kind === 'at-will').length,
      scene: frequencies.filter(value => value.kind === 'scene').length,
      daily: frequencies.filter(value => value.kind === 'daily').length,
      exceptional: frequencies.filter(value => value.kind === 'exceptional').length,
    },
    actionVariants: {
      total: actionVariants.length,
      interruptReaction: actionVariants.filter(variant => (
        variant.availabilityPool === 'interrupt-reaction'
      )).length,
      priority: actionVariants.filter(variant => variant.timing === 'priority').length,
    },
    timingConstraints: timingConstraints.entries.length,
    abilityProtections: protections.entries.length,
    parameterizedAbilities: parameterDefinitions.entries.length,
    interactions,
    capabilities,
    evidenceClasses: scenarioCatalog.evidenceClasses.length,
    evidenceRequirements: scenarioCatalog.requirements.length,
    legacyBaseline: {
      abilitiesWithFragments: legacyBaseline.entries.length,
      fragments: legacyBaseline.entries.reduce((count, entry) => count + entry.fragments.length, 0),
      uncoveredAbilities: catalog.abilities.length - legacyBaseline.entries.length,
    },
    privacyMatrix: {
      threats: privacyMatrix.threats.length,
      assets: privacyMatrix.assets.length,
    },
  }
  const planTicketsDone = options.checkPlan
    ? checkPlan({
      plan: readFileSync(PLAN_PATH, 'utf8'),
      canonicalIds,
      manifestCohorts: manifest.abilities.map(ability => ability.rolloutCohortId),
      sourceHash: catalog.sourceDataSha256,
      summary: withoutPlan,
    })
    : null

  if (options.requireComplete && (
    complete !== EXPECTED_ABILITY_COUNT
    || assisted !== 0
    || blocked !== 0
    || unimplemented !== 0
  )) {
    fail(
      `Strict ability completion requires ${EXPECTED_ABILITY_COUNT} complete, 0 assisted, 0 blocked, and 0 unimplemented; received ${complete}, ${assisted}, ${blocked}, and ${unimplemented}.`,
    )
  }

  return { ...withoutPlan, planTicketsDone }
}

const flags = new Set(process.argv.slice(2))
const knownFlags = new Set(['--require-complete', '--check-plan', '--report'])
for (const flag of flags) {
  if (!knownFlags.has(flag)) fail(`Unknown ability automation check option ${flag}.`)
}

checkAbilityAutomationRepository({
  requireComplete: flags.has('--require-complete'),
  checkPlan: flags.has('--check-plan'),
}).then((summary) => {
  if (flags.has('--report')) {
    console.log(JSON.stringify(summary, null, 2))
    return
  }
  console.log(
    `Ability automation metadata valid: ${summary.canonical}/${EXPECTED_ABILITY_COUNT} canonical rows; `
    + `${summary.complete} complete, ${summary.assisted} assisted, ${summary.blocked} blocked; `
    + `${summary.unimplemented} unimplemented.`,
  )
}).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
