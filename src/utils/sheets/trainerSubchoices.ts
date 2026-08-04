import { edges, features, findAbility, findEdge, findFeature, findMove, moves, toSlug } from '~~/data/ptuReference'
import { POKEMON_TRAINING_FEATURE_OPTIONS } from '~/utils/sheets/pokemonTrainingFeatures'
import { TRAINER_SKILL_ORDER } from '~/utils/sheets/trainerSkillConstants'
import type { EditableCellOption, EditableCellValue } from '~/utils/editableCell'
import type { TrainerEdgeEntry, TrainerFeatureEntry, TrainerSkillKey } from '~/types/trainerSheet'

export type TrainerChoiceEntry = TrainerFeatureEntry | TrainerEdgeEntry
export type TrainerChoiceResolver<T extends TrainerChoiceEntry = TrainerChoiceEntry> = (
  entry: T,
) => readonly TrainerSubchoiceDefinition[]

export type TrainerSubchoiceReferenceKind = 'ability' | 'edge' | 'feature' | 'move'

export interface TrainerSubchoiceDefinition {
  key: string
  label: string
  options: readonly EditableCellOption[]
  inputType?: 'select' | 'text'
  placeholder?: string
  legacyField?: 'basicSkill'
  legacyKeys?: readonly string[]
  referenceKinds?: readonly TrainerSubchoiceReferenceKind[]
  descriptions?: Readonly<Record<string, string>>
  subchoicesByValue?: Readonly<Record<string, readonly TrainerSubchoiceDefinition[]>>
}

export interface TrainerSubchoiceDescription {
  key: string
  label: string
  choiceLabel: string
  referenceKind?: TrainerSubchoiceReferenceKind
  referenceName: string
  description: string
}

const option = (value: string, label = value): EditableCellOption => ({ value, label })
const options = (values: readonly string[]): readonly EditableCellOption[] => values.map((value) => option(value))

const optionLabelByValue = (definition: TrainerSubchoiceDefinition): Map<string, string> => (
  new Map(definition.options.map((opt) => [opt.value, opt.label]))
)

const compactDescription = (...parts: readonly (string | null | undefined)[]): string => parts
  .map((part) => part?.trim() ?? '')
  .filter((part) => part && !/^none$/i.test(part))
  .join('\n')

const customDescription = (
  definition: TrainerSubchoiceDefinition,
  value: string,
): Pick<TrainerSubchoiceDescription, 'referenceName' | 'description'> | null => {
  const description = compactDescription(definition.descriptions?.[value])
  if (!description) return null
  return {
    referenceName: trainerSubchoiceDisplayValue(definition, value) || value,
    description,
  }
}

const featureOrEdgeDescription = (
  effect: string | null | undefined,
  frequency: string | null | undefined,
): string => compactDescription(effect, effect ? undefined : frequency)

const inlineDescription = (...parts: readonly (string | null | undefined)[]): string => parts
  .map((part) => part?.trim() ?? '')
  .filter(Boolean)
  .join(' · ')

const moveReferenceDescription = (name: string): Pick<TrainerSubchoiceDescription, 'referenceName' | 'description'> | null => {
  const reference = findMove(name)
  if (!reference) return null
  const damage = reference.damage_base == null
    ? ''
    : `DB ${reference.damage_base}${reference.damage_roll ? ` (${reference.damage_roll})` : ''}`
  const ac = reference.ac == null ? '' : `AC ${reference.ac}`
  const summary = inlineDescription(
    reference.type,
    reference.frequency,
    reference.damage_class,
    damage,
    ac,
    reference.range ? `Range: ${reference.range}` : '',
  )
  const description = compactDescription(summary, reference.effect, reference.special ? `Special: ${reference.special}` : undefined)
  return description ? { referenceName: reference.name, description } : null
}

const referenceDescription = (
  kind: TrainerSubchoiceReferenceKind,
  name: string,
): Pick<TrainerSubchoiceDescription, 'referenceName' | 'description'> | null => {
  switch (kind) {
    case 'ability': {
      const reference = findAbility(name)
      const description = compactDescription(reference?.effect, reference?.bonus)
      return reference && description ? { referenceName: reference.name, description } : null
    }
    case 'edge': {
      const reference = findEdge(name)
      const description = featureOrEdgeDescription(reference?.effect, reference?.frequency)
      return reference && description ? { referenceName: reference.name, description } : null
    }
    case 'feature': {
      const reference = findFeature(name)
      const description = featureOrEdgeDescription(reference?.effect, reference?.frequency)
      return reference && description ? { referenceName: reference.name, description } : null
    }
    case 'move':
      return moveReferenceDescription(name)
    default:
      return null
  }
}

