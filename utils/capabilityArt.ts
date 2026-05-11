import {
  CAPABILITY_ART_SIZE_PX,
  capabilityArtInitials,
  escapeCapabilityArtXml,
  fallbackCapabilityArt,
  normalizeCapabilityArtName,
  type CapabilityArtDefinition,
  type CapabilityArtSize,
} from '~/utils/capabilityArtCore'

const COLORS = {
  amber: '#d79921',
  gold: '#fabd2f',
  orange: '#fe8019',
  red: '#fb4934',
  green: '#98971a',
  brightGreen: '#b8bb26',
  aqua: '#689d6a',
  brightAqua: '#8ec07c',
  blue: '#458588',
  brightBlue: '#83a598',
  purple: '#b16286',
  brightPurple: '#d3869b',
  brown: '#af7a3b',
  steel: '#7c6f64',
  slate: '#504945',
  dark: '#3c3836',
  black: '#282828',
} as const

export const CAPABILITY_ART: Record<string, CapabilityArtDefinition> = {
  'As One': { color: COLORS.dark, accent: COLORS.gold, icon: 'as-one', label: 'AO' },
  'Weapon Bond': { color: COLORS.steel, accent: COLORS.gold, icon: 'weapon-bond', label: 'WB' },
  'Viral Fusion': { color: COLORS.purple, accent: COLORS.brightAqua, icon: 'viral-fusion', label: 'VF' },
  'Zygarde Cells': { color: COLORS.green, accent: COLORS.brightGreen, icon: 'zygarde-cells', label: 'ZC' },
  Alluring: { color: COLORS.purple, accent: COLORS.brightPurple, icon: 'alluring', label: 'ALR' },
  Amorphous: { color: COLORS.slate, accent: COLORS.brightAqua, icon: 'amorphous', label: 'AMR' },
  'Aura Reader': { color: COLORS.blue, accent: COLORS.gold, icon: 'aura-reader', label: 'AUR' },
  'Aura Pulse': { color: COLORS.blue, accent: COLORS.brightBlue, icon: 'aura-pulse', label: 'AUP' },
  Blindsense: { color: COLORS.dark, accent: COLORS.brightBlue, icon: 'blindsense', label: 'BLS' },
  Bloom: { color: COLORS.brightGreen, accent: COLORS.brightPurple, icon: 'bloom', label: 'BLM' },
  Blender: { color: COLORS.aqua, accent: COLORS.gold, icon: 'blender', label: 'BLD' },
  Chilled: { color: COLORS.brightBlue, accent: '#d9f8ff', icon: 'chilled', label: 'CHL' },
  Darkvision: { color: COLORS.black, accent: COLORS.brightBlue, icon: 'darkvision', label: 'DV' },
  'Dead Silent': { color: COLORS.dark, accent: COLORS.steel, icon: 'dead-silent', label: 'DS' },
  'Delta Evolution': { color: COLORS.red, accent: COLORS.gold, icon: 'delta-evolution', label: 'ΔE' },
  'Dream Mist': { color: COLORS.purple, accent: COLORS.brightBlue, icon: 'dream-mist', label: 'DM' },
  'Dream Reader': { color: COLORS.purple, accent: COLORS.gold, icon: 'dream-reader', label: 'DR' },
  'Egg Warmer': { color: COLORS.orange, accent: COLORS.gold, icon: 'egg-warmer', label: 'EW' },
  Firestarter: { color: COLORS.red, accent: COLORS.orange, icon: 'firestarter', label: 'FIR' },
  Fortune: { color: COLORS.amber, accent: COLORS.gold, icon: 'fortune', label: '₽' },
  Fountain: { color: COLORS.blue, accent: COLORS.brightBlue, icon: 'fountain', label: 'WTR' },
  Freezer: { color: COLORS.brightBlue, accent: '#e9fbff', icon: 'freezer', label: 'ICE' },
  'Gather Unown': { color: COLORS.dark, accent: COLORS.brightPurple, icon: 'gather-unown', label: 'UN' },
  Gilled: { color: COLORS.blue, accent: COLORS.brightAqua, icon: 'gilled', label: 'GIL' },
  Glow: { color: COLORS.amber, accent: COLORS.gold, icon: 'glow', label: 'GLO' },
  Groundshaper: { color: COLORS.brown, accent: COLORS.gold, icon: 'groundshaper', label: 'GRD' },
  Guster: { color: COLORS.brightBlue, accent: COLORS.gold, icon: 'guster', label: 'GST' },
  'Heart Gift': { color: COLORS.purple, accent: COLORS.gold, icon: 'heart-gift', label: 'HG' },
  Heater: { color: COLORS.orange, accent: COLORS.gold, icon: 'heater', label: 'HOT' },
  'Herb Growth': { color: COLORS.aqua, accent: COLORS.brightGreen, icon: 'herb-growth', label: 'HER' },
  'Honey Gather': { color: COLORS.amber, accent: COLORS.gold, icon: 'honey-gather', label: 'HNY' },
  Illusionist: { color: COLORS.purple, accent: COLORS.brightBlue, icon: 'illusionist', label: 'ILL' },
  Inflatable: { color: COLORS.orange, accent: COLORS.gold, icon: 'inflatable', label: 'INF' },
  Invisibility: { color: COLORS.slate, accent: COLORS.brightBlue, icon: 'invisibility', label: 'INV' },
  Juicer: { color: COLORS.aqua, accent: COLORS.orange, icon: 'juicer', label: 'JCE' },
  'Keystone Warp': { color: COLORS.dark, accent: COLORS.brightPurple, icon: 'keystone-warp', label: 'KW' },
  'Letter Press': { color: COLORS.slate, accent: COLORS.gold, icon: 'letter-press', label: 'ABC' },
  'Living Weapon': { color: COLORS.steel, accent: COLORS.red, icon: 'living-weapon', label: 'LW' },
  Magnetic: { color: COLORS.red, accent: COLORS.brightBlue, icon: 'magnetic', label: 'MAG' },
  Marsupial: { color: COLORS.brown, accent: COLORS.gold, icon: 'marsupial', label: 'MAR' },
  Materializer: { color: COLORS.brown, accent: COLORS.gold, icon: 'materializer', label: 'ROC' },
  'Milk Collection': { color: COLORS.brightBlue, accent: '#fbf1c7', icon: 'milk-collection', label: 'MLK' },
  Mindlock: { color: COLORS.dark, accent: COLORS.gold, icon: 'mindlock', label: 'MND' },
  'Mountable X': { color: COLORS.brown, accent: COLORS.gold, icon: 'mountable', label: 'MTX' },
  'Mushroom Harvest': { color: COLORS.purple, accent: COLORS.gold, icon: 'mushroom-harvest', label: 'MSH' },
  Naturewalk: { color: COLORS.aqua, accent: COLORS.brightGreen, icon: 'naturewalk', label: 'NAT' },
  'Pack Mon': { color: COLORS.brown, accent: COLORS.gold, icon: 'pack-mon', label: 'PK' },
  'Pearl Creation': { color: COLORS.brightBlue, accent: COLORS.brightPurple, icon: 'pearl-creation', label: 'PRL' },
  Phasing: { color: COLORS.purple, accent: COLORS.brightBlue, icon: 'phasing', label: 'PHS' },
  Planter: { color: COLORS.aqua, accent: COLORS.brightGreen, icon: 'planter', label: 'PLT' },
  Premonition: { color: COLORS.amber, accent: COLORS.red, icon: 'premonition', label: 'PRE' },
  Reach: { color: COLORS.orange, accent: COLORS.gold, icon: 'reach', label: 'RCH' },
  'Shadow Meld': { color: COLORS.black, accent: COLORS.purple, icon: 'shadow-meld', label: 'SHD' },
  Shapeshifter: { color: COLORS.slate, accent: COLORS.brightAqua, icon: 'shapeshifter', label: 'SHP' },
  Shrinkable: { color: COLORS.blue, accent: COLORS.gold, icon: 'shrinkable', label: 'SHR' },
  Soulless: { color: COLORS.dark, accent: COLORS.brightPurple, icon: 'soulless', label: 'SOL' },
  'Split Evolution': { color: COLORS.green, accent: COLORS.gold, icon: 'split-evolution', label: 'SPL' },
  Sprouter: { color: COLORS.brightGreen, accent: COLORS.gold, icon: 'sprouter', label: 'SPR' },
  Stealth: { color: COLORS.black, accent: COLORS.brightAqua, icon: 'stealth', label: 'STL' },
  Telekinetic: { color: COLORS.purple, accent: COLORS.brightBlue, icon: 'telekinetic', label: 'TK' },
  Telepath: { color: COLORS.blue, accent: COLORS.brightPurple, icon: 'telepath', label: 'TP' },
  Threaded: { color: COLORS.aqua, accent: COLORS.gold, icon: 'threaded', label: 'THR' },
  Tracker: { color: COLORS.brown, accent: COLORS.brightGreen, icon: 'tracker', label: 'TRK' },
  Tremorsense: { color: COLORS.brown, accent: COLORS.gold, icon: 'tremorsense', label: 'TRM' },
  Underdog: { color: COLORS.steel, accent: COLORS.gold, icon: 'underdog', label: 'UD' },
  'Volatile Bomb': { color: COLORS.red, accent: COLORS.gold, icon: 'volatile-bomb', label: 'BOM' },
  Wallclimber: { color: COLORS.aqua, accent: COLORS.gold, icon: 'wallclimber', label: 'WAL' },
  Weathershape: { color: COLORS.blue, accent: COLORS.gold, icon: 'weathershape', label: 'WX' },
  Wielder: { color: COLORS.steel, accent: COLORS.gold, icon: 'wielder', label: 'WLD' },
  Wired: { color: COLORS.blue, accent: COLORS.gold, icon: 'wired', label: 'CPU' },
  'X-Ray Vision': { color: COLORS.black, accent: COLORS.brightBlue, icon: 'x-ray-vision', label: 'XRV' },
  Zapper: { color: COLORS.amber, accent: COLORS.gold, icon: 'zapper', label: 'ZAP' },
}

