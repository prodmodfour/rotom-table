import manifestJson from '../../../data/ability-automation/manifest.json'
import type { AuthRole } from '#shared/auth'
import {
  ABILITY_CLIENT_CAPABILITY_SCHEMA_VERSION,
  parseAbilityClientCapabilityBundle,
  type AbilityClientCapability,
  type AbilityClientCapabilityBundle,
  type AbilityClientCapabilityStatus,
} from '#shared/abilityAutomation/clientCapabilities'
import type { AbilityAutomationManifest, AbilityAutomationManifestRecord } from '#shared/abilityAutomation/manifest'
import type { PlayerProfile } from '#shared/playerProfiles'
import type { TabletopMap } from '~/types/map'
import { hasAa061BallFetchResponse } from './mechanics/aa061PresenceIntegration'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'
import {
  actorControlledMapPlacementIds,
  playerProfileLinkedTrainerSheetsForTokenControl,
} from '../../policies/playerProfileTokenControlPolicy'
import { ABILITY_AUTOMATION_RUNTIME_REGISTRY, type AbilityAutomationRuntimeRegistry } from './registry'
import { projectAuthoritativeEffectiveAbilities } from './effectiveAbilities'
import { resolveSheetAndEdgeAbilityInstances } from '../edgeAutomation/permanentGrants'
import { aa071ForecastTypeResolution } from './mechanics/aa071StaticIntegration'
import { aa074HoneyPawsPreparationForPlacement } from '#shared/abilityAutomation/aa074'
import { splitSheetItemNames } from '~/utils/sheetItemNames'
import { resolveMoveAutomationItemRuleIdentity } from '../moveAutomation/itemRuleData'

export interface BuildAbilityClientCapabilitiesInput {
  readonly role: AuthRole
  readonly playerProfile?: PlayerProfile | null
  readonly map: TabletopMap
  readonly mapRevision: number
  readonly pokemonSheets: readonly CharacterSheet[]
  readonly trainerSheets: readonly TrainerSheet[]
}
export interface BuildAbilityClientCapabilitiesDependencies {
  readonly manifest?: AbilityAutomationManifest
  readonly registry?: AbilityAutomationRuntimeRegistry
}
const statusBadge = (status: AbilityClientCapabilityStatus): string => `ability.status.${status}`
const unavailableReason = (
  status: AbilityClientCapabilityStatus,
  row: AbilityAutomationManifestRecord,
): string | null => {
  if (status === 'ready' || status === 'passive') return null
  if (status === 'blocked') return row.baseStatus === 'assisted'
    ? 'ability.unavailable.assisted'
    : 'ability.unavailable.blocked'
  if (status === 'suppressed') return 'ability.unavailable.suppressed'
  if (status === 'parameters-required') return 'ability.unavailable.parameters-required'
  return 'ability.unavailable.runtime-drift'
}

/**
 * Build a controller-only, revision-bound menu projection. A runtime appears as
 * invocable only when the semantic manifest and exact production registration agree.
 */
