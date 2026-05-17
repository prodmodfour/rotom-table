import { capabilityIconMarkup } from '~/utils/capabilityArtIcons'
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
  amber: '#ffb84d',
  gold: '#ffe45e',
  orange: '#ff7a2f',
  red: '#ff1f2d',
  green: '#48b85a',
  brightGreen: '#64e676',
  aqua: '#4db89f',
  brightAqua: '#8eeedc',
  blue: '#5c8dff',
  brightBlue: '#8fb8ff',
  purple: '#b56cff',
  brightPurple: '#d88cff',
  brown: '#9a6b45',
  steel: '#66707a',
  slate: '#29303a',
  dark: '#12151b',
  black: '#050608',
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
  'Milk Collection': { color: COLORS.brightBlue, accent: '#f7f7f2', icon: 'milk-collection', label: 'MLK' },
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

  return `<svg class="capability-art-svg capability-art-svg--${size}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" width="${px}" height="${px}" role="img" aria-label="${title}"><title>${title}</title><rect x="3" y="3" width="90" height="90" rx="22" fill="${color}"/><path d="M7 10h82v19c-18 7-40 8-58 4C20 31 12 28 7 24Z" fill="rgba(255,255,255,.14)"/><circle cx="72" cy="21" r="18" fill="${accent}" opacity=".22"/><circle cx="48" cy="45" r="33" fill="rgba(5,6,8,.23)" stroke="rgba(255,255,255,.16)" stroke-width="2"/><g transform="translate(16 12)">${capabilityIconMarkup(art.icon, accent)}</g><rect x="25" y="74" width="46" height="14" rx="7" fill="rgba(5,6,8,.32)" stroke="rgba(255,255,255,.14)"/><text x="48" y="84.6" text-anchor="middle" fill="rgba(247,247,242,.96)" font-family="JetBrains Mono, Arial, sans-serif" font-size="9.5" font-weight="900" letter-spacing=".8">${label}</text></svg>`
}
