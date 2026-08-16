import type { AuthRole } from '#shared/auth'
import { parseSheetItemTargetId, sheetItemTargetId } from '#shared/itemAutomation/sheetActions'
import type { PlayerProfile } from '#shared/playerProfiles'
import type { ItemAggregateRef, UseItemCommandV1 } from '#shared/itemAutomation/operations'
import {
  parseItemNonEncounterExecutionSnapshot,
  type ItemNonEncounterExecutionSnapshotV1,
  type ItemNonEncounterTargetAuthorityV1,
} from '#shared/itemAutomation/nonEncounter'
import { playerProfileCanControlTokenSheet } from '#shared/playerProfileTokenControl'
import type { ItemRuntimeDefinition } from '#shared/itemAutomation/spec'
import type { AuthoritativeItemInventoryInstance } from '#shared/itemAutomation/inventory'
import type { CharacterSheet } from '~/types/characterSheet'
import type { GroupInventoryDocument } from '~/types/groupInventory'
import type { SheetKind, SheetPlacement, TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import type { PersistedSheet } from '../../storage/sheetRepository'
import {
  ItemSourceInventoryError,
  resolveAuthoritativeItemSourceInventory,
} from './sourceInventory'
import { ITEM_AUTOMATION_RUNTIME_REGISTRY } from './registry'

export interface AuthoritativeItemExecutionSheet {
  readonly kind: SheetKind
  readonly slug: string
  readonly revision: number
  readonly sheet: CharacterSheet | TrainerSheet
}

export interface AuthoritativeItemExecutionTarget {
  readonly participantId: string
  readonly placement: SheetPlacement
  readonly sheet: AuthoritativeItemExecutionSheet
}

export interface AuthoritativeItemExecutionContext {
  readonly role: AuthRole
  readonly playerProfile: PlayerProfile | null
  readonly command: UseItemCommandV1
  readonly map: TabletopMap | null
  /** Server-owned boundary used by non-encounter AP eligibility checks. */
  readonly authorityTimestamp: number
  readonly mapRevision: number | null
  /** Detached singleton campaign clock, present only when the command reads it. */
  readonly campaignClock: { readonly revision: number, readonly campaignMinute: number } | null
  /** Null in encounters; immutable campaign/ownership/work evidence everywhere else. */
  readonly nonEncounter: ItemNonEncounterExecutionSnapshotV1 | null
  readonly actorPlacement: SheetPlacement | null
  readonly actorSheet: AuthoritativeItemExecutionSheet
  readonly source: AuthoritativeItemInventoryInstance
  readonly sourceDefinition: ItemRuntimeDefinition
  readonly sourceEntry: ReturnType<typeof resolveAuthoritativeItemSourceInventory>['entry']
  readonly targets: readonly AuthoritativeItemExecutionTarget[]
  readonly sheets: ReadonlyMap<string, AuthoritativeItemExecutionSheet>
  readonly groupInventory: GroupInventoryDocument | null
  readonly readSet: readonly ItemAggregateRef[]
}

export interface BuildAuthoritativeItemExecutionContextInput {
  readonly role: AuthRole
  readonly playerProfile?: PlayerProfile | null
  readonly command: UseItemCommandV1
  readonly map: TabletopMap | null
  readonly mapRevision: number | null
  readonly campaignClock?: { readonly revision: number, readonly campaignMinute: number } | null
  /** Required by production non-encounter callers; defaults to map time/zero for frozen fixtures. */
  readonly authorityTimestamp?: number
  readonly persistedSheets: readonly PersistedSheet[]
  readonly groupInventory?: GroupInventoryDocument | null
  /** Server-owned result of current shared actor/offer reauthorization. */
  readonly groupInventoryUseAuthorized?: boolean
  readonly reservedSourceQuantity?: number
  /** Server-loaded durable activity boundary. Browser commands can never assert it. */
  readonly extendedAction?: {
    readonly phase: 'in-progress' | 'completion'
    readonly activityId: string
    readonly activityRevision: number
    readonly startedAtCampaignMinute: number
  } | null
}

export class AuthoritativeItemExecutionContextError extends Error {
  readonly code: 'missing' | 'stale' | 'incomplete-read-set' | 'identity-conflict' | 'not-authorized'

  constructor(code: AuthoritativeItemExecutionContextError['code'], message: string) {
    super(message)
    this.name = 'AuthoritativeItemExecutionContextError'
    this.code = code
  }
}

const fail = (
  code: AuthoritativeItemExecutionContextError['code'],
  message: string,
): never => {
  throw new AuthoritativeItemExecutionContextError(code, message)
}

export const itemAggregateRefKey = (ref: ItemAggregateRef): string => ref.kind === 'sheet'
  ? `${ref.kind}:${ref.sheetKind}:${ref.id}`
  : `${ref.kind}:${ref.id}`

const sheetKey = (kind: SheetKind, slug: string): string => `${kind}:${slug}`

const persistedSheetSnapshot = (value: PersistedSheet): AuthoritativeItemExecutionSheet => Object.freeze({
  kind: value.kind,
  slug: value.slug,
  revision: value.revision,
  sheet: structuredClone(value.sheet) as unknown as CharacterSheet | TrainerSheet,
})

const linkedPokemonSlugs = (sheet: TrainerSheet): ReadonlySet<string> => new Set(
  [...(sheet.currentTeam ?? []), ...(sheet.boxedPokemon ?? [])]
    .filter((value): value is string => typeof value === 'string')
    .map(value => value.trim())
    .filter(Boolean),
)

const nonEncounterTargetAuthorities = (input: {
  readonly role: AuthRole
  readonly playerProfile: PlayerProfile | null
  readonly actor: AuthoritativeItemExecutionSheet
  readonly sheets: ReadonlyMap<string, AuthoritativeItemExecutionSheet>
}): readonly ItemNonEncounterTargetAuthorityV1[] => {
  const pokemonOwners = new Map<string, string[]>()
  for (const sheet of input.sheets.values()) {
    if (sheet.kind !== 'trainer') continue
    for (const pokemonSlug of linkedPokemonSlugs(sheet.sheet as TrainerSheet)) {
      const owners = pokemonOwners.get(pokemonSlug) ?? []
      owners.push(sheet.slug)
      pokemonOwners.set(pokemonSlug, owners)
    }
  }
  for (const [pokemonSlug, owners] of pokemonOwners) {
    if (new Set(owners).size !== owners.length || owners.length > 1) {
      fail('identity-conflict', `Pokémon sheet ${pokemonSlug} has ambiguous non-encounter Trainer ownership.`)
    }
  }
  const actorOwner = input.actor.kind === 'trainer'
    ? input.actor.slug
    : pokemonOwners.get(input.actor.slug)?.[0] ?? null
  const rows: ItemNonEncounterTargetAuthorityV1[] = []
  for (const sheet of [...input.sheets.values()].sort((left, right) => (
    `${left.kind}:${left.slug}`.localeCompare(`${right.kind}:${right.slug}`)
  ))) {
    const ownerTrainerSlug = sheet.kind === 'trainer'
      ? sheet.slug
      : pokemonOwners.get(sheet.slug)?.[0] ?? null
    const targetId = sheetItemTargetId(sheet.kind, sheet.slug)
    let authority: ItemNonEncounterTargetAuthorityV1['authority'] | null = null
    if (sheet.kind === input.actor.kind && sheet.slug === input.actor.slug) authority = 'actor'
    else if (actorOwner !== null && ownerTrainerSlug === actorOwner) authority = 'actor-roster'
    else if (playerProfileCanControlTokenSheet(input.playerProfile, sheet.kind, sheet.slug)) authority = 'profile-control'
    else if (input.role === 'gm') authority = 'gm-override'
    if (!authority) continue
    rows.push(Object.freeze({
      targetId,
      sheetKind: sheet.kind,
      sheetSlug: sheet.slug,
      sheetRevision: sheet.revision,
      ownerTrainerSlug,
      authority,
    }))
  }
  return Object.freeze(rows)
}

const buildNonEncounterSnapshot = (input: {
  readonly role: AuthRole
  readonly playerProfile: PlayerProfile | null
  readonly command: UseItemCommandV1
  readonly actor: AuthoritativeItemExecutionSheet
  readonly sheets: ReadonlyMap<string, AuthoritativeItemExecutionSheet>
  readonly campaignClock: { readonly revision: number, readonly campaignMinute: number } | null
  readonly definition: ItemRuntimeDefinition
  readonly extendedAction?: BuildAuthoritativeItemExecutionContextInput['extendedAction']
}): ItemNonEncounterExecutionSnapshotV1 | null => {
  if (input.command.context === 'encounter') {
    if (input.extendedAction) fail('identity-conflict', 'Encounter item execution cannot carry non-encounter activity authority.')
    return null
  }
  const campaignClock = input.campaignClock
    ?? fail('missing', 'Non-encounter item execution requires the authoritative campaign clock.')
  if (!Number.isSafeInteger(campaignClock.campaignMinute) || campaignClock.campaignMinute < 0) {
    fail('stale', 'Non-encounter item execution requires a valid campaign-time boundary.')
  }
  if (input.command.context === 'extended-action' && input.definition.spec.timing !== 'extended') {
    fail('identity-conflict', 'Only an Extended Action item may use the extended-action context.')
  }
  const targetAuthorities = nonEncounterTargetAuthorities({
    role: input.role,
    playerProfile: input.playerProfile,
    actor: input.actor,
    sheets: input.sheets,
  })
  const authorizedTargetIds = new Set(targetAuthorities.map(target => target.targetId))
  if (input.command.targetIds.some(targetId => !authorizedTargetIds.has(targetId))) {
    fail('not-authorized', 'One or more non-encounter item targets are not owned or controlled by the acting authority.')
  }
  const extended = input.definition.spec.timing === 'extended'
  if (!extended && input.extendedAction) {
    fail('identity-conflict', 'An immediate item cannot carry extended-action activity authority.')
  }
  const requiresGm = input.definition.spec.prerequisites.some(prerequisite => prerequisite.kind === 'gm')
  const gmConfirmed = requiresGm && input.role === 'gm'
  return parseItemNonEncounterExecutionSnapshot({
    schemaVersion: 1,
    context: input.command.context,
    campaignTime: {
      clockRevision: campaignClock.revision,
      campaignMinute: campaignClock.campaignMinute,
    },
    actor: {
      sheetKind: input.actor.kind,
      sheetSlug: input.actor.slug,
      sheetRevision: input.actor.revision,
    },
    targetAuthorities,
    extendedAction: extended
      ? input.extendedAction
        ? {
            mode: 'extended',
            phase: input.extendedAction.phase,
            activityId: input.extendedAction.activityId,
            activityRevision: input.extendedAction.activityRevision,
            startedAtCampaignMinute: input.extendedAction.startedAtCampaignMinute,
          }
        : {
            mode: 'extended', phase: 'declaration', activityId: null,
            activityRevision: null, startedAtCampaignMinute: null,
          }
      : {
          mode: 'immediate', phase: 'completion', activityId: null,
          activityRevision: null, startedAtCampaignMinute: null,
        },
    gmConfirmation: requiresGm
      ? {
          required: true,
          status: gmConfirmed ? 'confirmed' : 'required',
          evidenceId: gmConfirmed ? `item-gm-confirmation:${input.command.operationId}` : null,
        }
      : { required: false, status: 'not-required', evidenceId: null },
  })
}

const requiredReadRefs = (input: {
  readonly command: UseItemCommandV1
  readonly actorPlacement: SheetPlacement | null
  readonly targets: readonly AuthoritativeItemExecutionTarget[]
}): readonly string[] => {
  const keys = new Set<string>()
  keys.add(`sheet:${input.command.actorSheet.kind}:${input.command.actorSheet.slug}`)
  keys.add(input.command.source.kind === 'trainer'
    ? `sheet:trainer:${input.command.source.slug}`
    : `group-inventory:${input.command.source.slug}`)
  for (const target of input.targets) keys.add(`sheet:${target.sheet.kind}:${target.sheet.slug}`)
  if (input.command.context !== 'encounter') keys.add('campaign-clock:campaign')
  else if (input.command.readSet.some(ref => ref.kind === 'campaign-clock')) keys.add('campaign-clock:campaign')
  if (input.command.context === 'encounter') {
    const mapId = input.actorPlacement ? input.command.readSet.find(ref => ref.kind === 'map')?.id : null
    if (mapId) {
      keys.add(`map:${mapId}`)
      keys.add(`encounter:${mapId}`)
    }
  }
  return [...keys]
}

/**
 * Capture one detached server-owned snapshot for an item operation. The
 * browser supplies identities and revisions only; canonical item identity,
 * ownership, quantity, sheets, targets, map resources, and mutable reads are
 * all resolved again from authority here.
 */
export const buildAuthoritativeItemExecutionContext = (
  input: BuildAuthoritativeItemExecutionContextInput,
): AuthoritativeItemExecutionContext => {
  const command = input.command
  const sheets = new Map<string, AuthoritativeItemExecutionSheet>()
  for (const persisted of input.persistedSheets) {
    const key = sheetKey(persisted.kind, persisted.slug)
    if (sheets.has(key)) fail('identity-conflict', `Item execution sheet ${key} was loaded more than once.`)
    sheets.set(key, persistedSheetSnapshot(persisted))
  }
  const actorSheet = sheets.get(sheetKey(command.actorSheet.kind, command.actorSheet.slug))
    ?? fail('missing', `Item actor sheet ${command.actorSheet.kind}/${command.actorSheet.slug} was not found.`)
  if (actorSheet.revision !== command.actorSheet.expectedRevision) {
    fail('stale', 'The item actor sheet changed. Refresh before retrying.')
  }

  let actorPlacement: SheetPlacement | null = null
  if (command.context === 'encounter') {
    const encounterMap = input.map ?? fail('missing', 'Encounter item execution requires a map.')
    if (input.mapRevision === null || command.actorParticipantId === null) {
      fail('missing', 'Encounter item execution requires a revision and actor placement.')
    }
    actorPlacement = encounterMap.placements.find(placement => placement.id === command.actorParticipantId) ?? null
    if (!actorPlacement
      || actorPlacement.sheetKind !== command.actorSheet.kind
      || actorPlacement.sheetSlug !== command.actorSheet.slug) {
      fail('identity-conflict', 'The item actor no longer matches the authoritative encounter placement.')
    }
  }

  const targets: AuthoritativeItemExecutionTarget[] = command.targetIds.map((participantId) => {
    let placement: SheetPlacement
    if (command.context === 'encounter') {
      placement = input.map?.placements.find(candidate => candidate.id === participantId)
        ?? fail('missing', `Item target ${participantId} is no longer on the authoritative map.`)
    }
    else {
      const target = parseSheetItemTargetId(participantId)
        ?? fail('identity-conflict', 'A non-encounter item target has invalid sheet authority.')
      if (sheetItemTargetId(target.kind, target.slug) !== participantId) {
        fail('identity-conflict', 'A non-encounter item target identity is not canonical.')
      }
      placement = {
        id: participantId,
        sheetKind: target.kind,
        sheetSlug: target.slug,
        position: { x: 0, y: 0, z: 0 },
      }
    }
    const sheet = sheets.get(sheetKey(placement.sheetKind, placement.sheetSlug))
      ?? fail('missing', `Item target sheet ${placement.sheetKind}/${placement.sheetSlug} was not found.`)
    return Object.freeze({ participantId, placement: structuredClone(placement), sheet })
  })

  const groupInventory = input.groupInventory ? structuredClone(input.groupInventory) : null
  const sourceTrainer = command.source.kind === 'trainer'
    ? sheets.get(sheetKey('trainer', command.source.slug))?.sheet as TrainerSheet | undefined
    : undefined
  let source: ReturnType<typeof resolveAuthoritativeItemSourceInventory>
  try {
    source = resolveAuthoritativeItemSourceInventory({
      role: input.role,
      playerProfile: input.playerProfile,
      source: command.source,
      sourceInstanceId: command.sourceInstanceId,
      trainerSheet: sourceTrainer,
      groupInventory,
      groupInventoryUseAuthorized: input.groupInventoryUseAuthorized === true,
      reservedQuantity: input.reservedSourceQuantity ?? 0,
    })
  }
  catch (error) {
    if (error instanceof ItemSourceInventoryError) {
      const code = error.code === 'not-authorized' ? 'not-authorized'
        : error.code === 'stale' ? 'stale'
          : error.code === 'ambiguous' ? 'identity-conflict' : 'missing'
      fail(code, error.message)
    }
    throw error
  }
  const sourceDefinition = ITEM_AUTOMATION_RUNTIME_REGISTRY.require(source.instance.canonicalItemId)
  if (source.definition.definitionSha256 !== sourceDefinition.definitionSha256) {
    fail('identity-conflict', 'The authoritative item definition changed while execution context was built.')
  }

  const readByKey = new Map(command.readSet.map(ref => [itemAggregateRefKey(ref), ref]))
  for (const required of requiredReadRefs({ command, actorPlacement, targets })) {
    if (!readByKey.has(required)) fail('incomplete-read-set', `Item operation read set omitted ${required}.`)
  }
  for (const ref of command.readSet) {
    if (ref.kind === 'map' || ref.kind === 'encounter') {
      if (!input.map || input.map.slug !== ref.id || input.mapRevision !== ref.revision) {
        fail('stale', 'The encounter map changed. Refresh before retrying.')
      }
    }
    else if (ref.kind === 'sheet') {
      const sheet = sheets.get(sheetKey(ref.sheetKind, ref.id))
      if (!sheet || sheet.revision !== ref.revision) fail('stale', `Item execution sheet ${ref.sheetKind}/${ref.id} changed.`)
    }
    else if (ref.kind === 'group-inventory') {
      if (!groupInventory || groupInventory.slug !== ref.id || groupInventory.revision !== ref.revision) {
        fail('stale', 'The group inventory changed. Refresh before retrying.')
      }
    }
    else if (ref.kind === 'campaign-clock') {
      if (!input.campaignClock || input.campaignClock.revision !== ref.revision) {
        fail('stale', 'The campaign clock changed. Refresh before retrying.')
      }
    }
    else {
      fail('missing', `Item operation aggregate ${ref.kind} is not available in this execution context.`)
    }
  }

  const nonEncounter = buildNonEncounterSnapshot({
    role: input.role,
    playerProfile: input.playerProfile ?? null,
    command,
    actor: actorSheet,
    sheets,
    campaignClock: input.campaignClock ?? null,
    definition: sourceDefinition,
    extendedAction: input.extendedAction,
  })
  const authorityTimestamp = input.authorityTimestamp
    ?? (Number.isSafeInteger(input.map?.updatedAt) && Number(input.map?.updatedAt) >= 0 ? Number(input.map!.updatedAt) : 0)
  if (!Number.isSafeInteger(authorityTimestamp) || authorityTimestamp < 0) {
    fail('stale', 'Item execution requires a valid authoritative time boundary.')
  }

  return Object.freeze({
    role: input.role,
    playerProfile: input.playerProfile ?? null,
    command,
    map: input.map ? structuredClone(input.map) : null,
    authorityTimestamp,
    mapRevision: input.mapRevision,
    campaignClock: input.campaignClock ? Object.freeze({ ...input.campaignClock }) : null,
    nonEncounter,
    actorPlacement: actorPlacement ? structuredClone(actorPlacement) : null,
    actorSheet,
    source: source.instance,
    sourceDefinition,
    sourceEntry: source.entry,
    targets: Object.freeze(targets),
    sheets,
    groupInventory,
    readSet: command.readSet,
  })
}
