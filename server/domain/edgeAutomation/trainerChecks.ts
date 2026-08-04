import type { TrainerSheet, TrainerSkillKey } from '~/types/trainerSheet'
import { edgeChoiceValues } from '#shared/edgeAutomation/instances'
import { resolvedSheetEdgeInstances, sheetHasCanonicalEdge } from '#shared/edgeAutomation/sheetEdges'
import { resolveTrainerSkills } from '~/utils/sheets/trainerDerived'

export type TrainerEdgeCheckContext =
  | 'ordinary'
  | 'low-loyalty-command'
  | 'training-limit'
  | 'pokemon-social'
  | 'wild-disposition'
  | 'grapple-push-trip-defense'
  | 'mount-initial'
  | 'remain-mounted'
  | 'education-assist'

export interface TrainerEdgeCheckRequest {
  readonly sheet: TrainerSheet
  readonly requestedSkill: TrainerSkillKey
  readonly context: TrainerEdgeCheckContext
  readonly targetPokemonTypes?: readonly string[]
  readonly useSkillStuntInstanceId?: string | null
  /** Server-reviewed circumstance identity/label for the current check. */
  readonly circumstance?: string | null
}

export interface TrainerEdgeCheckProjection {
  readonly requestedSkill: TrainerSkillKey
  readonly effectiveSkill: TrainerSkillKey
  readonly rankValue: number
  readonly dice: string
  readonly modifier: number
  readonly automaticSuccess: boolean
  readonly assistRankFraction: number
  readonly diceDelta: number
  readonly flatRollBonus: number
  readonly contributions: readonly {
    readonly instanceId: string
    readonly canonicalId: string
    readonly label: string
    readonly value: number | string | boolean
  }[]
}

const normalized = (value: string): string => value.normalize('NFKC').trim().toLocaleLowerCase('en-US')

/** Exact server-side substitution and bonus projection for Trainer Edge checks. */
export const resolveTrainerEdgeCheck = (request: TrainerEdgeCheckRequest): TrainerEdgeCheckProjection => {
  const instances = resolvedSheetEdgeInstances(request.sheet, 'trainer')
  const contributions: Array<TrainerEdgeCheckProjection['contributions'][number]> = []
  let effectiveSkill = request.requestedSkill

  const substitute = (canonicalId: string, skill: TrainerSkillKey, label: string): void => {
    const instance = instances.find(candidate => candidate.canonicalId === canonicalId)
    if (!instance) return
    effectiveSkill = skill
    contributions.push({ instanceId: instance.instanceId, canonicalId, label, value: skill })
  }

  if (request.context === 'low-loyalty-command' || request.context === 'training-limit') {
    substitute('Beast Master', 'intimidate', 'Intimidate substitutes for Command')
  }
  if (request.context === 'pokemon-social') {
    substitute('PokéPsychologist', 'pokeEd', 'Pokémon Education substitutes for the social Skill')
  }
  if (request.context === 'wild-disposition') {
    substitute('Mystic Senses', 'intuition', 'Intuition substitutes for Charm')
  }
  if (request.context === 'grapple-push-trip-defense') {
    substitute('Slippery', 'stealth', 'Stealth substitutes on defense')
  }

  const skill = resolveTrainerSkills(request.sheet).find(row => row.key === effectiveSkill)
  let modifier = skill?.modifier ?? 0
  let automaticSuccess = false
  let assistRankFraction = 0.5
  let diceDelta = 0
  let flatRollBonus = 0

  if (request.context === 'mount-initial') {
    const instance = instances.find(candidate => candidate.canonicalId === 'Mounted Prowess')
    if (instance && (effectiveSkill === 'acrobatics' || effectiveSkill === 'athletics')) {
      automaticSuccess = true
      contributions.push({ instanceId: instance.instanceId, canonicalId: instance.canonicalId, label: 'Mount check automatically succeeds', value: true })
    }
  }
  if (request.context === 'remain-mounted') {
    const instance = instances.find(candidate => candidate.canonicalId === 'Mounted Prowess')
    if (instance && (effectiveSkill === 'acrobatics' || effectiveSkill === 'athletics')) {
      modifier += 3
      contributions.push({ instanceId: instance.instanceId, canonicalId: instance.canonicalId, label: '+3 to remain mounted', value: 3 })
    }
  }
  if (request.context === 'education-assist' && ['generalEd', 'medicineEd', 'occultEd', 'pokeEd', 'techEd'].includes(effectiveSkill)
    && (skill?.rankValue ?? 0) >= 3) {
    const instance = instances.find(candidate => candidate.canonicalId === 'Instruction')
    if (instance) {
      assistRankFraction = 1
      contributions.push({ instanceId: instance.instanceId, canonicalId: instance.canonicalId, label: 'Full rank added to assisted check', value: 1 })
    }
  }

  if (['charm', 'command', 'guile', 'intimidate', 'intuition'].includes(effectiveSkill)
    && (request.targetPokemonTypes?.length ?? 0) > 0) {
    for (const instance of instances.filter(candidate => candidate.canonicalId === 'Elemental Connection')) {
      const selectedType = edgeChoiceValues(instance, 'type')[0]
      if (selectedType && request.targetPokemonTypes!.some(type => normalized(type) === normalized(selectedType))) {
        modifier += 2
        contributions.push({ instanceId: instance.instanceId, canonicalId: instance.canonicalId, label: `+2 against ${selectedType}-Type Pokémon`, value: 2 })
      }
    }
  }

  if (request.useSkillStuntInstanceId) {
    const stunt = instances.find(candidate => candidate.instanceId === request.useSkillStuntInstanceId
      && candidate.canonicalId === 'Skill Stunt')
    if (stunt) {
      const selectedSkill = edgeChoiceValues(stunt, 'skill')[0]
      const circumstance = edgeChoiceValues(stunt, 'circumstance')[0]
      if (selectedSkill === effectiveSkill && circumstance && request.circumstance
        && normalized(circumstance) === normalized(request.circumstance)) {
        diceDelta = -1
        flatRollBonus = 6
        contributions.push({ instanceId: stunt.instanceId, canonicalId: stunt.canonicalId, label: `Skill Stunt: ${circumstance}`, value: 6 })
      }
    }
  }

  return Object.freeze({
    requestedSkill: request.requestedSkill,
    effectiveSkill,
    rankValue: skill?.rankValue ?? 2,
    dice: skill?.dice ?? '2d6',
    modifier,
    automaticSuccess,
    assistRankFraction,
    diceDelta,
    flatRollBonus,
    contributions: Object.freeze(contributions),
  })
}

export const trainerEdgeApRaiseBonusPerPoint = (sheet: TrainerSheet, pokemonOwnedRoll = false): number => (
  !pokemonOwnedRoll && sheetHasCanonicalEdge(sheet, 'trainer', 'Instinctive Aptitude') ? 2 : 1
)

/** Virtuoso is rank 8 only for Features/effects, never for ordinary Skill dice. */
export const trainerEffectiveSkillRankForEffects = (sheet: TrainerSheet, skillId: TrainerSkillKey): number => {
  const base = resolveTrainerSkills(sheet).find(skill => skill.key === skillId)?.rankValue ?? 2
  return resolvedSheetEdgeInstances(sheet, 'trainer').some(instance => instance.canonicalId === 'Virtuoso'
    && edgeChoiceValues(instance, 'skill').includes(skillId)) ? Math.max(8, base) : base
}
