import type { EncounterEffect } from '#shared/moveAutomation/encounterEffects'
import type { MoveAttackSourceId } from '#shared/moveAutomation/attackSource'
import type { MoveHistoryMoveListSource } from '#shared/moveAutomation/moveHistoryMetadata'
import { directHpLossRollFormulaForScript } from '~/utils/moveAutomationDirectHpLoss'
import { damageFormulaForMove } from '~/utils/moveAutomation'
import { buildMoveAutomationMoveEntries, type MoveAutomationMoveEntry } from '~/utils/moveAutomationMoves'
import {
  buildTokenMoveUsageState,
  moveEntriesForPlacement,
  type MapTokenSheetLookup,
  type TokenMoveUsageContext,
  type TokenMoveUsageMenuState,
  type TokenSheetMoveEntry,
} from '~/utils/mapTokenMoves'
import { moveConditionUseBlock, type MoveConditionUseBlock } from '~/utils/moveConditionRestrictions'
import { moveHasSonicKeyword } from '~/utils/sheetPassiveAbilityEffects'
import type { SheetPlacement } from '~/types/map'
import type { MoveAutomationScript } from '~/types/moveAutomation'
import type { SpawnedPokemon } from '~/types/pokemon'

export type CanonicalMoveEntryFailureReason =
  | 'missing-placement'
  | 'missing-token'
  | 'move-absent'
  | 'condition-blocked'
  | 'usage-blocked'
  | 'move-list-blocked'
  | 'attack-source-invalid'
  | 'attack-source-ambiguous'
  | 'creature-rule-blocked'
  | 'copied-spec-mismatch'

export interface ResolvedCanonicalMoveEntry extends MoveAutomationMoveEntry {
  readonly canonicalMoveName: string
  readonly sourceEntry: TokenSheetMoveEntry
  readonly automatic: boolean
  readonly script: MoveAutomationScript
  readonly frequency: string | null
  readonly damageFormula: string | null
  readonly conditionUseBlock: MoveConditionUseBlock | null
  readonly usage: TokenMoveUsageMenuState | null
  readonly moveListSource: MoveHistoryMoveListSource
  readonly copiedSpecHash: string | null
}

export interface CanonicalMoveEntrySuccess {
  readonly ok: true
  readonly entry: ResolvedCanonicalMoveEntry
}

export interface CanonicalMoveEntryFailure {
  readonly ok: false
  readonly reason: CanonicalMoveEntryFailureReason
  readonly message: string
  readonly conditionUseBlock?: MoveConditionUseBlock
  readonly usage?: TokenMoveUsageMenuState
}

export type CanonicalMoveEntryResult = CanonicalMoveEntrySuccess | CanonicalMoveEntryFailure

export interface ResolveCanonicalMoveEntryInput {
  readonly placement: Pick<SheetPlacement, 'id' | 'sheetKind' | 'sheetSlug'> | null | undefined
  readonly token: SpawnedPokemon | null | undefined
  readonly sheets: MapTokenSheetLookup
  readonly moveName: string
  /** String selects exact source; null requires ordinary; undefined allows bounded legacy inference. */
  readonly attackSourceId?: MoveAttackSourceId | null
  readonly usageContext?: TokenMoveUsageContext
  readonly encounterEffects?: readonly EncounterEffect[]
  /** Exact effective Ability names used to project reviewed Connection moves. */
  readonly abilityConnectionNames?: readonly string[]
  /** Server-reviewed form or encounter move grants. */
  readonly additionalMoveNames?: readonly string[]
  /** Complete server-reviewed supplemental Move records, such as Capability weapon Moves. */
  readonly additionalMoveEntries?: readonly TokenSheetMoveEntry[]
  /** Server resolution injects the immutable runtime selected for this snapshot. */
  readonly scriptForMove?: (moveName: string) => MoveAutomationScript | null
  /** Required by server contexts to reject stale temporary copies after runtime drift. */
  readonly definitionHashForMove?: (moveName: string) => string | null
  /** Server-owned effective ability/provider overlay applied before usage availability. */
  readonly frequencyForMove?: (canonicalMoveName: string, frequency: string | null) => string | null
}

const cloneJson = <T>(value: T): T => {
  if (value == null) return value
  return JSON.parse(JSON.stringify(value)) as T
}

const resolvedFrequencyForEntry = (entry: MoveAutomationMoveEntry): string | null =>
  entry.move.frequency ?? entry.sheetMove.frequency ?? null

export const damageFormulaForResolvedMoveEntry = (entry: Pick<MoveAutomationMoveEntry, 'script' | 'move'>): string | null =>
  directHpLossRollFormulaForScript(entry.script) ?? damageFormulaForMove(entry.move)

const normalizeMoveName = (value: string): string => value.trim().toLowerCase()

const moveEntryMatchesName = (entry: MoveAutomationMoveEntry, normalizedMoveName: string): boolean => [
  entry.move.name,
  entry.sheetMove.name,
  entry.script.moveName,
]
  .some((name) => name.trim().toLowerCase() === normalizedMoveName)