const FALLBACK_ART_PALETTE = {
  backgrounds: [COLORS.slate, COLORS.blue, COLORS.aqua, COLORS.brown, COLORS.purple, COLORS.amber],
  accents: [COLORS.gold, COLORS.brightBlue, COLORS.brightAqua, COLORS.brightPurple, COLORS.orange],
} as const

const hasCapabilityArt = (name: string): boolean => Boolean(CAPABILITY_ART[name])

const iconMarkup = (icon: string, accent: string): string => {
  const cream = 'rgba(251,241,199,.96)'
  const soft = 'rgba(251,241,199,.58)'
  const dark = 'rgba(29,32,33,.35)'
  const line = `fill="none" stroke="${cream}" stroke-width="4.2" stroke-linecap="round" stroke-linejoin="round"`
  const thin = `fill="none" stroke="${cream}" stroke-width="2.7" stroke-linecap="round" stroke-linejoin="round"`
  const accentLine = `fill="none" stroke="${accent}" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"`
  const fill = `fill="${cream}"`
  const accentFill = `fill="${accent}"`
  const softFill = `fill="${soft}"`
  const darkFill = `fill="${dark}"`

  switch (icon) {
    case 'as-one':
      return `<path ${line} d="M6 44c8-13 21-17 38-12l9-9 4 10 5 3-5 5-4 12H42l-3-9H24l-6 9H9l5-10"/><circle ${fill} cx="29" cy="18" r="5.2"/><path ${line} d="M30 23l5 12M22 30l10-4"/><path ${accentFill} d="M43 17l5 4 5-4v9c0 4-2.5 7-5 8.5-2.5-1.5-5-4.5-5-8.5z"/>`
    case 'weapon-bond':
      return `<path ${fill} d="M28 5h8l-2 32 9 9-5 5-8-8-8 8-5-5 9-9z"/><path ${accentFill} d="M42 12h15v15c0 11-7 18-15 22-8-4-15-11-15-22v-5h15z" opacity=".9"/><path ${thin} d="M42 18v24M34 26h16"/>`
    case 'viral-fusion':
      return `<circle ${softFill} cx="23" cy="29" r="14"/><circle ${softFill} cx="42" cy="29" r="14"/><circle ${accentFill} cx="32.5" cy="38" r="17" opacity=".92"/><path ${thin} d="M18 29h29M32 18v34M21 44c7-7 16-7 23 0"/>`
    case 'zygarde-cells':
      return `<path ${accentFill} d="M32 6 47 15v18L32 42 17 33V15z"/><path ${softFill} d="M15 38 27 45v14l-12-7zm34 0-12 7v14l12-7z"/><circle ${fill} cx="27" cy="22" r="3"/><circle ${fill} cx="37" cy="22" r="3"/><path ${thin} d="M25 32h14"/>`
    case 'alluring':
      return `<path ${line} d="M19 48c8-8 19-8 27 0"/><path ${accentLine} d="M19 21c-9 2-11 13-3 18 3 2 8 1 10-3 1-3 0-7-4-8M45 21c9 2 11 13 3 18-3 2-8 1-10-3-1-3 0-7 4-8"/><circle ${fill} cx="32" cy="32" r="8"/><path ${thin} d="M48 10c5 4 5 8 0 12M55 20c5 4 5 8 0 12"/>`
    case 'amorphous':
      return `<path ${fill} d="M14 42c-7-10 2-26 15-20 7-13 28-5 24 10 10 5 6 23-7 22H24c-5 0-8-4-10-12Z"/><circle ${darkFill} cx="28" cy="36" r="3"/><circle ${darkFill} cx="42" cy="36" r="3"/><path ${accentLine} d="M13 48c10 7 29 8 39 0"/>`
    case 'aura-reader':
      return `<path ${line} d="M5 33s10-17 27-17 27 17 27 17-10 17-27 17S5 33 5 33Z"/><circle ${accentFill} cx="32" cy="33" r="10"/><circle ${darkFill} cx="32" cy="33" r="4"/><path ${thin} d="M13 12c11-8 27-8 38 0M13 54c11 7 27 7 38 0"/>`
    case 'aura-pulse':
      return `<path ${accentFill} d="M32 10 45 23 32 36 19 23z"/><path ${line} d="M18 39 32 53l14-14M11 23C7 29 7 38 11 44M53 23c4 6 4 15 0 21"/><path ${thin} d="M20 23h24"/>`
    case 'blindsense':
      return `<path ${fill} d="M11 33c7-15 18-6 21-2 3-4 14-13 21 2-4-1-10 2-14 8-3 5-11 5-14 0-4-6-10-9-14-8Z"/><path ${accentLine} d="M42 18c8 3 13 9 15 17M49 9c9 5 15 14 17 25M22 18C14 21 9 27 7 35"/><circle ${darkFill} cx="32" cy="36" r="4"/>`
    case 'bloom':
      return `<circle ${accentFill} cx="32" cy="32" r="8"/><path ${fill} d="M32 5c8 8 8 17 0 25-8-8-8-17 0-25ZM32 59c-8-8-8-17 0-25 8 8 8 17 0 25ZM5 32c8-8 17-8 25 0-8 8-17 8-25 0ZM59 32c-8 8-17 8-25 0 8-8 17-8 25 0Z"/><path ${softFill} d="M13 13c11 0 17 6 17 17-11 0-17-6-17-17Zm38 0c0 11-6 17-17 17 0-11 6-17 17-17Zm0 38c-11 0-17-6-17-17 11 0 17 6 17 17Zm-38 0c0-11 6-17 17-17 0 11-6 17-17 17Z"/>`
    case 'blender':
      return `<path ${fill} d="M12 36c6-12 17-19 31-16 8 2 13 8 13 15 0 9-7 16-18 16H25c-8 0-14-6-13-15Z"/><circle ${darkFill} cx="43" cy="31" r="3"/><path ${accentFill} d="M16 39h11v8H15zm15-14h12v8H31zm10 18h13v7H41z" opacity=".9"/><path ${thin} d="M13 35H5M54 38h6"/>`
    case 'chilled':
      return `<path ${line} d="M32 5v54M9 18l46 28M55 18 9 46"/><path ${thin} d="M22 8 32 17 42 8M22 56l10-9 10 9M7 29l13-4 3-13M57 29l-13-4-3-13M7 35l13 4 3 13M57 35l-13 4-3 13"/><circle ${accentFill} cx="32" cy="32" r="6"/>`
    case 'darkvision':
      return `<path ${accentFill} d="M42 7c-8 3-14 11-14 20 0 12 10 22 22 22 2 0 4 0 6-.6-5 7-13 11-23 11-15 0-27-12-27-27C6 17 18 5 33 5c3 0 6 .7 9 2Z"/><path ${line} d="M10 35s8-12 22-12 22 12 22 12-8 12-22 12-22-12-22-12Z"/><circle ${fill} cx="32" cy="35" r="5"/>`
    case 'dead-silent':
      return `<path ${fill} d="M31 6c12 0 20 8 20 20 0 8-4 14-10 17v9H23v-9C17 40 13 34 13 26 13 14 20 6 31 6Z"/><circle ${darkFill} cx="25" cy="27" r="3.5"/><circle ${darkFill} cx="38" cy="27" r="3.5"/><path ${darkFill} d="M29 34h5l-2.5 4z"/><path ${accentLine} d="M9 56 56 9M9 18c5 4 5 9 0 13"/>`
    case 'delta-evolution':
      return `<path ${line} d="M32 7 58 55H6Z"/><path ${accentFill} d="M32 20 45 45H19z"/><path ${thin} d="M14 13c12-9 27-9 39 0M50 9l4 5-7 1"/>`
    case 'dream-mist':
      return `<path ${fill} d="M18 42c-9 0-13-12-5-17 2-10 17-14 24-5 9-2 17 5 17 14 0 5-4 8-9 8Z"/><path ${accentLine} d="M17 50c8 4 18 4 26 0M23 57c5 2 12 2 17 0"/><path ${softFill} d="M45 9c-5 2-9 7-9 13 0 8 6 14 14 14 2 0 4-.4 5-1-3 5-8 8-15 8-10 0-18-8-18-18S30 7 40 7c2 0 4 .3 5 2Z"/>`
    case 'dream-reader':
      return `<path ${line} d="M8 35s9-14 24-14 24 14 24 14-9 14-24 14S8 35 8 35Z"/><circle ${accentFill} cx="32" cy="35" r="8"/><text x="45" y="19" ${fill} font-size="13" font-family="Arial, sans-serif" font-weight="900">Z</text><path ${thin} d="M16 53c8 5 24 5 32 0"/>`
    case 'egg-warmer':
      return `<path ${fill} d="M32 10c12 13 18 24 18 34 0 10-8 16-18 16s-18-6-18-16c0-10 6-21 18-34Z"/><path ${accentFill} d="M20 51c-3-8 2-15 9-21 0 7 3 10 8 12 2-4 2-8 0-14 7 5 10 12 8 20-2 8-8 12-13 12-5 0-10-3-12-9Z"/>`
    case 'firestarter':
      return `<path ${fill} d="M35 60C20 60 11 51 11 39c0-9 5-17 13-24 0 8 4 12 9 15 5-10 2-18-2-26 13 6 22 17 22 31 0 15-10 25-18 25Z"/><path ${accentFill} d="M33 55c-7 0-12-5-12-11 0-5 3-9 7-13 1 5 4 8 8 9 3-5 2-9 0-14 7 4 12 10 12 17 0 8-6 12-15 12Z"/>`
    case 'fortune':
      return `<circle ${fill} cx="32" cy="33" r="23"/><circle ${accentFill} cx="32" cy="33" r="16"/><text x="32" y="42" text-anchor="middle" fill="rgba(29,32,33,.55)" font-size="27" font-family="Arial, sans-serif" font-weight="900">₽</text><path ${thin} d="M14 11 9 16M52 49l5 5M51 12l5-5"/>`
    case 'fountain':
      return `<path ${fill} d="M32 5c14 17 22 28 22 39 0 10-9 17-22 17S10 54 10 44C10 33 18 22 32 5Z"/><path ${accentFill} d="M17 43c8 6 22 6 30 0-2 9-8 14-15 14s-13-5-15-14Z"/><path ${thin} d="M14 21c6 3 10 7 11 14M50 21c-6 3-10 7-11 14"/>`
    case 'freezer':
      return `<path ${fill} d="M15 16h34v34H15z" rx="4"/><path ${accentFill} d="M22 23h20v20H22z" opacity=".75"/><path ${thin} d="M15 16 8 9M49 16l7-7M15 50l-7 7M49 50l7 7M24 33h16M32 25v16"/>`
    case 'gather-unown':
      return `<circle ${line} cx="32" cy="32" r="24"/><circle ${accentFill} cx="32" cy="32" r="6"/><text x="14" y="25" ${fill} font-size="12" font-family="Arial, sans-serif" font-weight="900">!</text><text x="45" y="25" ${fill} font-size="12" font-family="Arial, sans-serif" font-weight="900">?</text><text x="19" y="51" ${fill} font-size="12" font-family="Arial, sans-serif" font-weight="900">A</text><text x="41" y="51" ${fill} font-size="12" font-family="Arial, sans-serif" font-weight="900">Z</text><path ${thin} d="M32 8v9M32 47v9M8 32h9M47 32h9"/>`
    case 'gilled':
      return `<path ${fill} d="M7 34c10-13 27-18 43-5l8-8v26l-8-8C34 52 17 47 7 34Z"/><circle ${darkFill} cx="23" cy="32" r="3"/><path ${accentLine} d="M35 22c-4 7-4 17 0 24M43 25c-3 5-3 13 0 18M15 48c-5 4-7 8-7 12"/>`
    case 'glow':
      return `<circle ${accentFill} cx="32" cy="28" r="15"/><path ${line} d="M32 4v8M32 44v8M8 28h8M48 28h8M15 11l6 6M49 11l-6 6M15 45l6-6M49 45l-6-6"/><path ${fill} d="M23 48h18l-3 11H26z"/>`
    case 'groundshaper':
      return `<path ${fill} d="M5 50h54v9H5z"/><path ${accentFill} d="M10 38h44v9H10zM17 26h30v9H17z"/><path ${line} d="M13 25 26 12l8 9 6-6 12 10M13 38c7-3 14-3 21 0s14 3 21 0"/>`
    case 'guster':
      return `<path ${line} d="M7 23h33c6 0 9-8 4-12-4-3-9-1-10 4M11 36h42c7 0 10 9 4 14-5 4-11 1-12-5M6 49h24"/><path ${accentFill} d="m43 18 13 5-13 5c3-3 3-7 0-10Z"/>`
    case 'heart-gift':
      return `<path ${accentFill} d="M32 54 14 36C4 26 10 10 23 10c5 0 8 3 9 6 1-3 4-6 9-6 13 0 19 16 9 26Z"/><path ${fill} d="M38 40c8 1 13 5 14 13-8-1-13-5-14-13Zm-12 0c-8 1-13 5-14 13 8-1 13-5 14-13Z"/><circle ${fill} cx="32" cy="35" r="5"/>`
    case 'heater':
      return `<circle ${accentFill} cx="32" cy="25" r="17"/><path ${line} d="M32 3v7M32 40v8M10 25h7M47 25h7M16 9l5 5M48 9l-5 5M16 41l5-5M48 41l-5-5"/><path ${fill} d="M15 50h34v8H15z"/><path ${thin} d="M22 50v8M32 50v8M42 50v8"/>`
    case 'herb-growth':
      return `<path ${line} d="M32 57V31"/><path ${fill} d="M31 31C14 29 9 15 12 6c14 2 20 11 19 25Zm3 4c17-2 23-13 20-23-14 0-22 9-20 23Z"/><path ${accentFill} d="M22 42h20v7H22zM28 35h8v21h-8z" opacity=".95"/>`
    case 'honey-gather':
      return `<path ${fill} d="M24 8h16l8 14-8 14H24l-8-14zM8 31h16l8 14-8 14H8L0 45zm32 0h16l8 14-8 14H40l-8-14z"/><path ${accentFill} d="M32 18c7 8 11 14 11 20 0 6-5 10-11 10s-11-4-11-10c0-6 4-12 11-20Z" opacity=".95"/>`
    case 'illusionist':
      return `<path ${fill} d="M12 15c10-6 30-6 40 0v16c0 13-8 23-20 28-12-5-20-15-20-28Z"/><path ${darkFill} d="M18 28c8-5 16-4 22 2-7 4-15 4-22-2Zm28 0c-5-3-10-3-15 1 5 3 10 3 15-1Z"/><path ${accentLine} d="M15 50c10-7 24-7 34 0M50 10l5-7 5 7"/>`
    case 'inflatable':
      return `<circle ${fill} cx="32" cy="32" r="19"/><path ${accentLine} d="M32 6v12M32 46v12M6 32h12M46 32h12M14 14l8 8M50 14l-8 8M14 50l8-8M50 50l-8-8"/><path ${darkFill} d="M25 26h5v5h-5zm10 0h5v5h-5z"/>`
    case 'invisibility':
      return `<path ${thin} d="M6 34s10-15 26-15 26 15 26 15-10 15-26 15S6 34 6 34Z" stroke-dasharray="5 5"/><circle ${fill} cx="32" cy="34" r="8" opacity=".62"/><path ${accentLine} d="M10 56 56 10"/><path ${line} d="M18 18c8-7 20-7 28 0" opacity=".55"/>`
    case 'juicer':
      return `<path ${fill} d="M20 18h24l-3 40H23z"/><path ${accentFill} d="M23 38h18l-2 17H25z"/><path ${thin} d="M21 18h22M26 10h12M32 10v8"/><circle ${accentFill} cx="44" cy="17" r="6"/><path ${line} d="M10 33c6-4 12-4 18 0"/>`
    case 'keystone-warp':
      return `<path ${fill} d="M32 6 50 18l-4 36-14 7-14-7-4-36z"/><ellipse ${accentLine} cx="32" cy="33" rx="16" ry="22"/><ellipse ${thin} cx="32" cy="33" rx="7" ry="15"/><path ${accentFill} d="M29 28h6v10h-6z"/>`
    case 'letter-press':
      return `<rect ${fill} x="10" y="15" width="44" height="32" rx="4"/><path ${accentFill} d="M16 9h32v10H16zM20 47h24v10H20z"/><text x="32" y="38" text-anchor="middle" fill="rgba(29,32,33,.55)" font-size="22" font-family="Arial, sans-serif" font-weight="900">A</text><path ${thin} d="M16 57h32"/>`
    case 'living-weapon':
      return `<path ${fill} d="M29 4h7l-2 35 10 10-5 6-7-7-7 7-5-6 10-10z"/><path ${accentFill} d="M18 20c8-7 20-7 28 0-8 7-20 7-28 0Z" opacity=".96"/><circle ${darkFill} cx="32" cy="20" r="4"/><path ${thin} d="M17 59h30"/>`
    case 'magnetic':
      return `<path ${line} d="M16 10v22c0 10 6 17 16 17s16-7 16-17V10H37v22c0 4-2 7-5 7s-5-3-5-7V10Z"/><path ${accentFill} d="M16 10h11v10H16zm21 0h11v10H37z"/><path ${thin} d="M5 25h8M51 25h8"/>`
    case 'marsupial':
      return `<path ${fill} d="M16 20c4-9 12-14 21-11 9 3 14 12 12 24-2 13-11 22-23 22-9 0-15-6-15-15 0-6 2-11 5-20Z"/><path ${accentFill} d="M20 36c6-7 18-7 24 0-2 10-7 15-12 15s-10-5-12-15Z"/><circle ${darkFill} cx="32" cy="41" r="3"/><path ${thin} d="M40 13l10-8M21 16l-8-8"/>`
    case 'materializer':
      return `<path ${fill} d="M32 5 49 20 43 55H21L15 20z"/><path ${accentFill} d="M32 5v50M15 20h34M21 55l11-35 11 35" opacity=".75"/><path ${thin} d="M7 50h12M45 50h12"/>`
    case 'milk-collection':
      return `<path ${fill} d="M23 5h18v12l5 8v31c0 3-2 5-5 5H23c-3 0-5-2-5-5V25l5-8Z"/><path ${accentFill} d="M20 34h24v21H20z" opacity=".95"/><path ${thin} d="M24 5h16M23 17h18M16 36c8 5 24 5 32 0"/>`
    case 'mindlock':
      return `<path ${fill} d="M20 29c-8-10 3-24 15-17 4-7 18-3 17 8 9 2 10 16 1 20 2 10-10 17-18 10-8 9-23 1-18-11-6-1-8-7-5-10Z"/><rect ${accentFill} x="22" y="31" width="28" height="20" rx="4"/><path ${thin} d="M28 31v-5c0-6 4-10 8-10s8 4 8 10v5"/><circle ${darkFill} cx="36" cy="41" r="3"/>`
    case 'mountable':
      return `<path ${fill} d="M13 39c3-13 12-21 26-22l9 5c5 3 7 8 5 14l-5 15H37l-2-10H23l-5 10H8z"/><path ${accentFill} d="M22 20h25l-5 14H18z"/><path ${thin} d="M23 20c2-8 9-12 16-10M44 23l9-8M29 34v12"/>`
    case 'mushroom-harvest':
      return `<path ${fill} d="M8 31c2-15 13-24 28-22 12 2 20 10 20 22 0 4-3 7-7 7H15c-4 0-7-3-7-7Z"/><path ${accentFill} d="M24 36h16l3 23H21z"/><circle ${accentFill} cx="22" cy="24" r="4"/><circle ${accentFill} cx="39" cy="19" r="3.5"/><circle ${accentFill} cx="47" cy="30" r="3"/>`
    case 'naturewalk':
      return `<path ${line} d="M11 51c11-12 24-20 42-27"/><path ${fill} d="M39 12c12-5 19-1 21 10-9 6-18 5-24-3 3-2 4-4 3-7ZM21 30C10 27 5 20 8 10c12 1 18 8 18 19-3-1-4 0-5 1Z"/><path ${accentFill} d="M20 44c2-5 7-8 12-6 2 5-1 10-6 12-3 1-6-1-6-6Z"/>`
    case 'pack-mon':
      return `<path ${fill} d="M32 18c8 0 14 6 14 14 0 10-7 18-14 18s-14-8-14-18c0-8 6-14 14-14Z"/><circle ${fill} cx="15" cy="28" r="6"/><circle ${fill} cx="49" cy="28" r="6"/><circle ${fill} cx="23" cy="14" r="5"/><circle ${fill} cx="41" cy="14" r="5"/><path ${accentFill} d="M21 10h22l-5 10-6-5-6 5z"/>`
    case 'pearl-creation':
      return `<path ${fill} d="M10 40c6-19 20-29 41-30 2 19-8 34-27 43-5 2-11-2-14-13Z"/><path ${thin} d="M18 40c8-9 18-15 31-20M24 48c8-5 15-9 23-14"/><circle ${accentFill} cx="34" cy="39" r="9"/>`
    case 'phasing':
      return `<path ${fill} d="M20 55V25c0-11 7-18 16-18s16 7 16 18v30l-8-6-8 6-8-6z" opacity=".78"/><rect ${accentFill} x="7" y="20" width="18" height="36" rx="2" opacity=".75"/><path ${line} d="M14 28h40M14 39h40M31 13c8 3 12 10 12 20"/>`
    case 'planter':
      return `<path ${fill} d="M16 34h32l-5 24H21z"/><path ${line} d="M32 34V12"/><path ${accentFill} d="M31 21C18 20 14 10 16 4c11 1 16 8 15 17Zm3 5c13-1 19-9 17-18-11 0-17 7-17 18Z"/><path ${thin} d="M20 42h24"/>`
    case 'premonition':
      return `<path ${accentFill} d="M32 5 61 56H3Z"/><path ${fill} d="M30 20h5v18h-5zm0 24h5v5h-5z"/><path ${line} d="M10 58c7-6 15-6 22 0s15 6 22 0"/><path ${thin} d="M15 15c5-7 12-10 20-10"/>`
    case 'reach':
      return `<path ${line} d="M9 43c12-2 20-2 28 0l13-19"/><path ${fill} d="M42 18c4-5 12-4 16 0l-5 8c-4 5-11 5-16 0z"/><path ${accentLine} d="M8 22h24M24 13l9 9-9 9"/><circle ${fill} cx="13" cy="45" r="7"/>`
    case 'shadow-meld':
      return `<path ${accentFill} d="M48 9c-8 2-14 10-14 19 0 11 9 20 20 20 2 0 4-.3 6-.8-5 7-13 11-22 11-15 0-27-12-27-27S23 4 38 4c4 0 7 1 10 5Z"/><ellipse ${darkFill} cx="32" cy="52" rx="24" ry="8"/><path ${line} d="M17 37c9 6 21 6 30 0"/>`
    case 'shapeshifter':
      return `<path ${fill} d="M13 42c-7-10 3-25 16-19 2-10 17-15 25-5 8 10 2 25-10 26 4 12-13 22-23 12-4-4-6-9-8-14Z"/><path ${accentLine} d="M18 20c8-8 20-8 28 0M20 53c10-4 20-4 30 0"/><path ${darkFill} d="M26 32h5v5h-5zm12 0h5v5h-5z"/>`
    case 'shrinkable':
      return `<rect ${fill} x="24" y="24" width="16" height="16" rx="4"/><path ${accentLine} d="M6 6l16 16M58 6 42 22M6 58l16-16M58 58 42 42"/><path ${thin} d="M22 6v16H6M42 6v16h16M22 58V42H6M42 58V42h16"/>`
    case 'soulless':
      return `<path ${fill} d="M32 7c13 0 22 10 22 23 0 15-10 26-22 26S10 45 10 30C10 17 19 7 32 7Z"/><circle ${darkFill} cx="24" cy="29" r="5"/><circle ${darkFill} cx="40" cy="29" r="5"/><path ${accentLine} d="M18 54c7 6 21 6 28 0M32 9c-4 8-4 16 0 24 4-8 4-16 0-24Z"/>`
    case 'split-evolution':
      return `<path ${line} d="M32 55V29M32 29 15 12M32 29l17-17"/><path ${thin} d="M15 12h16M15 12v16M49 12H33M49 12v16"/><path ${accentFill} d="M23 39h18l6 12-15 9-15-9z"/><path ${fill} d="M12 9h9v9h-9zm31 0h9v9h-9z"/>`
    case 'sprouter':
      return `<path ${line} d="M32 57V31"/><path ${fill} d="M31 31C14 28 10 16 13 7c14 1 20 10 18 24Zm3 4c17-2 23-12 21-24-14 0-22 9-21 24Z"/><path ${accentLine} d="M9 48c7-7 16-10 27-8M48 7l4-5 4 5M8 12l5-4"/>`
    case 'stealth':
      return `<path ${fill} d="M8 29c8-10 16-15 24-15s16 5 24 15c-8 10-16 15-24 15S16 39 8 29Z"/><path ${darkFill} d="M17 29c5-4 10-4 15 0-5 4-10 4-15 0Zm15 0c5-4 10-4 15 0-5 4-10 4-15 0Z"/><path ${accentLine} d="M10 54c7-4 14-4 21 0M38 54c5-3 10-3 15 0"/>`
    case 'telekinetic':
      return `<path ${line} d="M20 51V28c0-4 6-4 6 0v14M26 40V22c0-4 6-4 6 0v18M32 39V20c0-4 6-4 6 0v20M38 42V27c0-4 6-4 6 0v20c0 8-5 13-12 13h-3c-8 0-13-5-13-13"/><circle ${accentFill} cx="49" cy="13" r="6"/><circle ${accentFill} cx="12" cy="16" r="4"/><path ${thin} d="M46 24c6 4 8 10 6 17"/>`
    case 'telepath':
      return `<circle ${fill} cx="20" cy="34" r="11"/><circle ${fill} cx="44" cy="34" r="11"/><path ${accentLine} d="M24 18c5-5 11-5 16 0M25 50c5 5 10 5 15 0M31 28h2M31 40h2"/><path ${thin} d="M13 54c4-5 10-7 17-7M34 47c7 0 13 2 17 7"/>`
    case 'threaded':
      return `<circle ${fill} cx="18" cy="45" r="9"/><circle ${fill} cx="46" cy="19" r="9"/><path ${line} d="M24 40 40 24M10 45H3M46 10V3M55 19h6"/><path ${accentLine} d="M12 17c10-8 25-8 35 0M16 23c8-5 20-5 28 0"/>`
    case 'tracker':
      return `<path ${fill} d="M32 18c10 0 17 7 17 16 0 12-9 22-17 22S15 46 15 34c0-9 7-16 17-16Z"/><circle ${darkFill} cx="26" cy="33" r="3"/><circle ${darkFill} cx="38" cy="33" r="3"/><path ${darkFill} d="M27 42c3-3 7-3 10 0-1 4-3 6-5 6s-4-2-5-6Z"/><path ${accentLine} d="M8 10c7 3 11 8 12 15M56 10c-7 3-11 8-12 15"/>`
    case 'tremorsense':
      return `<path ${fill} d="M5 50h54v9H5z"/><path ${accentLine} d="M9 42c6-5 12-5 18 0s12 5 18 0 8-3 12 0M14 33c5-4 10-4 15 0s10 4 15 0M20 24c4-3 8-3 12 0s8 3 12 0"/><path ${line} d="M32 6v12M24 12l8 8 8-8"/>`
    case 'underdog':
      return `<path ${fill} d="m32 6 6 17 18 1-14 11 5 18-15-10-15 10 5-18L8 24l18-1z"/><path ${accentFill} d="M32 20 44 48H20z" opacity=".86"/><path ${thin} d="M32 49V24M23 33l9-9 9 9"/>`
    case 'volatile-bomb':
      return `<circle ${fill} cx="31" cy="37" r="18"/><path ${accentFill} d="M42 10 48 3l3 9 9 3-8 5 1 10-8-5-8 5 2-10-8-5z"/><path ${thin} d="M39 22c3-6 8-9 15-9M18 25l-8-8M14 37H4"/>`
    case 'wallclimber':
      return `<rect ${softFill} x="7" y="6" width="22" height="52" rx="3"/><path ${line} d="M44 55V25l-9 8M44 25l9 8M32 43h12M23 16h6M7 24h22M7 42h22"/><circle ${accentFill} cx="44" cy="17" r="7"/>`
    case 'weathershape':
      return `<circle ${accentFill} cx="24" cy="20" r="10"/><path ${fill} d="M24 48c-9 0-13-11-6-16 2-8 14-10 19-4 8-2 14 4 14 11 0 6-5 9-11 9Z"/><path ${thin} d="M46 49v10M34 51l-4 8M54 50l-4 8M10 20H3M24 6V1M38 20h7"/>`
    case 'wielder':
      return `<path ${fill} d="M26 58V35c0-4 6-4 6 0v12M32 47V28c0-4 6-4 6 0v19M38 48V34c0-4 6-4 6 0v17c0 7-5 11-12 11h-3c-8 0-13-5-13-13V38c0-4 6-4 6 0v10"/><path ${accentFill} d="M42 4h7l-2 24 7 7-5 5-7-7-7 7-5-5 8-7z"/>`
    case 'wired':
      return `<rect ${fill} x="14" y="13" width="36" height="36" rx="6"/><path ${accentFill} d="M24 23h16v16H24z"/><path ${thin} d="M22 5v8M32 5v8M42 5v8M22 49v8M32 49v8M42 49v8M6 23h8M6 33h8M6 43h8M50 23h8M50 33h8M50 43h8"/><path ${line} d="M28 33h8M32 29v8"/>`
    case 'x-ray-vision':
      return `<path ${line} d="M6 32s10-16 26-16 26 16 26 16-10 16-26 16S6 32 6 32Z"/><circle ${accentFill} cx="32" cy="32" r="8"/><path ${thin} d="M17 54 47 10M47 54 17 10"/><path ${fill} d="M27 26h10v12H27z" opacity=".55"/>`
    case 'zapper':
      return `<path ${fill} d="M38 4 11 36h17l-5 24 30-37H35z"/><path ${accentFill} d="M34 15 21 31h14l-3 13 16-20H34z"/><path ${thin} d="M9 14c7-5 14-5 21 0M34 52c7 4 14 4 21 0"/>`
    default:
      return `<circle ${fill} cx="32" cy="32" r="22"/><text x="32" y="42" text-anchor="middle" fill="rgba(29,32,33,.55)" font-size="30" font-family="Arial, sans-serif" font-weight="900">?</text><path ${accentLine} d="M14 52c10 6 26 6 36 0"/>`
  }
}

