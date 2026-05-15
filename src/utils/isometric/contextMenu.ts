import type { SpawnedPokemon } from '~/types/pokemon'

export interface TokenContextMenuCapabilities {
  canTurn: boolean
  canViewPokedex: boolean
}

export interface TokenContextMenuState extends TokenContextMenuCapabilities {
  id: string
  x: number
  y: number
  canSendOut?: boolean
}

export interface TokenContextMenuBounds {
  left: number
  top: number
  width: number
  height: number
}

export interface TokenContextMenuPositionOptions extends TokenContextMenuCapabilities {
  clientX: number
  clientY: number
  bounds: TokenContextMenuBounds
  canDeleteTokens?: boolean
  canSendOut?: boolean
}

export const TOKEN_CONTEXT_MENU_WIDTH = 230
export const TOKEN_CONTEXT_MENU_PADDING = 12
export const TOKEN_CONTEXT_MENU_BASE_BUTTONS = 7
export const TOKEN_CONTEXT_MENU_BUTTON_HEIGHT = 40
export const TOKEN_CONTEXT_MENU_BUTTON_GAP = 5
export const TOKEN_CONTEXT_MENU_VERTICAL_CHROME = 13

export const getTokenContextMenuViewportBounds = (): TokenContextMenuBounds | null => {
  if (typeof window === 'undefined') return null

  return {
    left: 0,
    top: 0,
    width: window.innerWidth,
    height: window.innerHeight,
  }
}

export const getTokenContextMenuCapabilities = (pokemon: SpawnedPokemon): TokenContextMenuCapabilities => ({
  canTurn: Boolean(pokemon.entityKind === 'pokemon' && pokemon.backSpriteUrl),
  canViewPokedex: pokemon.sheetKind === 'pokemon',
})

export const getTokenContextMenuButtonCount = (options: TokenContextMenuCapabilities & {
  canDeleteTokens?: boolean
  canSendOut?: boolean
}): number =>
  TOKEN_CONTEXT_MENU_BASE_BUTTONS +
  (options.canViewPokedex ? 1 : 0) +
  (options.canTurn ? 1 : 0) +
  (options.canSendOut ? 1 : 0) +
  (options.canDeleteTokens ? 1 : 0)

export const getTokenContextMenuHeight = (buttonCount: number): number =>
  TOKEN_CONTEXT_MENU_VERTICAL_CHROME +
  buttonCount * TOKEN_CONTEXT_MENU_BUTTON_HEIGHT +
  Math.max(0, buttonCount - 1) * TOKEN_CONTEXT_MENU_BUTTON_GAP

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value))

export const getTokenContextMenuPosition = (options: TokenContextMenuPositionOptions) => {
  const buttonCount = getTokenContextMenuButtonCount(options)
  const menuHeight = getTokenContextMenuHeight(buttonCount)
  const minX = options.bounds.left + TOKEN_CONTEXT_MENU_PADDING
  const minY = options.bounds.top + TOKEN_CONTEXT_MENU_PADDING
  const maxX = Math.max(
    minX,
    options.bounds.left + options.bounds.width - TOKEN_CONTEXT_MENU_WIDTH - TOKEN_CONTEXT_MENU_PADDING,
  )
  const maxY = Math.max(
    minY,
    options.bounds.top + options.bounds.height - menuHeight - TOKEN_CONTEXT_MENU_PADDING,
  )

  return {
    x: clamp(options.clientX, minX, maxX),
    y: clamp(options.clientY, minY, maxY),
  }
}

export const createTokenContextMenuState = (options: {
  pokemon: SpawnedPokemon
  clientX: number
  clientY: number
  bounds: TokenContextMenuBounds
  canDeleteTokens?: boolean
  canSendOut?: boolean
}): TokenContextMenuState => {
  const capabilities = getTokenContextMenuCapabilities(options.pokemon)
  return {
    id: options.pokemon.id,
    ...capabilities,
    ...(options.canSendOut ? { canSendOut: true } : {}),
    ...getTokenContextMenuPosition({
      ...capabilities,
      clientX: options.clientX,
      clientY: options.clientY,
      bounds: options.bounds,
      canDeleteTokens: options.canDeleteTokens,
      canSendOut: options.canSendOut,
    }),
  }
}
