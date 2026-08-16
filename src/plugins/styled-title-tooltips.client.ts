import { createStyledTitleTooltipController, type StyledTitleTooltipController } from '~/utils/styledTitleTooltip'

const CONTROLLER_KEY = '__rotomStyledTitleTooltipController'

type WindowWithStyledTitleTooltip = Window & {
  [CONTROLLER_KEY]?: StyledTitleTooltipController
}

export default defineNuxtPlugin((nuxtApp) => {
  if (typeof window === 'undefined') return

  const windowWithController = window as WindowWithStyledTitleTooltip

  const start = () => {
    windowWithController[CONTROLLER_KEY]?.destroy()

    const controller = createStyledTitleTooltipController(document)
    windowWithController[CONTROLLER_KEY] = controller
    controller.start()
  }

  // Capturing titles mutates SSR-rendered attributes. Root suspense can resolve
  // before async page descendants finish hydrating, so wait for Nuxt's page
  // completion hook and then leave its hydration call stack before touching DOM.
  nuxtApp.hook('page:finish', () => {
    window.requestAnimationFrame(start)
  })
})
