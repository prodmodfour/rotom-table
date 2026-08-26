export const GM_CAMPAIGN_TOOLKIT_PATH = '/session-prep' as const
export const GM_CAMPAIGN_TOOLKIT_PATHS = Object.freeze([
  '/session-prep',
  '/encounter-tables',
  '/generate',
  '/npc-trainers',
  '/encounters/new',
] as const)

export const isGmCampaignToolkitPath = (path: string): boolean => GM_CAMPAIGN_TOOLKIT_PATHS.some(root => path === root || path.startsWith(`${root}/`))
