export const FABULOUS_TRIM_GRANTED_ABILITIES = Object.freeze({
  star: 'Celebrate',
  diamond: 'Defiant',
  heart: 'Cute Tears',
  pharaoh: 'Sand Veil',
  kabuki: 'Inner Focus',
  'la-reine': 'Intimidate',
  matron: 'Friend Guard',
  dandy: 'Moxie',
  debutante: 'Confidence',
} as const)

export type FabulousTrimId = keyof typeof FABULOUS_TRIM_GRANTED_ABILITIES

export const fabulousTrimGrantedAbility = (trimId: string): string | null => (
  Object.prototype.hasOwnProperty.call(FABULOUS_TRIM_GRANTED_ABILITIES, trimId)
    ? FABULOUS_TRIM_GRANTED_ABILITIES[trimId as FabulousTrimId]
    : null
)
