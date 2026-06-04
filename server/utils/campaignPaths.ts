import { homedir } from 'node:os'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { PROJECT_ROOT } from './fsPaths'

export const ROTOM_CAMPAIGN_ROOT_ENV = 'ROTOM_CAMPAIGN_ROOT'

export const resolveConfiguredCampaignRoot = (
  rawRoot: string | undefined = process.env[ROTOM_CAMPAIGN_ROOT_ENV],
): string => {
  const trimmed = rawRoot?.trim()
  if (!trimmed) return PROJECT_ROOT
  const expanded = trimmed === '~' || trimmed.startsWith('~/')
    ? `${homedir()}${trimmed.slice(1)}`
    : trimmed
  return isAbsolute(expanded) ? resolve(expanded) : resolve(PROJECT_ROOT, expanded)
}

export const CAMPAIGN_ROOT = resolveConfiguredCampaignRoot()
export const CAMPAIGN_ROOT_IS_EXTERNAL = CAMPAIGN_ROOT !== PROJECT_ROOT

export const campaignPath = (...segments: string[]): string => resolve(CAMPAIGN_ROOT, ...segments)

export const CAMPAIGN_MAPS_ROOT = campaignPath('data', 'maps')
export const CAMPAIGN_POKEMON_SHEETS_ROOT = campaignPath('data', 'sheets')
export const CAMPAIGN_TRAINER_SHEETS_ROOT = campaignPath('data', 'trainers')
export const CAMPAIGN_PLAYER_PROFILES_ROOT = campaignPath('data', 'player-profiles')
export const CAMPAIGN_REFERENCE_OVERRIDES_ROOT = campaignPath('data', 'reference-overrides')
export const CAMPAIGN_POKEDEX_OVERRIDES_PATH = campaignPath('data', 'reference-overrides', 'pokedex.json')
export const CAMPAIGN_ENCOUNTER_TABLES_ROOT = campaignPath('encounter_tables')

export const pathIsInsideRoot = (root: string, target: string): boolean => {
  const resolvedRoot = resolve(root)
  const resolvedTarget = resolve(target)
  const rel = relative(resolvedRoot, resolvedTarget)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

export const relativeToRoot = (root: string, target: string): string => {
  const rel = relative(resolve(root), resolve(target)).split(sep).join('/')
  return rel || '.'
}

export const relativeToCampaignRoot = (target: string): string => {
  if (pathIsInsideRoot(CAMPAIGN_ROOT, target)) return relativeToRoot(CAMPAIGN_ROOT, target)
  if (pathIsInsideRoot(PROJECT_ROOT, target)) return relativeToRoot(PROJECT_ROOT, target)
  return target
}

export const campaignPathLabel = relativeToCampaignRoot
