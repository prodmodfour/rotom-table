import { createHash } from 'node:crypto'
import { normalizeRevision } from '#shared/sessionRevisions'
import { createEmptyEncounterState, parseEncounterState } from '#shared/moveAutomation/encounterState'
import { parseMapGroundItem } from '#shared/moveAutomation/groundItems'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import type { MoveAutomationScript } from '~/types/moveAutomation'
import type { TrainerSheet } from '~/types/trainerSheet'
import { findItem } from '~~/data/ptuReference'
import { placementToSpawned } from '~/utils/placement'
import { deepCloneJson } from '~/utils/serialization'
import { moveAutomationUserAccuracy, resolveMoveAutomationTargetEvasion } from '~/utils/moveAutomationAccuracy'
import { createMoveAutomationScriptFromMoveData } from '~/utils/moveAutomationDerived'
import { parseSkillDiceValue } from '~/utils/skillRanks'
import { resolveSkills } from '~/utils/sheets/pokemonDerived'
import { resolveTrainerSkills } from '~/utils/sheets/trainerDerived'
import { ptuGridDistanceBetweenFootprints } from '~/utils/ptuGridDistance'
import { resolveEffectiveCapabilities } from '../capabilityAutomation/effectiveCapabilities'
import {
  physicalPowerSourceValues,
  projectPhysicalPowerLoadToken,
} from '../capabilityAutomation/physicalPower'

export interface AuthoritativeManeuverRoll {
  readonly id: string
  readonly expression: string
  readonly rolls: readonly number[]
  readonly modifier: number
  readonly total: number
}

export interface AuthoritativeDisarmResult {
  readonly map: TabletopMap
  readonly targetSheet: CharacterSheet | TrainerSheet
  readonly changedTargetSheet: boolean
  readonly outcome: 'missed' | 'resisted' | 'no-item' | 'disarmed-item' | 'disarmed-living-weapon'
  readonly rolls: readonly AuthoritativeManeuverRoll[]
  readonly lines: readonly string[]
}

export interface ResolveAuthoritativeDisarmInput {
  readonly map: TabletopMap
  readonly actorPlacement: SheetPlacement
  readonly targetPlacement: SheetPlacement
  readonly actorSheet: CharacterSheet | TrainerSheet
  readonly targetSheet: CharacterSheet | TrainerSheet
  readonly pokemonSheets: ReadonlyMap<string, CharacterSheet>
  readonly trainerSheets: ReadonlyMap<string, TrainerSheet>
  readonly operationId: string
  readonly rollDie: (label: string, sides: number) => number
}

const DISARM_SCRIPT: MoveAutomationScript = createMoveAutomationScriptFromMoveData({
  name: 'Disarm', type: 'Normal', frequency: 'At-Will', ac: 6,
  damage_class: 'Status', range: 'Melee, 1 Target',
  effect: 'Opposed Combat or Stealth Checks; the loser drops one wielded item.',
})

const skillExpression = (
  sheet: CharacterSheet | TrainerSheet,
  kind: SheetPlacement['sheetKind'],
  skill: 'combat' | 'stealth',
): { readonly count: number; readonly modifier: number } => {
  if (kind === 'trainer') {
    const resolved = resolveTrainerSkills(sheet as TrainerSheet).find(entry => entry.key === skill)
    const parsed = parseSkillDiceValue(resolved?.dice) ?? { dice: 2, modifier: 0 }
    return { count: parsed.dice, modifier: parsed.modifier + (resolved?.modifier ?? 0) }
  }
  const resolved = resolveSkills(sheet as CharacterSheet).find(entry => entry.key === skill)
  const parsed = parseSkillDiceValue(resolved?.value) ?? { dice: 2, modifier: 0 }
  return { count: parsed.dice, modifier: parsed.modifier }
}

const bestDisarmSkill = (
  sheet: CharacterSheet | TrainerSheet,
  kind: SheetPlacement['sheetKind'],
): { readonly skill: 'combat' | 'stealth'; readonly count: number; readonly modifier: number } => {
  const candidates = (['combat', 'stealth'] as const).map(skill => ({
    skill,
    ...skillExpression(sheet, kind, skill),
  }))
  return candidates.sort((left, right) => (
    (right.count * 3.5 + right.modifier) - (left.count * 3.5 + left.modifier)
      || right.count - left.count
      || right.modifier - left.modifier
      || left.skill.localeCompare(right.skill)
  ))[0]!
}

