/**
 * Human-reviewed canonical PTU Berry identities. The app-owned item reference
 * does not contain the Natural Gift Berry table, so Capability item choices
 * use this bounded catalog instead of accepting arbitrary strings ending in
 * “Berry”. Keep this list aligned with moveAutomation/itemRuleData.ts.
 */
export const CANONICAL_PTU_BERRY_NAMES = Object.freeze([
  'Cheri Berry', 'Chesto Berry', 'Pecha Berry', 'Rawst Berry', 'Aspear Berry',
  'Leppa Berry', 'Oran Berry', 'Persim Berry', 'Lum Berry', 'Sitrus Berry',
  'Figy Berry', 'Wiki Berry', 'Mago Berry', 'Aguav Berry', 'Iapapa Berry',
  'Razz Berry', 'Bluk Berry', 'Nanab Berry', 'Wepear Berry', 'Pinap Berry',
  'Pomeg Berry', 'Kelpsy Berry', 'Qualot Berry', 'Hondew Berry', 'Grepa Berry',
  'Tamato Berry', 'Cornn Berry', 'Magost Berry', 'Rabuta Berry', 'Nomel Berry',
  'Spelon Berry', 'Pamtre Berry', 'Watmel Berry', 'Durin Berry', 'Belue Berry',
  'Occa Berry', 'Passho Berry', 'Wacan Berry', 'Rindo Berry', 'Yache Berry',
  'Chople Berry', 'Kebia Berry', 'Shuca Berry', 'Coba Berry', 'Payapa Berry',
  'Tanga Berry', 'Charti Berry', 'Kasib Berry', 'Haban Berry', 'Colbur Berry',
  'Babiri Berry', 'Chilan Berry', 'Liechi Berry', 'Ganlon Berry', 'Salac Berry',
  'Petaya Berry', 'Apicot Berry', 'Lansat Berry', 'Starf Berry', 'Enigma Berry',
  'Micle Berry', 'Custap Berry', 'Jaboca Berry', 'Rowap Berry', 'Roseli Berry',
  'Maranga Berry', 'Kee Berry',
] as const)

const canonicalItemId = (name: string): string => name.normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLocaleLowerCase('en-US')
  .replace(/[’']/g, '')
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')

const canonicalBerryByNormalizedName = new Map(CANONICAL_PTU_BERRY_NAMES.map(name => [
  name.toLocaleLowerCase('en-US'),
  name,
]))
const canonicalBerryNameById = new Map(CANONICAL_PTU_BERRY_NAMES.map(name => [
  canonicalItemId(name),
  name,
]))

/** Resolve a Berry to its exact reviewed display identity. */
export const canonicalPtuBerryName = (value: string): string | null => (
  canonicalBerryByNormalizedName.get(value.trim().toLocaleLowerCase('en-US')) ?? null
)

/** Resolve a Berry name or compatibility ID to its stable item-catalog ID. */
export const canonicalPtuBerryId = (value: string): string | null => {
  const normalized = value.trim().toLocaleLowerCase('en-US')
  const name = canonicalBerryByNormalizedName.get(normalized) ?? canonicalBerryNameById.get(normalized)
  return name ? canonicalItemId(name) : null
}

/** Resolve a stable Berry item-catalog ID to its exact display identity. */
export const canonicalPtuBerryNameFromId = (canonicalId: string): string | null => (
  canonicalBerryNameById.get(canonicalId.trim().toLocaleLowerCase('en-US')) ?? null
)

export const SHUCKLES_BERRY_JUICE_ITEM_ID = 'shuckles-berry-juice' as const
export const SHUCKLES_BERRY_JUICE_ITEM_NAME = 'Shuckle’s Berry Juice' as const
export const RARE_CANDY_ITEM_ID = 'rare-candy' as const
export const RARE_CANDY_ITEM_NAME = 'Rare Candy' as const

/** Exact display identity for a legal converted Juicer shell item. */
export const juicerShellItemName = (canonicalId: string): string | null => {
  if (canonicalId === SHUCKLES_BERRY_JUICE_ITEM_ID) return SHUCKLES_BERRY_JUICE_ITEM_NAME
  if (canonicalId === RARE_CANDY_ITEM_ID) return RARE_CANDY_ITEM_NAME
  return null
}
