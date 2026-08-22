/**
 * Reviewed starting packages and campaign presets (P9-029).
 *
 * Every entry references canonical item or Pokédex identity; the quality gate
 * verifies each against the compiled catalog so a preset can never grant an
 * item or species the server cannot re-authorize. Presets are conveniences
 * the GM applies inside the policy editor; the published policy content is
 * what drafts actually bind to.
 */

import type { OnboardingItemGrant } from './policy'

export interface OnboardingItemPackagePreset {
  readonly presetId: string
  readonly label: string
  readonly description: string
  readonly trainerItems: readonly OnboardingItemGrant[]
}

export const ONBOARDING_ITEM_PACKAGE_PRESETS: readonly OnboardingItemPackagePreset[] = Object.freeze([
  {
    presetId: 'field-kit-basic',
    label: 'Basic field kit',
    description: 'Five Basic Balls and two Potions for a classic journey start.',
    trainerItems: [
      { itemId: 'Basic Ball', quantity: 5, section: 'pokeBalls' },
      { itemId: 'Potion', quantity: 2, section: 'medicalKit' },
    ],
  },
  {
    presetId: 'field-kit-stocked',
    label: 'Stocked field kit',
    description: 'Balls, healing, and status cures for a generous opening.',
    trainerItems: [
      { itemId: 'Basic Ball', quantity: 6, section: 'pokeBalls' },
      { itemId: 'Potion', quantity: 3, section: 'medicalKit' },
      { itemId: 'Antidote', quantity: 1, section: 'medicalKit' },
      { itemId: 'Paralyze Heal', quantity: 1, section: 'medicalKit' },
    ],
  },
  {
    presetId: 'empty',
    label: 'No starting items',
    description: 'Players begin with money only.',
    trainerItems: [],
  },
] as const)

export interface OnboardingStarterPoolPreset {
  readonly presetId: string
  readonly label: string
  readonly description: string
  readonly speciesIds: readonly string[]
}

export const ONBOARDING_STARTER_POOL_PRESETS: readonly OnboardingStarterPoolPreset[] = Object.freeze([
  {
    presetId: 'kanto-classic',
    label: 'Kanto classics',
    description: 'Bulbasaur, Charmander, and Squirtle.',
    speciesIds: ['Bulbasaur', 'Charmander', 'Squirtle'],
  },
  {
    presetId: 'johto-classic',
    label: 'Johto classics',
    description: 'Chikorita, Cyndaquil, and Totodile.',
    speciesIds: ['Chikorita', 'Cyndaquil', 'Totodile'],
  },
  {
    presetId: 'hoenn-classic',
    label: 'Hoenn classics',
    description: 'Treecko, Torchic, and Mudkip.',
    speciesIds: ['Treecko', 'Torchic', 'Mudkip'],
  },
] as const)
