import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import type { PlayerProfile } from '#shared/playerProfiles'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import { activeEquipmentState } from './equipment'

export const FORM_CHANGE_MAP_SLUG = 'mega-evolution-arena'
export const FORM_CHANGE_TRAINER_SLUG = 'mega-trainer'
export const FORM_CHANGE_POKEMON_SLUG = 'mega-charizard'
export const FORM_CHANGE_TRAINER_PLACEMENT_ID = 'mega-trainer-token'
export const FORM_CHANGE_POKEMON_PLACEMENT_ID = 'mega-charizard-token'
export const FORM_CHANGE_SCENE_STARTED_AT = 5_000

export const createFormChangeTrainer = (
  overrides: Partial<TrainerSheet> = {},
): TrainerSheet => ({
  slug: FORM_CHANGE_TRAINER_SLUG,
  name: 'Alex',
  level: 20,
  revision: 3,
  currentHp: 60,
  currentTeam: [FORM_CHANGE_POKEMON_SLUG],
  equipmentState: activeEquipmentState({
    ownerKind: 'trainer',
    ownerSlug: FORM_CHANGE_TRAINER_SLUG,
    slotId: 'accessory',
    canonicalItemId: 'Mega Ring',
  }),
  ...overrides,
})

export const createFormChangePokemon = (
  formId = 'mega-charizard-x',
  overrides: Partial<CharacterSheet> = {},
): CharacterSheet => {
  const species = overrides.species ?? 'Charizard'
  return {
    slug: FORM_CHANGE_POKEMON_SLUG,
    nickname: 'Emberwing',
    species,
    level: 40,
    revision: 4,
    types: ['Fire', 'Flying'],
    abilities: [{ name: 'Blaze' }],
    movelist: [{ name: 'Ember' }],
    stats: {
      hp: { added: 2 },
      atk: { added: 3 },
      def: { added: 2 },
      satk: { added: 4 },
      sdef: { added: 2 },
      spd: { added: 3 },
    },
    combat: { currentHp: 72 },
    equipmentState: activeEquipmentState({
      ownerKind: 'pokemon',
      ownerSlug: FORM_CHANGE_POKEMON_SLUG,
      slotId: 'held',
      canonicalItemId: 'Mega Stone',
      sourceTrainerSlug: FORM_CHANGE_TRAINER_SLUG,
      configuration: {
        configurationId: 'equipment.mega-stone.v1',
        values: {
          baseSpeciesId: species,
          megaFormSpeciesId: formId,
        },
      },
    }),
    ...overrides,
  }
}

export const createFormChangeMap = (
  overrides: Partial<TabletopMap> = {},
): TabletopMap => ({
  schemaVersion: 2,
  slug: FORM_CHANGE_MAP_SLUG,
  name: 'Mega Evolution Arena',
  revision: 7,
  dimensions: { x: 12, y: 4, z: 12 },
  playerVisible: true,
  voxels: [],
  placements: [{
    id: FORM_CHANGE_TRAINER_PLACEMENT_ID,
    sheetKind: 'trainer',
    sheetSlug: FORM_CHANGE_TRAINER_SLUG,
    position: { x: 2, y: 0, z: 2 },
    sideId: 'heroes',
    initiative: 14,
  }, {
    id: FORM_CHANGE_POKEMON_PLACEMENT_ID,
    sheetKind: 'pokemon',
    sheetSlug: FORM_CHANGE_POKEMON_SLUG,
    position: { x: 3, y: 0, z: 2 },
    sideId: 'heroes',
    initiative: 13,
  }],
  activeScene: { name: 'Finale', startedAt: FORM_CHANGE_SCENE_STARTED_AT },
  initiative: { activeId: FORM_CHANGE_TRAINER_PLACEMENT_ID, round: 2 },
  encounterState: {
    ...createEmptyEncounterState(),
    sides: { heroes: { id: 'heroes', label: 'Heroes', status: 'active' } },
  },
  createdAt: 1,
  updatedAt: 5_100,
  ...overrides,
})

export const createFormChangeProfile = (): PlayerProfile => ({
  schemaVersion: 1,
  id: 'profile_mega_trainer',
  displayName: 'Alex',
  linkedCharacters: [{ sheetKind: 'trainer', sheetSlug: FORM_CHANGE_TRAINER_SLUG }],
})