export const capabilityArtTitle = (rawName: string): string => {
  const canonical = normalizeCapabilityArtName(rawName, hasCapabilityArt)
  return `${canonical} capability art`
}

export const capabilityArtSvg = (rawName: string, size: CapabilityArtSize = 'md'): string => {
  const canonical = normalizeCapabilityArtName(rawName, hasCapabilityArt)
  const art = CAPABILITY_ART[canonical] ?? fallbackCapabilityArt(canonical, FALLBACK_ART_PALETTE)
  const label = escapeCapabilityArtXml(art.label ?? capabilityArtInitials(canonical))
  const title = escapeCapabilityArtXml(capabilityArtTitle(canonical))
  const px = CAPABILITY_ART_SIZE_PX[size]
  const color = escapeCapabilityArtXml(art.color)
  const accent = escapeCapabilityArtXml(art.accent)

  return `<svg class="capability-art-svg capability-art-svg--${size}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" width="${px}" height="${px}" role="img" aria-label="${title}"><title>${title}</title><rect x="3" y="3" width="90" height="90" rx="22" fill="${color}"/><path d="M7 10h82v19c-18 7-40 8-58 4C20 31 12 28 7 24Z" fill="rgba(255,255,255,.14)"/><circle cx="72" cy="21" r="18" fill="${accent}" opacity=".22"/><circle cx="48" cy="45" r="33" fill="rgba(29,32,33,.23)" stroke="rgba(255,255,255,.16)" stroke-width="2"/><g transform="translate(16 12)">${iconMarkup(art.icon, accent)}</g><rect x="25" y="74" width="46" height="14" rx="7" fill="rgba(29,32,33,.32)" stroke="rgba(255,255,255,.14)"/><text x="48" y="84.6" text-anchor="middle" fill="rgba(251,241,199,.96)" font-family="JetBrains Mono, Arial, sans-serif" font-size="9.5" font-weight="900" letter-spacing=".8">${label}</text></svg>`
}