const normalizeChoiceToken = (value: unknown): string => (
  typeof value === 'string'
    ? value
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .replace(/['’]/g, '')
        .replace(/[^a-z0-9]+/gi, '')
        .toLowerCase()
    : ''
)

const coerceChoiceValue = (
  definition: TrainerSubchoiceDefinition,
  value: unknown,
): string => {
  if (typeof value !== 'string') return ''
  const normalized = normalizeChoiceToken(value)
  if (!normalized) return ''
  const direct = definition.options.find((opt) => opt.value === value)
  if (direct) return direct.value
  const loose = definition.options.find((opt) => (
    normalizeChoiceToken(opt.value) === normalized || normalizeChoiceToken(opt.label) === normalized
  ))
  return loose?.value ?? value.trim()
}

export const trainerSubchoiceDisplayValue = (
  definition: TrainerSubchoiceDefinition,
  value: EditableCellValue,
): string => {
  if (typeof value !== 'string') return ''
  return optionLabelByValue(definition).get(value) ?? value
}

const trailingChoiceMatch = (name: string): RegExpMatchArray | null =>
  name.match(/^(.*?)\s*\(([^)]*)\)\s*$/)

export const stripTrainerEntryChoiceSuffix = (name: string): string => (
  trailingChoiceMatch(name)?.[1]?.trim() ?? name.trim()
)

const trailingChoiceText = (name: string): string => (
  trailingChoiceMatch(name)?.[2]?.trim() ?? ''
)

const splitChoiceTokens = (raw: string): string[] => (
  raw
    .split(/\s*(?:,|\/|;|\band\b|&)\s*/i)
    .map((token) => token.trim())
    .filter(Boolean)
)

const entryBaseSlug = (entry: Pick<TrainerChoiceEntry, 'name'>): string =>
  toSlug(stripTrainerEntryChoiceSuffix(entry.name ?? ''))

const defineChoiceMap = (
  entries: Iterable<[readonly string[], readonly TrainerSubchoiceDefinition[]]>,
): Map<string, readonly TrainerSubchoiceDefinition[]> => {
  const map = new Map<string, readonly TrainerSubchoiceDefinition[]>()
  for (const [names, definitions] of entries) {
    for (const name of names) {
      const slug = toSlug(name)
      const existing = map.get(slug) ?? []
      map.set(slug, [...existing, ...definitions])
    }
  }
  return map
}

const skillOptions: readonly EditableCellOption[] = TRAINER_SKILL_ORDER.map(([value, label]) => ({ value, label }))
const fashionistaSkillOptions: readonly EditableCellOption[] = TRAINER_SKILL_ORDER
  .filter(([value]) => ['charm', 'command', 'guile', 'intimidate', 'intuition'].includes(value))
  .map(([value, label]) => ({ value, label }))
const mentorSkillOptions: readonly EditableCellOption[] = TRAINER_SKILL_ORDER
  .filter(([value]) => ['charm', 'intimidate', 'intuition', 'pokeEd'].includes(value))
  .map(([value, label]) => ({ value, label }))
const typeOptions = options([
  'Normal', 'Fighting', 'Flying', 'Poison', 'Ground', 'Rock',
  'Bug', 'Ghost', 'Steel', 'Fire', 'Water', 'Grass',
  'Electric', 'Psychic', 'Ice', 'Dragon', 'Dark', 'Fairy',
])

const trainedStatOptions = options(['Attack', 'Defense', 'Special Attack', 'Special Defense', 'Speed'])
const defenseStatOptions = options(['Defense', 'Special Defense'])
const contestStatOptions = options(['Beauty', 'Cool', 'Cute', 'Smart', 'Tough'])
const skillCategoryOptions = options(['Body', 'Mind', 'Spirit'])
const damageClassOptions = options(['Physical', 'Special'])
const tasteOptions = options(['Salty', 'Sour', 'Spicy', 'Dry', 'Sweet'])
const equipmentSlotOptions = options(['Accessory', 'Head', 'Main Hand', 'Off-Hand'])
const captureTechniqueOptions = options([
  'Capture Skills',
  'Curve Ball',
  'Devitalizing Throw',
  'Fast Pitch',
  'Snare',
  'Tools of the Trade',
  'Catch Combo',
  'False Strike',
  'Relentless Pursuit',
])
const captureTechniqueDescriptions: Readonly<Record<string, string>> = {
  'Capture Skills': 'Static\nYou gain a Skill Edge for which you qualify. It must be applied to Acrobatics, Athletics, Stealth, Survival, Guile, or Perception. You may take Capture Skills up to two times.',
  'Curve Ball': 'Static\nWhenever you hit a target with a Poké Ball, you may deal damage as if you had hit them with a Struggle Attack. This damage triggers before any of the Poké Ball’s functions, such as making a Capture Check or releasing a Pokémon.',
  'Devitalizing Throw': '1 AP – Free Action\nTrigger: A Pokémon escapes from a Poké Ball you threw.\nChoose One Effect: The triggering target becomes Slowed; the triggering target loses one Combat Stage in a Stat of your choice; or the triggering target suffers a -3 penalty to their next Save Roll.',
  'Fast Pitch': '1 AP – Standard Action, Priority (Advanced)\nYou immediately throw a Poké Ball.',
  'Snare': 'Static\nYou subtract -10 from Capture Rolls made against Pokémon drawn into an encounter by Bait, that are currently distracted by Bait, or are in a Hand Net, Lasso, Weighted Net, or Stuck because of a Glue Cannon.',
  'Tools of the Trade': 'Static\nAdd +2 to all Accuracy Rolls made with Poké Balls, Hand Nets, Lassos, Weighted Nets, and Glue Cannons. Add +2 to Athletics Checks made when reeling in a Pokémon with a Fishing Rod, and add +4 to 1d20 rolls made to see if a Pokémon is attracted by Bait or a Fishing Lure.',
}

const moveOptions: readonly EditableCellOption[] = moves.map((move) => option(move.name))
const featureOptions: readonly EditableCellOption[] = features.map((feature) => option(feature.name))
const edgeOptions: readonly EditableCellOption[] = edges.map((edge) => option(edge.name))

const typeSelector: TrainerSubchoiceDefinition = {
  key: 'type',
  label: 'Type',
  placeholder: 'Choose type',
  options: typeOptions,
}
const statSelector: TrainerSubchoiceDefinition = {
  key: 'stat',
  label: 'Stat',
  placeholder: 'Choose stat',
  options: trainedStatOptions,
}
const contestStatSelector: TrainerSubchoiceDefinition = {
  key: 'contestStat',
  label: 'Contest stat',
  placeholder: 'Choose contest stat',
  options: contestStatOptions,
}
const skillSelector: TrainerSubchoiceDefinition = {
  key: 'skill',
  label: 'Skill',
  placeholder: 'Choose skill',
  options: skillOptions,
}
const secondSkillSelector: TrainerSubchoiceDefinition = {
  key: 'skill2',
  label: 'Skill 2',
  placeholder: 'Choose skill',
  options: skillOptions,
}
const basicSkillSelector: TrainerSubchoiceDefinition = {
  ...skillSelector,
  legacyField: 'basicSkill',
}
const circumstanceSelector: TrainerSubchoiceDefinition = {
  key: 'circumstance',
  label: 'Circumstance',
  placeholder: 'Describe the specific use',
  options: [],
  inputType: 'text',
}
const moveSelector: TrainerSubchoiceDefinition = {
  key: 'move',
  label: 'Move',
  placeholder: 'Choose move',
  options: moveOptions,
  referenceKinds: ['move'],
}
const captureTechniqueSelector: TrainerSubchoiceDefinition = {
  key: 'captureTechnique',
  label: 'Technique 1',
  placeholder: 'Choose technique',
  options: captureTechniqueOptions,
  referenceKinds: ['feature'],
  descriptions: captureTechniqueDescriptions,
}
const secondCaptureTechniqueSelector: TrainerSubchoiceDefinition = {
  key: 'captureTechnique2',
  label: 'Technique 2',
  placeholder: 'Choose technique',
  options: captureTechniqueOptions,
  referenceKinds: ['feature'],
  descriptions: captureTechniqueDescriptions,
}
const limitedAbilitySelector = (
  key: string,
  label: string,
  values: readonly string[],
): TrainerSubchoiceDefinition => ({
  key,
  label,
  placeholder: `Choose ${label.toLowerCase()}`,
  options: options(values),
  referenceKinds: ['ability'],
})

const limitedMoveSelector = (
  key: string,
  label: string,
  values: readonly string[],
): TrainerSubchoiceDefinition => ({
  key,
  label,
  placeholder: `Choose ${label.toLowerCase()}`,
  options: options(values),
  referenceKinds: ['move'],
})

export const TRAINER_FREE_TRAINING_FEATURE_NAME = 'Free Training Feature'
export const TRAINER_TRAINING_FEATURE_CHOICE_KEY = 'trainingFeature'

const trainingFeatureSelector: TrainerSubchoiceDefinition = {
  key: TRAINER_TRAINING_FEATURE_CHOICE_KEY,
  label: 'Training feature',
  placeholder: 'Choose feature',
  options: options(POKEMON_TRAINING_FEATURE_OPTIONS),
  referenceKinds: ['feature'],
}

const orderFeatureSelector: TrainerSubchoiceDefinition = {
  key: 'orderFeature',
  label: 'Orders feature',
  placeholder: 'Choose orders',
  options: options(['Ravager Orders', 'Marksman Orders', 'Trickster Orders', 'Guardian Orders', 'Precision Orders']),
  referenceKinds: ['feature'],
}

const featureSelector: TrainerSubchoiceDefinition = {
  key: 'feature',
  label: 'Feature',
  placeholder: 'Choose feature',
  options: featureOptions,
  referenceKinds: ['feature'],
}

const edgeSelector: TrainerSubchoiceDefinition = {
  key: 'edge',
  label: 'Edge',
  placeholder: 'Choose edge',
  options: edgeOptions,
  referenceKinds: ['edge'],
}

const researcherFieldOptions = options([
  'General Education',
  'Apothecary',
  'Artificer',
  'Botany',
  'Chemistry',
  'Climatology',
  'Occultism',
  'Paleontology',
])
const researcherFieldSelector: TrainerSubchoiceDefinition = {
  key: 'researcherField',
  label: 'Field 1',
  placeholder: 'Choose field',
  options: researcherFieldOptions,
  referenceKinds: ['feature'],
}
const secondResearcherFieldSelector: TrainerSubchoiceDefinition = {
  key: 'researcherField2',
  label: 'Field 2',
  placeholder: 'Choose field',
  options: researcherFieldOptions,
  referenceKinds: ['feature'],
}

const terrainSelector: TrainerSubchoiceDefinition = {
  key: 'terrain',
  label: 'Terrain',
  placeholder: 'Choose terrain',
  options: options(['Grassland', 'Forest', 'Wetlands', 'Ocean', 'Tundra', 'Mountain', 'Cave', 'Urban', 'Desert']),
}

const chroniclerArchiveDescriptions: Readonly<Record<string, string>> = {
  'Profile Archive': 'You may place Records of Pokémon and Trainers in your Profile Archive. You gain a +2 bonus to Charm, Guile, Command, Intimidate, and Intuition Checks targeting Pokémon and Trainers in your Profile Archive.',
  'Technique Archive': 'You may place Records of Moves in your Technique Archive. You and your Pokémon gain +2 Evasion against Moves in your Technique Archives.',
  'Travel Archive': 'You may place Records of Locations in your Travel Archive. When you gain Travel Archive, choose Keen Eye or Perception. While you are in a Location in your Travel Archive, you have the chosen Ability and gain a +2 bonus to Perception Checks to notice the environment.',
}
const travelArchiveAbilitySelector = limitedAbilitySelector('travelArchiveAbility', 'Travel ability', ['Keen Eye', 'Perception'])
const chroniclerArchiveSelector: TrainerSubchoiceDefinition = {
  key: 'archive',
  label: 'Archive',
  placeholder: 'Choose archive',
  options: options(['Profile Archive', 'Technique Archive', 'Travel Archive']),
  descriptions: chroniclerArchiveDescriptions,
  subchoicesByValue: {
    'Travel Archive': [travelArchiveAbilitySelector],
  },
}

const martialAbilitySelector = limitedAbilitySelector(
  'ability',
  'Ability',
  ['Guts', 'Inner Focus', 'Iron Fist', 'Limber', 'Reckless', 'Technician'],
)
const auraNoviceMoveSelector = limitedMoveSelector('move', 'Move 1', ['Detect', 'Vacuum Wave', 'Force Palm'])
const secondAuraNoviceMoveSelector = limitedMoveSelector('move2', 'Move 2', ['Detect', 'Vacuum Wave', 'Force Palm'])
const auraMasteryMoveSelector = limitedMoveSelector('move', 'Move 1', ['Aura Sphere', 'Focus Blast', 'Drain Punch', 'Focus Punch'])
const secondAuraMasteryMoveSelector = limitedMoveSelector('move2', 'Move 2', ['Aura Sphere', 'Focus Blast', 'Drain Punch', 'Focus Punch'])
const hexManiacMoveSelector = limitedMoveSelector('move', 'Move 1', ['Confuse Ray', 'Curse', 'Hypnosis', 'Spite', 'Will-O-Wisp', 'Hex'])
const secondHexManiacMoveSelector = limitedMoveSelector('move2', 'Move 2', ['Confuse Ray', 'Curse', 'Hypnosis', 'Spite', 'Will-O-Wisp', 'Hex'])

const speciesSelector: TrainerSubchoiceDefinition = {
  key: 'species',
  label: 'Species',
  placeholder: 'Choose species',
  options: options(['Castform', 'Grimer', 'Koffing', 'Magnemite', 'Porygon', 'Solosis', 'Trubbish', 'Voltorb']),
}

const weaponTypeSelector: TrainerSubchoiceDefinition = {
  key: 'weaponType',
  label: 'Weapon',
  placeholder: 'Choose weapon',
  options: options([
    'Small Melee Weapon',
    'Large Melee Weapon',
    'Short Ranged Weapon',
    'Long Ranged Weapon',
    'Heavy Ranged Weapon',
    'Thrown Weapon',
    'Unarmed',
    'Improvised Weapon',
  ]),
}

const featureChoiceMap = defineChoiceMap([
  [[TRAINER_FREE_TRAINING_FEATURE_NAME], [trainingFeatureSelector]],
  [['I’m a Doctor'], [
    {
      key: 'doctorTechnique',
      label: 'Technique',
      placeholder: 'Choose technique',
      options: options(['Field Clinic', 'Medic Training']),
      referenceKinds: ['feature', 'edge'],
    },
    {
      key: 'doctorSupport',
      label: 'Support',
      placeholder: 'Choose support',
      options: options(['Nurse', 'First Aid Expertise']),
      referenceKinds: ['feature'],
    },
  ]],
  [['Elite Trainer'], [trainingFeatureSelector]],
  [['Capture Specialist', 'Advanced Capture Techniques'], [
    captureTechniqueSelector,
    secondCaptureTechniqueSelector,
  ]],
  [['Commander'], [orderFeatureSelector]],
  [['Dilettante'], [edgeSelector, featureSelector]],
  [['Effective Methods'], [limitedAbilitySelector('ability', 'Ability', ['Exploit', 'Tolerance'])]],
  [[
    'Stat Ace',
    'Focus',
    'Stat Link',
    'Stat Training',
    'Stat Maneuver',
    'Stat Mastery',
    'Stat Embodiment',
    'Stat Stratagem',
  ], [statSelector]],
  [['Go, Fight, Win!'], [{
    key: 'cheerStat',
    label: 'Cheer stat',
    placeholder: 'Choose stat',
    options: defenseStatOptions,
  }]],
  [['Style Expert', 'Style Flourish', 'Style Entrainment'], [contestStatSelector]],
  [['Type Ace', 'Type Refresh', 'Move Sync', 'Type Expertise'], [typeSelector]],
  [['Type Booster', 'Type Brace', 'Plate Crafter'], [typeSelector]],
  [['Fashionista'], [
    {
      key: 'fashionistaSkill',
      label: 'Skill 1',
      placeholder: 'Choose skill',
      options: fashionistaSkillOptions,
    },
    {
      key: 'fashionistaSkill2',
      label: 'Skill 2',
      placeholder: 'Choose skill',
      options: fashionistaSkillOptions,
    },
  ]],
  [['Mentor'], [
    { key: 'mentorSkill', label: 'Mentor Skill 1', placeholder: 'Choose skill', options: mentorSkillOptions },
    { key: 'mentorSkill2', label: 'Mentor Skill 2', placeholder: 'Choose skill', options: mentorSkillOptions },
  ]],
  [['Species Savant'], [{ key: 'species', label: 'Evolutionary Family', placeholder: 'Enter evolutionary family', inputType: 'text', options: [] }]],
  [['Parfumier'], [limitedMoveSelector('move', 'Move', ['Sweet Scent', 'Aromatic Mist'])]],
  [['Accentuated Taste'], [{
    key: 'taste',
    label: 'Taste',
    placeholder: 'Choose taste',
    options: tasteOptions,
  }]],
  [['Focus Gem', 'Rainbow Gem'], [{
    key: 'equipmentSlot',
    label: 'Slot',
    placeholder: 'Choose slot',
    options: equipmentSlotOptions,
  }]],
  [['Chakra Crystal'], [statSelector]],
  [['Rainbow Gem'], [statSelector]],
  [['Researcher'], [researcherFieldSelector, secondResearcherFieldSelector]],
  [['Chronicler', 'Archival Training'], [chroniclerArchiveSelector]],
  [['Playing God'], [speciesSelector]],
  [['Weather Systems'], [limitedMoveSelector('move', 'Move', ['Hail', 'Rain Dance', 'Sandstorm', 'Sunny Day'])]],
  [['Survivalist'], [terrainSelector]],
  [['Terrain Talent'], [terrainSelector]],
  [['Athlete'], [statSelector, {
    key: 'stat2',
    label: 'Stat 2',
    placeholder: 'Choose stat',
    options: trainedStatOptions,
  }]],
  [['Dancer', 'Dance Practice'], [limitedAbilitySelector('ability', 'Ability', ['Spinning Dance', 'Own Tempo'])]],
  [['Hunter'], [limitedAbilitySelector('ability', 'Ability', ['Teamwork', 'Pack Hunt'])]],
  [['Martial Artist', 'Martial Achievement'], [martialAbilitySelector]],
  [['Musical Ability'], [limitedAbilitySelector('ability', 'Ability', ['Drown Out', 'Soundproof'])]],
  [['Underhanded Tactics', 'Scoundrel’s Strike'], [limitedAbilitySelector('ability', 'Ability', ['Ambush', 'Cruelty'])]],
  [['Aura Guardian'], [auraNoviceMoveSelector, secondAuraNoviceMoveSelector]],
  [['The Power of Aura'], [limitedAbilitySelector('ability', 'Ability', ['Scrappy', 'Aura Storm'])]],
  [['Sword of Body and Soul'], [{
    key: 'damageClass',
    label: 'Class',
    placeholder: 'Choose class',
    options: damageClassOptions,
  }]],
  [['Aura Mastery'], [auraMasteryMoveSelector, secondAuraMasteryMoveSelector]],
  [['Hex Maniac'], [limitedAbilitySelector('ability', 'Ability', ['Cursed Body', 'Omen'])]],
  [['Hex Maniac Studies'], [hexManiacMoveSelector, secondHexManiacMoveSelector]],
  [['Lay on Hands'], [limitedAbilitySelector('ability', 'Ability', ['Blessed Touch', 'Healer'])]],
  [['Power of the Mind'], [limitedAbilitySelector('ability', 'Ability', ['Interference', 'Levitate'])]],
  [['Telepathic Awareness'], [limitedAbilitySelector('ability', 'Ability', ['Gentle Vibe', 'Telepathy'])]],
  [['Signature Move', 'Tutoring'], [moveSelector]],
])

const edgeChoiceMap = defineChoiceMap([
  [['Basic Skills'], [basicSkillSelector]],
  [['Adept Skills', 'Expert Skills', 'Master Skills', 'Virtuoso'], [skillSelector]],
  [['Skill Stunt'], [skillSelector, circumstanceSelector]],
  [['Categoric Inclination'], [{
    key: 'category',
    label: 'Category',
    placeholder: 'Choose category',
    options: skillCategoryOptions,
  }]],
  [['Skill Enhancement'], [skillSelector, secondSkillSelector]],
  [['Weapon of Choice'], [weaponTypeSelector]],
  [['Elemental Connection'], [typeSelector]],
])

const entryChoices = (entry: TrainerChoiceEntry): Record<string, string> | undefined => entry.choices

const legacySelectionValue = (
  entry: TrainerChoiceEntry,
  definition: TrainerSubchoiceDefinition,
): string => {
  if (definition.legacyField === 'basicSkill') {
    return (entry as TrainerEdgeEntry).basicSkill ?? ''
  }
  return ''
}

const storedSelectionValue = (
  entry: TrainerChoiceEntry,
  definition: TrainerSubchoiceDefinition,
): string => {
  const choices = entryChoices(entry)
  if (!choices) return ''
  const storedValue = choices[definition.key]
  if (storedValue) return storedValue
  for (const legacyKey of definition.legacyKeys ?? []) {
    const legacyValue = choices[legacyKey]
    if (legacyValue) return legacyValue
  }
  return ''
}

const isNestedSubchoiceDefinition = (definition: TrainerSubchoiceDefinition): boolean => definition.key.includes('.')

const parentheticalSelectionValue = (
  entry: TrainerChoiceEntry,
  definition: TrainerSubchoiceDefinition,
  definitions: readonly TrainerSubchoiceDefinition[],
): string => {
  if (isNestedSubchoiceDefinition(definition)) return ''
  const raw = trailingChoiceText(entry.name ?? '')
  if (!raw) return ''
  const tokens = splitChoiceTokens(raw)
  const definitionIndex = definitions.findIndex((candidate) => candidate.key === definition.key)
  const token = tokens[definitionIndex] ?? (definitions.length === 1 ? raw : '')
  return coerceChoiceValue(definition, token)
}

export const trainerSubchoiceValue = (
  entry: TrainerChoiceEntry,
  definition: TrainerSubchoiceDefinition,
  definitions: readonly TrainerSubchoiceDefinition[],
): string => {
  const legacyValue = legacySelectionValue(entry, definition)
  if (legacyValue) return coerceChoiceValue(definition, legacyValue)

  const storedValue = storedSelectionValue(entry, definition)
  if (storedValue) return coerceChoiceValue(definition, storedValue)

  return parentheticalSelectionValue(entry, definition, definitions)
}

const NESTED_SUBCHOICE_MAX_DEPTH = 6

type NestedChoiceReferenceKind = Extract<TrainerSubchoiceReferenceKind, 'edge' | 'feature'>

const isNestedChoiceReferenceKind = (kind: TrainerSubchoiceReferenceKind): kind is NestedChoiceReferenceKind => (
  kind === 'edge' || kind === 'feature'
)

const nestedReferenceKinds = (definition: TrainerSubchoiceDefinition): NestedChoiceReferenceKind[] => (
  (definition.referenceKinds ?? []).filter(isNestedChoiceReferenceKind)
)

const referencedSubchoiceDefinitions = (
  kind: NestedChoiceReferenceKind,
  name: string,
): readonly TrainerSubchoiceDefinition[] => {
  const slug = toSlug(stripTrainerEntryChoiceSuffix(name))
  return kind === 'feature'
    ? featureChoiceMap.get(slug) ?? []
    : edgeChoiceMap.get(slug) ?? []
}

const explicitSubchoicesForValue = (
  definition: TrainerSubchoiceDefinition,
  value: string,
): readonly TrainerSubchoiceDefinition[] => {
  const subchoicesByValue = definition.subchoicesByValue
  if (!subchoicesByValue) return []
  const exact = subchoicesByValue[value]
  if (exact) return exact
  const normalizedValue = normalizeChoiceToken(value)
  const loose = Object.entries(subchoicesByValue).find(([key]) => normalizeChoiceToken(key) === normalizedValue)
  return loose?.[1] ?? []
}

const uniqueStrings = (values: readonly string[]): string[] => [...new Set(values.filter(Boolean))]

const scopedNestedDefinition = (
  parent: TrainerSubchoiceDefinition,
  definition: TrainerSubchoiceDefinition,
  preserveLegacyKey = false,
): TrainerSubchoiceDefinition => {
  const { legacyField: _legacyField, legacyKeys, ...rest } = definition
  return {
    ...rest,
    key: `${parent.key}.${definition.key}`,
    label: `${parent.label} / ${definition.label}`,
    legacyKeys: preserveLegacyKey ? uniqueStrings([...(legacyKeys ?? []), definition.key]) : legacyKeys,
  }
}

const resolveTrainerSubchoices = (
  entry: TrainerChoiceEntry,
  baseDefinitions: readonly TrainerSubchoiceDefinition[],
  seenReferences: ReadonlySet<string> = new Set(),
  depth = 0,
): readonly TrainerSubchoiceDefinition[] => {
  if (depth >= NESTED_SUBCHOICE_MAX_DEPTH) return baseDefinitions

  const resolved: TrainerSubchoiceDefinition[] = []
  for (const definition of baseDefinitions) {
    resolved.push(definition)

    const value = trainerSubchoiceValue(entry, definition, baseDefinitions)
    if (!value) continue

    const explicitDefinitions = explicitSubchoicesForValue(definition, value)
    if (explicitDefinitions.length) {
      const scoped = explicitDefinitions.map((nestedDefinition) => scopedNestedDefinition(definition, nestedDefinition, true))
      resolved.push(...resolveTrainerSubchoices(entry, scoped, seenReferences, depth + 1))
    }

    for (const kind of nestedReferenceKinds(definition)) {
      const referenceKey = `${kind}:${toSlug(stripTrainerEntryChoiceSuffix(value))}`
      if (seenReferences.has(referenceKey)) continue
      const referencedDefinitions = referencedSubchoiceDefinitions(kind, value)
      if (!referencedDefinitions.length) continue
      const scoped = referencedDefinitions.map((nestedDefinition) => scopedNestedDefinition(definition, nestedDefinition))
      const nextSeenReferences = new Set(seenReferences)
      nextSeenReferences.add(referenceKey)
      resolved.push(...resolveTrainerSubchoices(entry, scoped, nextSeenReferences, depth + 1))
    }
  }
  return resolved
}

export const trainerFeatureSubchoices = (
  feature: Pick<TrainerFeatureEntry, 'name' | 'choices'>,
): readonly TrainerSubchoiceDefinition[] => {
  const base = [...(featureChoiceMap.get(entryBaseSlug(feature)) ?? [])]
  const tags = new Set(findFeature(stripTrainerEntryChoiceSuffix(feature.name))?.tags ?? [])
  if (!base.some(definition => definition.key === 'statTag' || definition.key === 'stat')) {
    if (tags.has('+Attack or Special Attack')) base.push({ ...statSelector, key: 'statTag', options: statSelector.options.filter(option => ['atk', 'satk'].includes(String(option.value))) })
    else if (tags.has('+Any Stat')) base.push({ ...statSelector, key: 'statTag' })
  }
  return resolveTrainerSubchoices(feature, base)
}

export const trainerEdgeSubchoices = (
  edge: Pick<TrainerEdgeEntry, 'name' | 'choices' | 'basicSkill'>,
): readonly TrainerSubchoiceDefinition[] => resolveTrainerSubchoices(edge, edgeChoiceMap.get(entryBaseSlug(edge)) ?? [])

export const trainerSubchoiceDescriptions = (
  entry: TrainerChoiceEntry,
  definitions: readonly TrainerSubchoiceDefinition[],
): TrainerSubchoiceDescription[] => definitions.flatMap((definition) => {
  const value = trainerSubchoiceValue(entry, definition, definitions)
  if (!value) return []
  const choiceLabel = trainerSubchoiceDisplayValue(definition, value)
  const custom = customDescription(definition, value)
  if (custom) {
    return [{
      key: definition.key,
      label: definition.label,
      choiceLabel,
      referenceName: custom.referenceName,
      description: custom.description,
    }]
  }

  for (const kind of definition.referenceKinds ?? []) {
    const reference = referenceDescription(kind, value)
    if (!reference) continue
    return [{
      key: definition.key,
      label: definition.label,
      choiceLabel,
      referenceKind: kind,
      referenceName: reference.referenceName,
      description: reference.description,
    }]
  }
  return []
})

export const trainerSubchoiceDescriptionLines = (
  entry: TrainerChoiceEntry,
  definitions: readonly TrainerSubchoiceDefinition[],
): string[] => trainerSubchoiceDescriptions(entry, definitions).map((description) => (
  `${description.label} — ${description.choiceLabel || description.referenceName}: ${description.description}`
))

const pruneEmptyChoices = (entry: TrainerChoiceEntry): void => {
  if (entry.choices && Object.keys(entry.choices).length === 0) delete entry.choices
}

const deleteChoiceValue = (
  entry: TrainerChoiceEntry,
  definition: TrainerSubchoiceDefinition,
): void => {
  delete entry.choices?.[definition.key]
  for (const legacyKey of definition.legacyKeys ?? []) delete entry.choices?.[legacyKey]
}

const explicitDescendantLegacyKeys = (definition: TrainerSubchoiceDefinition): string[] => uniqueStrings(
  Object.values(definition.subchoicesByValue ?? {}).flatMap((definitions) => definitions.flatMap((child) => [
    child.key,
    ...(child.legacyKeys ?? []),
    ...explicitDescendantLegacyKeys(child),
  ])),
)

const clearDescendantSubchoiceValues = (
  entry: TrainerChoiceEntry,
  definition: TrainerSubchoiceDefinition,
): void => {
  if (!entry.choices) return
  const nestedKeyPrefix = `${definition.key}.`
  for (const key of Object.keys(entry.choices)) {
    if (key.startsWith(nestedKeyPrefix)) delete entry.choices[key]
  }
  for (const key of explicitDescendantLegacyKeys(definition)) delete entry.choices[key]
  pruneEmptyChoices(entry)
}

export const setTrainerSubchoiceValue = (
  entry: TrainerChoiceEntry,
  definition: TrainerSubchoiceDefinition,
  value: EditableCellValue,
): void => {
  const selection = coerceChoiceValue(definition, typeof value === 'string' ? value : '')
  const previousSelection = trainerSubchoiceValue(entry, definition, [definition])
  entry.name = stripTrainerEntryChoiceSuffix(entry.name ?? '')

  if (definition.legacyField === 'basicSkill') {
    delete entry.choices
    if (selection) (entry as TrainerEdgeEntry).basicSkill = selection as TrainerSkillKey
    else delete (entry as TrainerEdgeEntry).basicSkill
    return
  }

  if (previousSelection !== selection) clearDescendantSubchoiceValues(entry, definition)

  if (!selection) {
    deleteChoiceValue(entry, definition)
    pruneEmptyChoices(entry)
    return
  }

  entry.choices ??= {}
  entry.choices[definition.key] = selection
  for (const legacyKey of definition.legacyKeys ?? []) delete entry.choices[legacyKey]
}

export const clearTrainerSubchoiceValues = (entry: TrainerChoiceEntry): void => {
  delete entry.choices
  delete (entry as TrainerEdgeEntry).basicSkill
}

export const updateTrainerChoiceEntryName = <T extends TrainerChoiceEntry>(
  entry: T,
  value: EditableCellValue,
  resolver: TrainerChoiceResolver<T>,
): void => {
  const raw = typeof value === 'string' ? value : ''
  const parenthetical = trailingChoiceText(raw)
  entry.name = stripTrainerEntryChoiceSuffix(raw)
  clearTrainerSubchoiceValues(entry)

  if (!parenthetical) return
  const definitions = resolver(entry)
  if (!definitions.length) return
  const tokens = splitChoiceTokens(parenthetical)

  for (const [index, definition] of definitions.entries()) {
    const token = tokens[index] ?? (definitions.length === 1 ? parenthetical : '')
    if (!token) continue
    setTrainerSubchoiceValue(entry, definition, token)
  }

  const parsedDefinitionKeys = new Set(definitions.map((definition) => definition.key))
  const expandedDefinitions = resolver(entry).filter((definition) => !parsedDefinitionKeys.has(definition.key))
  for (const [index, definition] of expandedDefinitions.entries()) {
    const token = tokens[definitions.length + index]
    if (!token) continue
    setTrainerSubchoiceValue(entry, definition, token)
  }
}
