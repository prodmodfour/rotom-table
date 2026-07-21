import type {
  AbilitySpecJsonObject,
  AbilitySpecPhase,
} from '#shared/abilityAutomation/spec'

export const ABILITY_SPEC_EXTENSION_FAMILIES = [
  'selector',
  'predicate',
  'cost',
  'operation',
] as const

export type AbilitySpecExtensionFamily = (typeof ABILITY_SPEC_EXTENSION_FAMILIES)[number]

export interface AbilitySpecExtensionReference {
  readonly family: AbilitySpecExtensionFamily
  readonly kind: string
  readonly version: number
}

export interface AbilitySpecExtensionParseContext {
  readonly family: AbilitySpecExtensionFamily
  /** Present only for an operation authored in one AbilitySpec phase block. */
  readonly phase: AbilitySpecPhase | null
}

export interface RegisteredAbilitySpecExtension extends AbilitySpecExtensionReference {
  /** Pure strict parser supplied by reviewed server code, never by spec data. */
  readonly parse: (
    value: AbilitySpecJsonObject,
    path: string,
    context: AbilitySpecExtensionParseContext,
  ) => AbilitySpecJsonObject
}

export interface AbilitySpecExtensionRegistry {
  readonly resolve: (
    family: AbilitySpecExtensionFamily,
    kind: string,
  ) => RegisteredAbilitySpecExtension | null
  readonly references: () => readonly AbilitySpecExtensionReference[]
}

const STABLE_ID_PATTERN = /^[a-z0-9]+(?:[._:/-][a-z0-9]+)*$/

const keyFor = (family: AbilitySpecExtensionFamily, kind: string): string => `${family}:${kind}`

export const createAbilitySpecExtensionRegistry = (
  extensions: readonly RegisteredAbilitySpecExtension[],
): AbilitySpecExtensionRegistry => {
  const byKey = new Map<string, RegisteredAbilitySpecExtension>()
  for (const extension of extensions) {
    if (!(ABILITY_SPEC_EXTENSION_FAMILIES as readonly string[]).includes(extension.family)) {
      throw new Error(`Unknown AbilitySpec extension family ${String(extension.family)}.`)
    }
    if (!STABLE_ID_PATTERN.test(extension.kind)) {
      throw new Error(`AbilitySpec extension kind ${extension.kind} must be a stable identifier.`)
    }
    if (!Number.isSafeInteger(extension.version) || extension.version < 1) {
      throw new Error(`AbilitySpec extension ${extension.family}:${extension.kind} has an invalid version.`)
    }
    if (typeof extension.parse !== 'function') {
      throw new Error(`AbilitySpec extension ${extension.family}:${extension.kind} must provide a parser.`)
    }
    const key = keyFor(extension.family, extension.kind)
    if (byKey.has(key)) throw new Error(`Duplicate AbilitySpec extension ${key}.`)
    byKey.set(key, Object.freeze({ ...extension }))
  }
  const references = Object.freeze(
    [...byKey.values()]
      .map(({ family, kind, version }) => Object.freeze({ family, kind, version }))
      .sort((left, right) => (
        left.family === right.family
          ? left.kind < right.kind ? -1 : left.kind > right.kind ? 1 : 0
          : left.family < right.family ? -1 : 1
      )),
  )
  return Object.freeze({
    resolve: (family: AbilitySpecExtensionFamily, kind: string) => (
      byKey.get(keyFor(family, kind)) ?? null
    ),
    references: () => references,
  })
}

export const EMPTY_ABILITY_SPEC_EXTENSION_REGISTRY = createAbilitySpecExtensionRegistry([])
