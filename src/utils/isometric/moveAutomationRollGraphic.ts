export const ROLLING_D20_GRAPHIC_KEY = 'd20-wireframe'

export const ROLLING_D20_SVG_MARKUP = `
  <svg class="move-automation-roll__d20" viewBox="0 0 100 100" role="img" aria-label="Rolling d20" xmlns="http://www.w3.org/2000/svg">
    <path class="move-automation-roll__d20-fill" d="M50 6 10 31 10 73 50 94 90 73 90 31Z" />
    <g class="move-automation-roll__d20-lines" fill="none" stroke="currentColor" stroke-width="6.8" stroke-linecap="round" stroke-linejoin="round">
      <path d="M50 6 10 31 10 73 50 94 90 73 90 31 50 6Z" />
      <path d="M10 31 25 41 50 6 75 41 90 31" />
      <path d="M25 41 75 41" />
      <path d="M25 41 10 73 50 78 90 73 75 41" />
      <path d="M25 41 50 78 75 41" />
      <path d="M50 78 50 94" />
    </g>
  </svg>
`.trim()

export const renderRollingD20Graphic = (body: HTMLElement): boolean => {
  if (body.dataset.rollGraphic === ROLLING_D20_GRAPHIC_KEY) return false

  body.dataset.rollGraphic = ROLLING_D20_GRAPHIC_KEY
  body.setAttribute('aria-label', 'Rolling d20')
  body.setAttribute('role', 'img')
  body.innerHTML = ROLLING_D20_SVG_MARKUP
  return true
}
