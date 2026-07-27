import manifestJson from '../../../data/ability-automation/manifest.json'
import {
  ABILITY_AUTOMATION_RUNTIME_REGISTRY,
  type AbilitySpecV1Runtime,
  type AbilityAutomationRuntimeRegistry,
} from '~~/server/domain/abilityAutomation/registry'
import { AA085_ABILITY_SPEC_REGISTRATIONS } from '~~/server/domain/abilityAutomation/specs/aa085'
import { AA086_ABILITY_SPEC_REGISTRATIONS } from '~~/server/domain/abilityAutomation/specs/aa086'
import { AA087_ABILITY_SPEC_REGISTRATIONS } from '~~/server/domain/abilityAutomation/specs/aa087'
import { AA088_ABILITY_SPEC_REGISTRATIONS } from '~~/server/domain/abilityAutomation/specs/aa088'
import { AA089_ABILITY_SPEC_REGISTRATIONS } from '~~/server/domain/abilityAutomation/specs/aa089'
import { AA090_ABILITY_SPEC_REGISTRATIONS } from '~~/server/domain/abilityAutomation/specs/aa090'
import { AA091_ABILITY_SPEC_REGISTRATIONS } from '~~/server/domain/abilityAutomation/specs/aa091'
import { AA092_ABILITY_SPEC_REGISTRATIONS } from '~~/server/domain/abilityAutomation/specs/aa092'
import { AA093_ABILITY_SPEC_REGISTRATIONS } from '~~/server/domain/abilityAutomation/specs/aa093'
import { AA094_ABILITY_SPEC_REGISTRATIONS } from '~~/server/domain/abilityAutomation/specs/aa094'
import { AA095_ABILITY_SPEC_REGISTRATIONS } from '~~/server/domain/abilityAutomation/specs/aa095'
import { AA096_ABILITY_SPEC_REGISTRATIONS } from '~~/server/domain/abilityAutomation/specs/aa096'
import { AA097_ABILITY_SPEC_REGISTRATIONS } from '~~/server/domain/abilityAutomation/specs/aa097'
import { AA098_ABILITY_SPEC_REGISTRATIONS } from '~~/server/domain/abilityAutomation/specs/aa098'
import { AA099_ABILITY_SPEC_REGISTRATIONS } from '~~/server/domain/abilityAutomation/specs/aa099'
import { AA100_ABILITY_SPEC_REGISTRATIONS } from '~~/server/domain/abilityAutomation/specs/aa100'
import { validateAbilitySpec } from '~~/server/domain/abilityAutomation/validateSpec'

const registrations = [
  ...AA085_ABILITY_SPEC_REGISTRATIONS,
  ...AA086_ABILITY_SPEC_REGISTRATIONS,
  ...AA087_ABILITY_SPEC_REGISTRATIONS,
  ...AA088_ABILITY_SPEC_REGISTRATIONS,
  ...AA089_ABILITY_SPEC_REGISTRATIONS,
  ...AA090_ABILITY_SPEC_REGISTRATIONS,
  ...AA091_ABILITY_SPEC_REGISTRATIONS,
  ...AA092_ABILITY_SPEC_REGISTRATIONS,
  ...AA093_ABILITY_SPEC_REGISTRATIONS,
  ...AA094_ABILITY_SPEC_REGISTRATIONS,
  ...AA095_ABILITY_SPEC_REGISTRATIONS,
  ...AA096_ABILITY_SPEC_REGISTRATIONS,
  ...AA097_ABILITY_SPEC_REGISTRATIONS,
  ...AA098_ABILITY_SPEC_REGISTRATIONS,
  ...AA099_ABILITY_SPEC_REGISTRATIONS,
  ...AA100_ABILITY_SPEC_REGISTRATIONS,
]

const manifestById = new Map(manifestJson.abilities.map(record => [record.canonicalId, record]))
const runtimes = registrations.map((registration): AbilitySpecV1Runtime => {
  const manifest = manifestById.get(registration.canonicalId)
  if (!manifest) throw new Error(`Missing manifest row for ${registration.canonicalId}.`)
  const definition = validateAbilitySpec(registration.spec, {
    capabilityIds: manifest.capabilityTags,
    rulesetVersion: manifest.rulesProvenance,
    extensionRegistry: ABILITY_AUTOMATION_RUNTIME_REGISTRY.extensionRegistry,
    handlerRegistry: ABILITY_AUTOMATION_RUNTIME_REGISTRY.handlerRegistry,
  })
  return Object.freeze({
    canonicalId: registration.canonicalId,
    kind: 'abilityspec-v1' as const,
    version: definition.spec.version,
    definitionHash: definition.definitionHash,
    sourceModule: registration.sourceModule,
    definition,
  })
})
const runtimeById = new Map(runtimes.map(runtime => [runtime.canonicalId, runtime]))

/** Test-only registry for cohorts that remain blocked until conformance promotion. */
export const REMAINING_ABILITY_TEST_REGISTRY: AbilityAutomationRuntimeRegistry = Object.freeze({
  size: ABILITY_AUTOMATION_RUNTIME_REGISTRY.size + runtimes.filter(runtime => (
    ABILITY_AUTOMATION_RUNTIME_REGISTRY.resolve(runtime.canonicalId) === null
  )).length,
  extensionRegistry: ABILITY_AUTOMATION_RUNTIME_REGISTRY.extensionRegistry,
  handlerRegistry: ABILITY_AUTOMATION_RUNTIME_REGISTRY.handlerRegistry,
  resolve: (canonicalId: string) => runtimeById.get(canonicalId)
    ?? ABILITY_AUTOMATION_RUNTIME_REGISTRY.resolve(canonicalId),
  entries: () => Object.freeze([
    ...ABILITY_AUTOMATION_RUNTIME_REGISTRY.entries().filter(runtime => !runtimeById.has(runtime.canonicalId)),
    ...runtimes,
  ]),
})
