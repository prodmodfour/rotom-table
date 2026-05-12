import { computed, ref, toValue, type MaybeRefOrGetter, type Ref } from 'vue'
import type { FolderMoveDestination } from '~/utils/folderBrowser'

export type LibraryContextMode = 'menu' | 'rename' | 'move' | 'delete'

export interface LibraryContextState<TTarget> {
  x: number
  y: number
  target: TTarget
  mode: LibraryContextMode
  input: string
  busy: boolean
  error: string | null
}

export interface UseLibraryContextMenuOptions<TTarget> {
  canOpen: MaybeRefOrGetter<boolean>
  targetLabel: (target: TTarget) => string
  renameInputForTarget: (target: TTarget) => string
  moveDestinationsForTarget: (target: TTarget) => FolderMoveDestination[]
}

/**
 * Shared state machine for the maps/sheets library right-click menus.
 *
 * The target shape and persistence actions stay owned by each library page;
 * this composable only owns the generic mode/input/busy/error state and the
 * common transitions into Move, Rename, and Delete dialogs.
 */
export const useLibraryContextMenu = <TTarget>(options: UseLibraryContextMenuOptions<TTarget>) => {
  const ctx = ref<LibraryContextState<TTarget> | null>(null) as Ref<LibraryContextState<TTarget> | null>

  const openContext = (event: MouseEvent, target: TTarget): boolean => {
    if (!toValue(options.canOpen)) return false
    event.preventDefault()
    ctx.value = {
      x: event.clientX,
      y: event.clientY,
      target,
      mode: 'menu',
      input: '',
      busy: false,
      error: null,
    }
    return true
  }

  const closeContext = () => {
    ctx.value = null
  }

  const ctxTargetLabel = computed(() => {
    const state = ctx.value
    return state ? options.targetLabel(state.target) : ''
  })

  const ctxMoveDestinations = computed(() => {
    const state = ctx.value
    return state ? options.moveDestinationsForTarget(state.target) : []
  })

  const enterMove = () => {
    if (!ctx.value) return
    ctx.value.mode = 'move'
    ctx.value.error = null
    ctx.value.input = ctxMoveDestinations.value[0]?.value ?? ''
  }

  const enterRename = () => {
    if (!ctx.value) return
    ctx.value.mode = 'rename'
    ctx.value.error = null
    ctx.value.input = options.renameInputForTarget(ctx.value.target)
  }

  const enterDelete = () => {
    if (!ctx.value) return
    ctx.value.mode = 'delete'
    ctx.value.error = null
  }

  return {
    ctx,
    openContext,
    closeContext,
    ctxTargetLabel,
    ctxMoveDestinations,
    enterMove,
    enterRename,
    enterDelete,
  }
}
