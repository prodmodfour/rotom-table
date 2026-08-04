import { readdirSync, readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  ENCOUNTER_CONTEXTS,
  ENCOUNTER_DENSITIES,
  ENCOUNTER_VISUAL_STATES,
  assertEncounterDesignTokens,
  encounterDesignTokens,
} from '../shared/encounterWorkspace/designTokens'

const ROOT = resolve(import.meta.dirname, '..')
const read = (path: string): string => readFileSync(resolve(ROOT, path), 'utf8')
const failures: string[] = []
const requireCondition = (condition: boolean, message: string): void => {
  if (!condition) failures.push(message)
}

try {
  assertEncounterDesignTokens()
}
catch (error) {
  failures.push(error instanceof Error ? error.message : String(error))
}

const css = read('src/assets/css/encounter-design-system.css')
const config = read('nuxt.config.ts')
const gallery = read('src/pages/design-system/encounter.vue')

requireCondition(config.includes("'~/assets/css/encounter-design-system.css'"), 'Nuxt must load the encounter design-system stylesheet.')
requireCondition(gallery.includes('data-rt-design-system="1"'), 'The encounter design-system gallery must bind token version 1.')
requireCondition(gallery.includes('Accessibility annotations'), 'The gallery must retain accessibility annotations.')

for (const context of ENCOUNTER_CONTEXTS) {
  requireCondition(css.includes(`[data-rt-context='${context}']`), `Missing context theme ${context}.`)
  requireCondition(gallery.includes('v-for="context in contexts"'), 'The gallery must render every context.')
}
for (const density of ENCOUNTER_DENSITIES) {
  requireCondition(css.includes(`[data-rt-density='${density}']`), `Missing density ${density}.`)
}
for (const state of ENCOUNTER_VISUAL_STATES.filter(state => !['idle', 'hover', 'focused'].includes(state))) {
  requireCondition(css.includes(`[data-rt-state='${state}']`), `Missing visual state ${state}.`)
}
requireCondition(css.includes('.rt-control:hover'), 'Missing hover state.')
requireCondition(css.includes(':focus-visible'), 'Missing keyboard focus state.')
requireCondition(css.includes('@media (prefers-reduced-motion: reduce)'), 'Missing reduced-motion contract.')
requireCondition(css.includes('@media (forced-colors: active)'), 'Missing forced-colours contract.')
requireCondition(!/animation(?:-[a-z-]+)?:[^;]*\binfinite\b/i.test(css), 'Encounter design motion cannot loop infinitely.')

const backdropOccurrences = [...css.matchAll(/backdrop-filter\s*:/g)].length
requireCondition(backdropOccurrences === 1, 'Backdrop blur must exist exactly once, on the world-overlay primitive.')
requireCondition(/\.rt-world-overlay\s*\{[^}]*backdrop-filter\s*:/s.test(css), 'Backdrop blur is allowed only on .rt-world-overlay.')

const requiredComponents = [
  'EncounterSurface.vue',
  'EncounterParticipantCard.vue',
  'EncounterActionCard.vue',
  'EncounterDecisionCard.vue',
  'EncounterStatusChip.vue',
  'EncounterUtilityControl.vue',
  'EncounterInspectorPanel.vue',
  'EncounterMotionCue.vue',
]
const componentDirectory = resolve(ROOT, 'src/components/encounter')
const componentFiles = readdirSync(componentDirectory)
for (const component of requiredComponents) {
  requireCondition(componentFiles.includes(component), `Missing encounter primitive ${component}.`)
}

for (const component of componentFiles.filter(file => file.endsWith('.vue'))) {
  const path = resolve(componentDirectory, component)
  if (!statSync(path).isFile()) continue
  const source = readFileSync(path, 'utf8')
  const styles = [...source.matchAll(/<style(?:\s[^>]*)?>([\s\S]*?)<\/style>/g)].map(match => match[1] ?? '').join('\n')
  requireCondition(!/#[0-9a-f]{3,8}\b/i.test(styles), `${component} contains an arbitrary local hex colour.`)
  requireCondition(!/\b(?:rgb|hsl)a?\s*\(/i.test(styles), `${component} contains an arbitrary local RGB/HSL colour.`)
  requireCondition(!/backdrop-filter\s*:/i.test(styles), `${component} creates local glass instead of the world-overlay primitive.`)
  requireCondition(!/animation(?:-[a-z-]+)?:[^;]*\binfinite\b/i.test(styles), `${component} contains continuous decorative motion.`)
}

const tokenRoles = ['brand', 'focus', 'pending', 'success', 'danger', 'info'] as const
for (const theme of Object.values(encounterDesignTokens.themes)) {
  const values = tokenRoles.map(role => theme.colors[role].toLocaleLowerCase())
  requireCondition(new Set(values).size === values.length, `${theme.colorScheme} semantic colour roles must be distinct.`)
}

if (process.argv.includes('--check-plan')) {
  const plan = read('implementation-plans/done/ENCOUNTER_UI_UX_PLAN.md')
  for (let ticket = 10; ticket <= 19; ticket += 1) {
    const id = `EUX-${String(ticket).padStart(3, '0')}`
    const ticketLine = plan.split('\n').find(line => line.includes(`**${id} `)) ?? ''
    requireCondition(
      ticketLine.startsWith('- [x] ') && ticketLine.endsWith('`DONE`'),
      `${id} is not marked DONE.`,
    )
  }
}

if (failures.length > 0) {
  console.error(`Encounter design-system check failed (${failures.length}):`)
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log(`Encounter design-system check passed: ${requiredComponents.length} primitives, ${ENCOUNTER_CONTEXTS.length} contexts, ${ENCOUNTER_VISUAL_STATES.length} states.`)