const roll = (
  input: ResolveAuthoritativeDisarmInput,
  id: string,
  count: number,
  sides: number,
  modifier: number,
): AuthoritativeManeuverRoll => {
  const rolls = Array.from({ length: count }, (_unused, index) => {
    const value = input.rollDie(`${id}:${index}`, sides)
    if (!Number.isSafeInteger(value) || value < 1 || value > sides) {
      throw new Error(`${id} produced an invalid d${sides} result.`)
    }
    return value
  })
  const total = rolls.reduce((sum, value) => sum + value, modifier)
  return Object.freeze({
    id,
    expression: `${count}d${sides}${modifier === 0 ? '' : modifier > 0 ? `+${modifier}` : modifier}`,
    rolls: Object.freeze(rolls),
    modifier,
    total,
  })
}

const itemId = (name: string): string => name.normalize('NFKD')
  .toLocaleLowerCase('en-US')
  .replace(/[’']/g, '')
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-|-$/g, '')
  .slice(0, 160) || 'disarmed-item'

const groundOperationId = (operationId: string): string => `op_maneuver_${createHash('sha256')
  .update(operationId).digest('hex').slice(0, 32)}`

const rollLine = (label: string, result: AuthoritativeManeuverRoll): string => (
  `${label}: ${result.expression} [${result.rolls.join(', ')}] = ${result.total}`
)

/** Resolve canonical Disarm from frozen map/sheet state without mutating inputs. */
export const resolveAuthoritativeDisarm = (
  input: ResolveAuthoritativeDisarmInput,
): AuthoritativeDisarmResult => {
  const sheets = {
    pokemon: new Map(input.pokemonSheets),
    trainer: new Map(input.trainerSheets),
  }
  const actorBaseToken = placementToSpawned(input.actorPlacement, sheets, input.map)
  const targetBaseToken = placementToSpawned(input.targetPlacement, sheets, input.map)
  if (!actorBaseToken || !targetBaseToken) throw new Error('Disarm participants are unavailable.')
  const withPhysicalLoad = (
    token: typeof actorBaseToken,
    placement: SheetPlacement,
    sheet: CharacterSheet | TrainerSheet,
  ) => {
    const effective = resolveEffectiveCapabilities({
      map: input.map, placement, sheet, sheets,
    }).instances.filter(instance => instance.effective)
    return projectPhysicalPowerLoadToken({
      token,
      map: input.map,
      placementId: placement.id,
      powerByCapabilityInstanceId: physicalPowerSourceValues(effective),
    })
  }
  const actorToken = withPhysicalLoad(actorBaseToken, input.actorPlacement, input.actorSheet)
  const targetToken = withPhysicalLoad(targetBaseToken, input.targetPlacement, input.targetSheet)
  if (ptuGridDistanceBetweenFootprints(actorToken, targetToken) > 1) {
    throw new Error('Disarm requires an adjacent target.')
  }

  const accuracyModifier = moveAutomationUserAccuracy(actorToken, { fieldEffects: input.map.fieldEffects })
    - resolveMoveAutomationTargetEvasion(DISARM_SCRIPT, targetToken, {
      attacker: actorToken,
      fieldEffects: input.map.fieldEffects,
    }).value
  const accuracy = roll(input, 'disarm.accuracy', 1, 20, accuracyModifier)
  // PTU's universal Accuracy rule keeps a natural 1 as a miss even when
  // Accuracy bonuses would otherwise meet the Maneuver's AC.
  if (accuracy.rolls[0] === 1 || accuracy.total < 6) return {
    map: input.map,
    targetSheet: input.targetSheet,
    changedTargetSheet: false,
    outcome: 'missed',
    rolls: [accuracy],
    lines: [rollLine('Disarm Accuracy', accuracy), 'Disarm missed AC 6.'],
  }

  const actorSkill = bestDisarmSkill(input.actorSheet, input.actorPlacement.sheetKind)
  const targetSkill = bestDisarmSkill(input.targetSheet, input.targetPlacement.sheetKind)
  const hasWielder = input.actorPlacement.sheetKind === 'pokemon'
    && resolveEffectiveCapabilities({
      map: input.map,
      placement: input.actorPlacement,
      sheet: input.actorSheet,
      sheets,
    }).instances.some(instance => instance.effective && instance.canonicalId === 'Wielder')
  const actorCheck = roll(
    input,
    `disarm.actor-${actorSkill.skill}`,
    actorSkill.count,
    6,
    actorSkill.modifier + (hasWielder ? 2 : 0),
  )
  const targetCheck = roll(
    input,
    `disarm.target-${targetSkill.skill}`,
    targetSkill.count,
    6,
    targetSkill.modifier,
  )
  const commonLines = [
    rollLine('Disarm Accuracy', accuracy),
    rollLine(`Actor ${actorSkill.skill}${hasWielder ? ' (Wielder +2)' : ''}`, actorCheck),
    rollLine(`Target ${targetSkill.skill}`, targetCheck),
  ]
  if (actorCheck.total <= targetCheck.total) return {
    map: input.map,
    targetSheet: input.targetSheet,
    changedTargetSheet: false,
    outcome: 'resisted',
    rolls: [accuracy, actorCheck, targetCheck],
    lines: [...commonLines, 'The target resisted Disarm.'],
  }

  const targetSheet = deepCloneJson(input.targetSheet)
  let droppedName: string | null = null
  if (input.targetPlacement.sheetKind === 'pokemon') {
    droppedName = (targetSheet as CharacterSheet).items?.held?.trim() || null
    if (droppedName) {
      const pokemon = targetSheet as CharacterSheet
      Object.assign(targetSheet, { ...pokemon, items: { ...(pokemon.items ?? {}), held: '' } })
    }
  }
  else {
    const trainer = targetSheet as TrainerSheet
    droppedName = trainer.equipmentSlots?.mainHand?.trim()
      || trainer.equipmentSlots?.offHand?.trim()
      || null
    if (droppedName) {
      const slots = { ...(trainer.equipmentSlots ?? {}) }
      if (slots.mainHand?.trim()) slots.mainHand = ''
      else slots.offHand = ''
      Object.assign(targetSheet, { ...trainer, equipmentSlots: slots })
    }
  }

  if (droppedName) {
    const canonicalName = findItem(droppedName)?.name ?? droppedName
    const encounter = parseEncounterState(input.map.encounterState ?? createEmptyEncounterState())
    const groundItem = parseMapGroundItem({
      id: `ground.maneuver-disarm.${createHash('sha256').update(input.operationId).digest('hex').slice(0, 32)}`,
      canonicalItemId: itemId(canonicalName),
      canonicalItemName: canonicalName,
      quantity: 1,
      position: { ...input.targetPlacement.position },
      sourceResource: {
        kind: 'sheet',
        sheetKind: input.targetPlacement.sheetKind,
        slug: input.targetPlacement.sheetSlug,
        revision: normalizeRevision(input.targetSheet.revision),
      },
      sourceOperationId: groundOperationId(input.operationId),
      sideId: input.targetPlacement.sideId ?? null,
      ownerPlacementId: input.targetPlacement.id,
    }, 'maneuver.disarm.groundItem')
    return {
      map: {
        ...input.map,
        encounterState: parseEncounterState({
          ...encounter,
          groundItems: [...encounter.groundItems, groundItem],
        }),
      },
      targetSheet,
      changedTargetSheet: true,
      outcome: 'disarmed-item',
      rolls: [accuracy, actorCheck, targetCheck],
      lines: [...commonLines, `${canonicalName} fell at the target's cell.`],
    }
  }

  const encounter = parseEncounterState(input.map.encounterState ?? createEmptyEncounterState())
  const capabilityRuntime = encounter.capabilityRuntime
  const livingWeaponLink = capabilityRuntime?.links.find(link => (
    link.kind === 'living-weapon'
    && link.participantPlacementIds.includes(input.targetPlacement.id)
  ))
  if (livingWeaponLink) {
    return {
      map: {
        ...input.map,
        encounterState: parseEncounterState({
          ...encounter,
          capabilityRuntime: {
            ...capabilityRuntime!,
            links: capabilityRuntime!.links.filter(link => link.id !== livingWeaponLink.id),
          },
        }),
      },
      targetSheet,
      changedTargetSheet: false,
      outcome: 'disarmed-living-weapon',
      rolls: [accuracy, actorCheck, targetCheck],
      lines: [...commonLines, 'The Living Weapon disengaged and fell at the wielder’s cell.'],
    }
  }

  return {
    map: input.map,
    targetSheet: input.targetSheet,
    changedTargetSheet: false,
    outcome: 'no-item',
    rolls: [accuracy, actorCheck, targetCheck],
    lines: [...commonLines, 'The target had no wielded item to drop.'],
  }
}
