import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { onBeforeRouteUpdate } from 'vue-router'
import { isPokedexPath } from '~/utils/pokedex/routes'

export { isPokedexPath } from '~/utils/pokedex/routes'

export const usePokedexSidebarScroll = () => {
  const route = useRoute()
  const sidebarRef = ref<HTMLElement | null>(null)
  const entryListRef = ref<HTMLElement | null>(null)
  const sidebarScrollTop = useState('pokedex-sidebar-scroll-top', () => 0)
  const entryListScrollTop = useState('pokedex-entry-list-scroll-top', () => 0)

  const saveSidebarScroll = () => {
    if (sidebarRef.value) {
      sidebarScrollTop.value = sidebarRef.value.scrollTop
    }

    if (entryListRef.value) {
      entryListScrollTop.value = entryListRef.value.scrollTop
    }
  }

  const restoreSidebarScroll = async () => {
    if (!import.meta.client) return

    await nextTick()
    window.requestAnimationFrame(() => {
      if (sidebarRef.value) {
        sidebarRef.value.scrollTop = sidebarScrollTop.value
      }

      if (entryListRef.value) {
        entryListRef.value.scrollTop = entryListScrollTop.value
      }
    })
  }

  onMounted(restoreSidebarScroll)
  onBeforeUnmount(saveSidebarScroll)

  onBeforeRouteUpdate((to, from) => {
    if (isPokedexPath(to.path) && isPokedexPath(from.path)) {
      saveSidebarScroll()
    }
  })

  watch(() => route.fullPath, (to, from) => {
    if (typeof from === 'string' && isPokedexPath(to) && isPokedexPath(from)) {
      restoreSidebarScroll()
    }
  })

  return {
    entryListRef,
    restoreSidebarScroll,
    saveSidebarScroll,
    sidebarRef,
  }
}
