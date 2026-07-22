import type { EncounterEffect } from '#shared/moveAutomation/encounterEffects'
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
  readonly usageContext?: TokenMoveUsageContext
  readonly encounterEffects?: readonly EncounterEffect[]
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
  stabTypes: token.sheetKind === 'pokemon' ? token.defenderTypes : [],
  combatSkillRankValue: token.combatSkillRankValue,
  loyalty: token.sheetKind === 'pokemon' ? token.loyalty : undefined,
  ...(scriptForMove ? { scriptForMove } : {}),
}).map((entry) => {
  const clonedEntry: MoveAutomationMoveEntry = {
    label: entry.label,
    sheetMove: cloneJson(entry.sheetMove),
    move: cloneJson(entry.move),
    script: cloneJson(entry.script),
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

export const resolveCanonicalMoveEntryForPlacement = ({
  placement,
  token,
  sheets,
  moveName,
  usageContext = {},
  encounterEffects,
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

  const normalizedMoveName = normalizeMoveName(moveName)
  const sourceEntries = moveEntriesForPlacement(placement, sheets, { encounterEffects })
  const entry = buildResolvedMoveEntries(sourceEntries, token, scriptForMove)
    .find((candidate) => moveEntryMatchesName(candidate, normalizedMoveName)) ?? null

  if (!entry) {
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
