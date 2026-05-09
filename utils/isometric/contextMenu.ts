import type { SpawnedPokemon } from '~/types/pokemon'

export interface TokenContextMenuCapabilities {
  canTurn: boolean
  canViewPokedex: boolean
}

export interface TokenContextMenuState extends TokenContextMenuCapabilities {
  id: string
  x: number
  y: number
}

export interface TokenContextMenuPositionOptions extends TokenContextMenuCapabilities {
  clientX: number
  clientY: number
  bounds: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>
  canDeleteTokens?: boolean
}

export const TOKEN_CONTEXT_MENU_WIDTH = 230
export const TOKEN_CONTEXT_MENU_PADDING = 12
export const TOKEN_CONTEXT_MENU_BASE_BUTTONS = 6
export const TOKEN_CONTEXT_MENU_BUTTON_HEIGHT = 40
export const TOKEN_CONTEXT_MENU_BUTTON_GAP = 5
export const TOKEN_CONTEXT_MENU_VERTICAL_CHROME = 13

export const getTokenContextMenuCapabilities = (pokemon: SpawnedPokemon): TokenContextMenuCapabilities => ({
  canTurn: Boolean(pokemon.entityKind === 'pokemon' && pokemon.backSpriteUrl),
  canViewPokedex: pokemon.sheetKind === 'pokemon',
})

export const getTokenContextMenuButtonCount = (options: TokenContextMenuCapabilities & {
  canDeleteTokens?: boolean
}): number =>
  TOKEN_CONTEXT_MENU_BASE_BUTTONS +
  (options.canViewPokedex ? 1 : 0) +
  (options.canTurn ? 1 : 0) +
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
  const maxX = options.bounds.width - TOKEN_CONTEXT_MENU_WIDTH - TOKEN_CONTEXT_MENU_PADDING
  const maxY = options.bounds.height - menuHeight - TOKEN_CONTEXT_MENU_PADDING

  return {
    x: clamp(options.clientX - options.bounds.left, TOKEN_CONTEXT_MENU_PADDING, maxX),
    y: clamp(options.clientY - options.bounds.top, TOKEN_CONTEXT_MENU_PADDING, maxY),
  }
}

export const createTokenContextMenuState = (options: {
  pokemon: SpawnedPokemon
  clientX: number
  clientY: number
  bounds: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>
  canDeleteTokens?: boolean
}): TokenContextMenuState => {
  const capabilities = getTokenContextMenuCapabilities(options.pokemon)
  return {
    id: options.pokemon.id,
    ...capabilities,
    ...getTokenContextMenuPosition({
      ...capabilities,
      clientX: options.clientX,
      clientY: options.clientY,
      bounds: options.bounds,
      canDeleteTokens: options.canDeleteTokens,
    }),
  }
}