export const buildAbilityClientCapabilityBundle = (
  input: BuildAbilityClientCapabilitiesInput,
  dependencies: BuildAbilityClientCapabilitiesDependencies = {},
): AbilityClientCapabilityBundle => {
  const manifest = dependencies.manifest ?? manifestJson as unknown as AbilityAutomationManifest
  const registry = dependencies.registry ?? ABILITY_AUTOMATION_RUNTIME_REGISTRY
  const manifestById = new Map(manifest.abilities.map(row => [row.canonicalId, row]))
  const pokemonBySlug = new Map(input.pokemonSheets.map(sheet => [sheet.slug, sheet]))
  const trainerBySlug = new Map(input.trainerSheets.map(sheet => [sheet.slug, sheet]))
  const linkedTrainerSheets = playerProfileLinkedTrainerSheetsForTokenControl(
    input.playerProfile,
    slug => trainerBySlug.get(slug),
  )
  const controlledIds = new Set(actorControlledMapPlacementIds({
    role: input.role,
    profile: input.playerProfile,
    placements: input.map.placements,
    linkedTrainerSheets,
  }))
  const encounterState = input.map.encounterState
  const capabilityCarriedIds = new Set((encounterState?.capabilityRuntime?.links ?? []).flatMap(link => (
    link.kind === 'as-one-mount' || link.kind === 'viral-fusion' ? [...link.participantPlacementIds] : []
  )))
  const placements = input.map.placements.flatMap((placement) => {
    if (!controlledIds.has(placement.id) || capabilityCarriedIds.has(placement.id)) return []
    const sheet = placement.sheetKind === 'pokemon'
      ? pokemonBySlug.get(placement.sheetSlug)
      : trainerBySlug.get(placement.sheetSlug)
    if (!sheet) return []
    const projected = projectAuthoritativeEffectiveAbilities({
      baseAbilities: resolveSheetAndEdgeAbilityInstances(sheet),
      effects: encounterState?.effects ?? [],
      transformationSnapshots: encounterState?.abilityTransformations,
      target: {
        placementId: placement.id,
        ...(placement.sideId ? { sideId: placement.sideId } : {}),
        position: placement.position,
      },
    })
    const abilities = projected.flatMap((ability): AbilityClientCapability[] => {
      const row = manifestById.get(ability.canonicalId)
      if (!row) return []
      const runtime = registry.resolve(ability.canonicalId)
      const modeAvailable = (modeId: string): boolean => {
        if (ability.canonicalId === 'Ball Fetch' && modeId === 'fetch') {
          return hasAa061BallFetchResponse({
            map: input.map,
            ownerPlacementId: placement.id,
            abilityInstanceId: ability.instanceId,
          })
        }
        if (ability.canonicalId === 'Forecast' && modeId === 'choose-weather') {
          return aa071ForecastTypeResolution({
            contextMap: input.map,
            placementId: placement.id,
            hasForecast: true,
          }).ambiguous
        }
        if (ability.canonicalId === 'Honey Paws' && modeId === 'prepare-leftovers') {
          return placement.sheetKind === 'pokemon'
            && splitSheetItemNames((sheet as CharacterSheet).items?.held)
              .some(name => resolveMoveAutomationItemRuleIdentity(name)?.canonicalItemId === 'honey')
            && aa074HoneyPawsPreparationForPlacement(
              encounterState?.effects,
              placement.id,
            ) === null
        }
        return true
      }
      const modeInvocable = (kind: string): boolean => kind === 'activated' || kind === 'configuration'
      const hasInvocableMode = runtime?.definition.spec.modes.some(mode => (
        modeInvocable(mode.kind) && modeAvailable(mode.id)
      )) ?? false
      let status: AbilityClientCapabilityStatus
      if (!ability.effective) status = 'suppressed'
      else if (ability.parameterStatus === 'missing-required-data') status = 'parameters-required'
      else if (row.baseStatus !== 'complete') status = 'blocked'
      else if (!runtime
        || runtime.canonicalId !== row.canonicalId
        || runtime.definitionHash !== row.runtime.definitionHash
        || runtime.version !== row.runtime.version
        || runtime.sourceModule !== row.runtime.sourceModule
        || (ability.definitionHash !== null && ability.definitionHash !== runtime.definitionHash)) {
        status = 'runtime-drift'
      }
      else status = hasInvocableMode ? 'ready' : 'passive'
      const modes = runtime?.definition.spec.modes.map(mode => ({
        modeId: mode.id,
        kind: mode.kind,
        invocable: status === 'ready' && modeInvocable(mode.kind) && modeAvailable(mode.id),
        targeting: runtime.definition.spec.targeting
          .filter(targeting => targeting.modeId === mode.id)
          .map(targeting => ({
            id: targeting.id,
            kind: targeting.kind,
            minSelections: targeting.minSelections,
            maxSelections: targeting.maxSelections,
          })),
      })) ?? []
      return [{
        instanceId: ability.instanceId,
        canonicalId: ability.canonicalId,
        displayName: row.displayName,
        effective: ability.effective,
        baseStatus: row.baseStatus,
        interactionStatus: row.interactionStatus,
        status,
        statusBadgeKey: statusBadge(status),
        unavailableReasonCode: unavailableReason(status, row),
        modes,
      }]
    })
    return [{ placementId: placement.id, abilities }]
  })
  return parseAbilityClientCapabilityBundle({
    schemaVersion: ABILITY_CLIENT_CAPABILITY_SCHEMA_VERSION,
    mapSlug: input.map.slug,
    mapRevision: input.mapRevision,
    placements,
  })
}
