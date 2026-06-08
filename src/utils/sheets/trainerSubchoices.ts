import { edges, features, moves, toSlug } from '~~/data/ptuReference'
import { TRAINER_SKILL_ORDER } from '~/utils/sheets/trainerSkillConstants'
import type { EditableCellOption, EditableCellValue } from '~/utils/editableCell'
import type { TrainerEdgeEntry, TrainerFeatureEntry, TrainerSkillKey } from '~/types/trainerSheet'

export type TrainerChoiceEntry = TrainerFeatureEntry | TrainerEdgeEntry
export type TrainerChoiceResolver<T extends TrainerChoiceEntry = TrainerChoiceEntry> = (
  entry: T,
) => readonly TrainerSubchoiceDefinition[]

export interface TrainerSubchoiceDefinition {
  key: string
  label: string
  options: readonly EditableCellOption[]
  placeholder?: string
  legacyField?: 'basicSkill'
}

const option = (value: string, label = value): EditableCellOption => ({ value, label })
const options = (values: readonly string[]): readonly EditableCellOption[] => values.map((value) => option(value))

const optionLabelByValue = (definition: TrainerSubchoiceDefinition): Map<string, string> => (
  new Map(definition.options.map((opt) => [opt.value, opt.label]))
)

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
const moveSelector: TrainerSubchoiceDefinition = {
  key: 'move',
  label: 'Move',
  placeholder: 'Choose move',
  options: moveOptions,
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
})

const trainingFeatureSelector: TrainerSubchoiceDefinition = {
  key: 'trainingFeature',
  label: 'Training feature',
  placeholder: 'Choose feature',
  options: options(['Agility Training', 'Brutal Training', 'Focused Training', 'Inspired Training']),
}

const orderFeatureSelector: TrainerSubchoiceDefinition = {
  key: 'orderFeature',
  label: 'Orders feature',
  placeholder: 'Choose orders',
  options: options(['Ravager Orders', 'Marksman Orders', 'Trickster Orders', 'Guardian Orders', 'Precision Orders']),
}

const featureSelector: TrainerSubchoiceDefinition = {
  key: 'feature',
  label: 'Feature',
  placeholder: 'Choose feature',
  options: featureOptions,
}

const edgeSelector: TrainerSubchoiceDefinition = {
  key: 'edge',
  label: 'Edge',
  placeholder: 'Choose edge',
  options: edgeOptions,
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
}
const secondResearcherFieldSelector: TrainerSubchoiceDefinition = {
  key: 'researcherField2',
  label: 'Field 2',
  placeholder: 'Choose field',
  options: researcherFieldOptions,
}

const terrainSelector: TrainerSubchoiceDefinition = {
  key: 'terrain',
  label: 'Terrain',
  placeholder: 'Choose terrain',
  options: options(['Grassland', 'Forest', 'Wetlands', 'Ocean', 'Tundra', 'Mountain', 'Cave', 'Urban', 'Desert']),
}

const chroniclerArchiveSelector: TrainerSubchoiceDefinition = {
  key: 'archive',
  label: 'Archive',
  placeholder: 'Choose archive',
  options: options(['Profile Archive', 'Technique Archive', 'Travel Archive']),
}
const travelArchiveAbilitySelector = limitedAbilitySelector('travelArchiveAbility', 'Travel ability', ['Keen Eye', 'Perception'])

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
  [['I’m a Doctor'], [
    {
      key: 'doctorTechnique',
      label: 'Technique',
      placeholder: 'Choose technique',
      options: options(['Field Clinic', 'Medic Training']),
    },
    {
      key: 'doctorSupport',
      label: 'Support',
      placeholder: 'Choose support',
      options: options(['Nurse', 'First Aid Expertise']),
    },
  ]],
  [['Elite Trainer'], [trainingFeatureSelector]],
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
  [['Chronicler', 'Archival Training'], [chroniclerArchiveSelector, travelArchiveAbilitySelector]],
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
  [['Skill Stunt'], [skillSelector]],
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

export const trainerFeatureSubchoices = (
  feature: Pick<TrainerFeatureEntry, 'name'>,
): readonly TrainerSubchoiceDefinition[] => featureChoiceMap.get(entryBaseSlug(feature)) ?? []

export const trainerEdgeSubchoices = (
  edge: Pick<TrainerEdgeEntry, 'name'>,
): readonly TrainerSubchoiceDefinition[] => edgeChoiceMap.get(entryBaseSlug(edge)) ?? []

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

const parentheticalSelectionValue = (
  entry: TrainerChoiceEntry,
  definition: TrainerSubchoiceDefinition,
  definitions: readonly TrainerSubchoiceDefinition[],
): string => {
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

  const storedValue = entryChoices(entry)?.[definition.key]
  if (storedValue) return coerceChoiceValue(definition, storedValue)

  return parentheticalSelectionValue(entry, definition, definitions)
}

export const setTrainerSubchoiceValue = (
  entry: TrainerChoiceEntry,
  definition: TrainerSubchoiceDefinition,
  value: EditableCellValue,
): void => {
  const selection = coerceChoiceValue(definition, typeof value === 'string' ? value : '')
  entry.name = stripTrainerEntryChoiceSuffix(entry.name ?? '')

  if (definition.legacyField === 'basicSkill') {
    delete entry.choices
    if (selection) (entry as TrainerEdgeEntry).basicSkill = selection as TrainerSkillKey
    else delete (entry as TrainerEdgeEntry).basicSkill
    return
  }

  if (!selection) {
    delete entry.choices?.[definition.key]
    if (entry.choices && Object.keys(entry.choices).length === 0) delete entry.choices
    return
  }

  entry.choices ??= {}
  entry.choices[definition.key] = selection
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
}