const moveListSourceFor = (
  sourceEntry: TokenSheetMoveEntry,
  placementId: string,
): { readonly source: MoveHistoryMoveListSource; readonly copiedSpecHash: string | null } => {
  const projection = sourceEntry.moveListProjection
  if (projection?.source.kind === 'encounter-overlay') {
    return {
      source: {
        kind: 'encounter-overlay',
        placementId,
        effectId: projection.source.effectId,
      },
      copiedSpecHash: projection.source.copiedSpecHash,
    }
  }
  return {
    source: { kind: 'placement', placementId },
    copiedSpecHash: null,
  }
}

const buildResolvedMoveEntries = (
  sourceEntries: readonly TokenSheetMoveEntry[],
  token: SpawnedPokemon,
  scriptForMove?: (moveName: string) => MoveAutomationScript | null,
): ResolvedCanonicalMoveEntry[] => sourceEntries.flatMap((sourceEntry) => buildMoveAutomationMoveEntries([sourceEntry.move], {
  stabTypes: sourceEntry.suppressStab ? [] : token.sheetKind === 'pokemon' ? token.defenderTypes : [],
  combatSkillRankValue: token.combatSkillRankValue,
  loyalty: token.sheetKind === 'pokemon' ? token.loyalty : undefined,
  ...(scriptForMove ? { scriptForMove } : {}),
}).map((entry) => {
  const rawBonus = sourceEntry.presentationDamageBaseBonus
  const presentationDamageBaseBonus = typeof rawBonus === 'number'
    && Number.isSafeInteger(rawBonus) && Math.abs(rawBonus) <= 20
    ? rawBonus
    : 0
  const clonedMove = cloneJson(entry.move)
  const clonedScript = cloneJson(entry.script)
  const clonedEntry: MoveAutomationMoveEntry = {
    label: entry.label,
    sheetMove: cloneJson(entry.sheetMove),
    move: presentationDamageBaseBonus !== 0 && typeof clonedMove.damage_base === 'number'
      ? { ...clonedMove, damage_base: clonedMove.damage_base + presentationDamageBaseBonus }
      : clonedMove,
    script: presentationDamageBaseBonus !== 0 && typeof clonedScript.damageBase === 'number'
      ? { ...clonedScript, damageBase: clonedScript.damageBase + presentationDamageBaseBonus }
      : clonedScript,
    hasStab: entry.hasStab,
  }
  const frequency = resolvedFrequencyForEntry(clonedEntry)
  const moveList = moveListSourceFor(sourceEntry, token.id)
  return {
    ...clonedEntry,
    canonicalMoveName: clonedEntry.move.name,
    sourceEntry: {
      move: cloneJson(sourceEntry.move),
      automatic: sourceEntry.automatic,
      ...(sourceEntry.suppressStab ? { suppressStab: true } : {}),
      ...(sourceEntry.attackSourceId ? { attackSourceId: sourceEntry.attackSourceId } : {}),
      ...(sourceEntry.attackSourceLabel ? { attackSourceLabel: sourceEntry.attackSourceLabel } : {}),
      ...(sourceEntry.moveListProjection
        ? { moveListProjection: cloneJson(sourceEntry.moveListProjection) }
        : {}),
    },
    automatic: sourceEntry.automatic,
    frequency,
    damageFormula: damageFormulaForResolvedMoveEntry(clonedEntry),
    conditionUseBlock: null,
    usage: null,
    moveListSource: moveList.source,
    copiedSpecHash: moveList.copiedSpecHash,
  }
}))

const matchingResolvedMoveEntriesForPlacement = (input: ResolveCanonicalMoveEntryInput): ResolvedCanonicalMoveEntry[] => {
  if (!input.placement || !input.token) return []
  const sourceEntries = moveEntriesForPlacement(input.placement, input.sheets, {
    encounterEffects: input.encounterEffects,
    ...(input.abilityConnectionNames ? { abilityConnectionNames: input.abilityConnectionNames } : {}),
    ...(input.additionalMoveNames ? { additionalMoveNames: input.additionalMoveNames } : {}),
    ...(input.additionalMoveEntries ? { additionalMoveEntries: input.additionalMoveEntries } : {}),
  })
  const normalizedMoveName = normalizeMoveName(input.moveName)
  return buildResolvedMoveEntries(sourceEntries, input.token, input.scriptForMove)
    .filter(candidate => moveEntryMatchesName(candidate, normalizedMoveName))
}

/** All structurally available source identities before condition/usage checks. */
export const canonicalMoveAttackSourceCandidatesForPlacement = (
  input: ResolveCanonicalMoveEntryInput,
): readonly (MoveAttackSourceId | null)[] => Object.freeze([
  ...new Set(matchingResolvedMoveEntriesForPlacement(input)
    .map(entry => entry.sourceEntry.attackSourceId ?? null)),
])

