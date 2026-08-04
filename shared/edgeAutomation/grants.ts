import type { EdgeInstanceData } from './instances'
import { edgeChoiceValues } from './instances'

export const TRAINER_EDGE_MOVE_GRANTS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  'Athletic Initiative': Object.freeze(['Agility']),
  'Basic Martial Arts': Object.freeze(['Rock Smash']),
  'Basic Psionics': Object.freeze(['Confusion']),
  'Charmer': Object.freeze(['Baby-Doll Eyes']),
  'Confidence Artist': Object.freeze(['Confide']),
  'Intimidating Presence': Object.freeze(['Leer']),
  'Leader': Object.freeze(['After You']),
  'Sneak’s Tricks': Object.freeze(['Astonish']),
  'Survival Drive': Object.freeze(['Bulk Up']),
  'Work Up': Object.freeze(['Work Up']),
})

export const pokeEdgeAbilityGrants = (instance: EdgeInstanceData): readonly string[] => {
  if (instance.family !== 'poke') return []
  if (instance.canonicalId === 'Mixed Power') return Object.freeze(['Twisted Power'])
  if (instance.canonicalId === 'Ability Mastery') return edgeChoiceValues(instance, 'choice-1')
  return Object.freeze([])
}

export const pokeEdgeMoveGrants = (instance: EdgeInstanceData): readonly string[] => (
  instance.family === 'poke' && instance.canonicalId === 'Underdog’s Lessons'
    ? edgeChoiceValues(instance, 'choice-2') : Object.freeze([])
)

export const pokeEdgeCapabilityGrants = (instance: EdgeInstanceData): readonly string[] => (
  instance.family === 'poke' && instance.canonicalId === 'Aura Pulse'
    ? Object.freeze(['Aura Pulse']) : Object.freeze([])
)
