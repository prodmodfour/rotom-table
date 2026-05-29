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

  nuxtApp.hook('app:mounted', () => {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', start, { once: true })
    } else {
      start()
    }
  })
})
