import type { SheetKind } from '../sheets'

export const ITEM_INVENTORY_SECTIONS = [
  'keyItems', 'pokemonItems', 'medicalKit', 'pokeBalls', 'foodStuff', 'equipment',
] as const
export type ItemInventorySection = typeof ITEM_INVENTORY_SECTIONS[number]

export const ITEM_SOURCE_CONTAINER_KINDS = ['trainer', 'group'] as const
export type ItemSourceContainerKind = typeof ITEM_SOURCE_CONTAINER_KINDS[number]

export interface ItemInventoryInstanceRef {
  readonly containerKind: ItemSourceContainerKind
  readonly containerSlug: string
  readonly section: ItemInventorySection
  readonly rowId: string
}

export interface AuthoritativeItemInventoryInstance extends ItemInventoryInstanceRef {
  readonly instanceId: string
  readonly canonicalItemId: string
  readonly displayLabel: string
  readonly quantity: number
  readonly revision: number
  readonly ownerSheet: { readonly kind: SheetKind, readonly slug: string } | null
}

const COMPONENT_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,199}$/
const ENCODED_COMPONENT_PATTERN = /^[a-zA-Z0-9._~%-]{1,600}$/
const CONTAINER_KIND_SET = new Set<string>(ITEM_SOURCE_CONTAINER_KINDS)
const SECTION_SET = new Set<string>(ITEM_INVENTORY_SECTIONS)

const assertComponent = (value: string, label: string): string => {
  if (!COMPONENT_PATTERN.test(value)) throw new Error(`${label} must be a bounded stable identifier.`)
  return value
}

export const itemInventoryInstanceId = (ref: ItemInventoryInstanceRef): string => {
  const kind = CONTAINER_KIND_SET.has(ref.containerKind) ? ref.containerKind : (() => { throw new Error('Item source container kind is invalid.') })()
  const section = SECTION_SET.has(ref.section) ? ref.section : (() => { throw new Error('Item inventory section is invalid.') })()
  return [
    'item-instance',
    kind,
    encodeURIComponent(assertComponent(ref.containerSlug, 'Item source container slug')),
    section,
    encodeURIComponent(assertComponent(ref.rowId, 'Item inventory row ID')),
  ].join(':')
}

export const parseItemInventoryInstanceId = (value: unknown): ItemInventoryInstanceRef | null => {
  if (typeof value !== 'string' || value.length > 1_024) return null
  const [prefix, containerKind, encodedSlug, section, encodedRowId, ...rest] = value.split(':')
  if (prefix !== 'item-instance' || rest.length > 0
    || !CONTAINER_KIND_SET.has(containerKind ?? '')
    || !SECTION_SET.has(section ?? '')
    || !ENCODED_COMPONENT_PATTERN.test(encodedSlug ?? '')
    || !ENCODED_COMPONENT_PATTERN.test(encodedRowId ?? '')) return null
  try {
    const containerSlug = decodeURIComponent(encodedSlug!)
    const rowId = decodeURIComponent(encodedRowId!)
    assertComponent(containerSlug, 'Item source container slug')
    assertComponent(rowId, 'Item inventory row ID')
    return {
      containerKind: containerKind as ItemSourceContainerKind,
      containerSlug,
      section: section as ItemInventorySection,
      rowId,
    }
  }
  catch {
    return null
  }
}