export const resolveCanonicalMoveEntryForPlacement = ({
  placement,
  token,
  sheets,
  moveName,
  attackSourceId,
  usageContext = {},
  encounterEffects,
  abilityConnectionNames,
  additionalMoveNames,
  additionalMoveEntries,
  scriptForMove,
  definitionHashForMove,
  frequencyForMove,
}: ResolveCanonicalMoveEntryInput): CanonicalMoveEntryResult => {
  if (!placement) {
    return { ok: false, reason: 'missing-placement', message: 'Actor placement is missing.' }
  }
  if (!token) {
    return { ok: false, reason: 'missing-token', message: 'Actor token could not be resolved.' }
  }

  const matchingEntries = matchingResolvedMoveEntriesForPlacement({
    placement,
    token,
    sheets,
    moveName,
    attackSourceId,
    usageContext,
    encounterEffects,
    abilityConnectionNames,
    additionalMoveNames,
    additionalMoveEntries,
    scriptForMove,
    definitionHashForMove,
    frequencyForMove,
  })
  const unsourcedEntry = matchingEntries.find(candidate => !candidate.sourceEntry.attackSourceId) ?? null
  const sourcedEntries = matchingEntries.filter(candidate => candidate.sourceEntry.attackSourceId)
  const uniqueSourcedIds = [...new Set(sourcedEntries.flatMap(candidate => (
    candidate.sourceEntry.attackSourceId ? [candidate.sourceEntry.attackSourceId] : []
  )))]
  const uniquelySourcedEntry = uniqueSourcedIds.length === 1
    ? sourcedEntries.find(candidate => candidate.sourceEntry.attackSourceId === uniqueSourcedIds[0]) ?? null
    : null
  const entry = typeof attackSourceId === 'string'
    ? sourcedEntries.find(candidate => candidate.sourceEntry.attackSourceId === attackSourceId) ?? null
    : attackSourceId === null
      ? unsourcedEntry
      : unsourcedEntry ?? uniquelySourcedEntry

  if (!entry) {
    if (typeof attackSourceId === 'string') {
      return {
        ok: false,
        reason: 'attack-source-invalid',
        message: `${moveName.trim() || 'Move'} is not available from the selected attack source.`,
      }
    }
    if (attackSourceId === undefined && uniqueSourcedIds.length > 1) {
      return {
        ok: false,
        reason: 'attack-source-ambiguous',
        message: `${moveName.trim() || 'Move'} has multiple valid attack sources; select one exact source.`,
      }
    }
    return {
      ok: false,
      reason: 'move-absent',
      message: `${moveName.trim() || 'Move'} is not available to ${token.species}.`,
    }
  }

  const effectiveEntry: ResolvedCanonicalMoveEntry = frequencyForMove
    ? { ...entry, frequency: frequencyForMove(entry.canonicalMoveName, entry.frequency) }
    : entry

  const moveListProjection = effectiveEntry.sourceEntry.moveListProjection
  if (moveListProjection?.available === false) {
    const label = moveListProjection.blockReason === 'move-list-disabled'
      ? 'disabled by an encounter effect'
      : 'outside the encounter move restriction'
    return {
      ok: false,
      reason: 'move-list-blocked',
      message: `${entry.move.name} is ${label}.`,
    }
  }

  if (effectiveEntry.copiedSpecHash !== null && definitionHashForMove) {
    const selectedDefinitionHash = definitionHashForMove(effectiveEntry.canonicalMoveName)
    if (selectedDefinitionHash !== effectiveEntry.copiedSpecHash) {
      return {
        ok: false,
        reason: 'copied-spec-mismatch',
        message: `${entry.move.name}'s temporary copy no longer matches its reviewed runtime definition.`,
      }
    }
  }

  if (token.creatureRules?.sonicLocked && moveHasSonicKeyword(entry.script.keywords)) {
    return {
      ok: false,
      reason: 'creature-rule-blocked',
      message: `${entry.move.name} is blocked while Sonic moves are locked.`,
    }
  }

  const conditionUseBlock = moveConditionUseBlock({
    name: entry.move.name,
    aliases: [entry.sheetMove.name, entry.script.moveName],
    damageClass: entry.script.damageClass ?? entry.move.damage_class,
    frequency: effectiveEntry.frequency,
  }, token.conditions)
  if (conditionUseBlock) {
    return {
      ok: false,
      reason: 'condition-blocked',
      message: `${entry.move.name} is blocked by ${conditionUseBlock.label}.`,
      conditionUseBlock,
    }
  }

  const usage = buildTokenMoveUsageState(
    token.id,
    effectiveEntry.move.name,
    effectiveEntry.frequency,
    usageContext,
  )
  if (usage?.available === false) {
    return {
      ok: false,
      reason: 'usage-blocked',
      message: `${entry.move.name} is not currently available (${usage.label}).`,
      usage,
    }
  }

  return {
    ok: true,
    entry: {
      ...effectiveEntry,
      conditionUseBlock,
      usage,
    },
  }
}
