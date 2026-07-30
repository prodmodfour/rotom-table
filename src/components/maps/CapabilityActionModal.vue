<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { CapabilityActionSelections } from '#shared/capabilityAutomation/clientCommands'
import { CANONICAL_PTU_BERRY_NAMES } from '#shared/capabilityAutomation/items'
import { trackerScentSelectionId, type TrackerScentBranch } from '#shared/capabilityAutomation/tracker'
import type { EncounterActionOffer } from '#shared/encounterPresentation/contracts'
import { abilities, items, moves } from '~~/data/ptuReference'
import pokedexJson from '~~/data/reference/pokedex.json'
import { PTU_NATURE_OPTIONS } from '~/utils/ptuNatures'
import type { PokedexRecord } from '~/types/pokemon'

interface Choice { readonly value: string; readonly label: string }
interface ParticipantChoice { readonly id: string; readonly label: string }
type ResourceKind = 'object' | 'device' | 'keystone' | 'egg' | 'trainer'

const props = defineProps<{
  offer: EncounterActionOffer
  actionId: string
  participants: readonly ParticipantChoice[]
  trainerSlugs: readonly string[]
  canConfirmAsGm: boolean
}>()
const emit = defineEmits<{
  submit: [selections: CapabilityActionSelections]
  cancel: []
}>()

const action = computed(() => props.actionId)
const targetingKinds = computed(() => new Set(props.offer.targeting.map(target => target.kind)))
const targetPlacementIds = ref<string[]>([])
const cellsText = ref('')
const optionId = ref('')
const recipientTrainerSlug = ref('')
const canonicalItemId = ref('')
const description = ref('')
const trackerPreyIdentity = ref('')
const dreamViewerIds = ref<string[]>([])
const gmConfirmed = ref(false)
const trickyDc = ref<number | null>(null)
const groundChoiceByCell = ref<Record<string, string>>({})
const auraHue = ref('blue')
const auraTone = ref<'brightened' | 'darkened' | 'neutral'>('neutral')
const illusionWidth = ref(500)
const illusionHeight = ref(500)
const illusionDepth = ref(500)
const illusionMotion = ref<'static' | 'minor' | 'major'>('static')
const shapeMassPercent = ref(100)
const shapeKind = ref<'organic' | 'simple-object' | 'machine-appearance'>('organic')
const alluringSpecies = ref('Pidgey')
const alluringLevel = ref(5)
const zygardeCells = ref<10 | 50 | 100>(10)
const zygardeForm = ref<'10-percent' | '50-percent'>('10-percent')
const zygardeNature = ref('Hardy')
const zygardeLevel = ref(20)
const sprouterBerry = ref('Oran Berry')
const sprouterQuantity = ref(1)
const letterStatChoices = ref<string[]>(['atk', '', '', ''])
const hiddenPowerChoices = ref<string[]>(['special', '', '', '', '', ''])
const selectedResourceIds = ref<string[]>([])
const validationError = ref('')

const canonicalAbilityChoices: readonly Choice[] = abilities.map(entry => ({ value: entry.name, label: entry.name }))
const canonicalMoveChoices: readonly Choice[] = moves.map(entry => ({ value: entry.name, label: entry.name }))
const canonicalBerryChoices: readonly Choice[] = CANONICAL_PTU_BERRY_NAMES.map(name => ({ value: name, label: name }))
const canonicalItemChoices: readonly Choice[] = [
  ...items.map(entry => ({ value: entry.name, label: entry.name })),
  ...canonicalBerryChoices,
].filter((choice, index, choices) => choices.findIndex(candidate => candidate.value === choice.value) === index)
const canonicalSpeciesChoices: readonly Choice[] = (pokedexJson as PokedexRecord[])
  .map(entry => ({ value: entry.species, label: entry.species }))
  .sort((left, right) => left.label.localeCompare(right.label))
const resourceChoices = (kind: ResourceKind): readonly Choice[] => (props.offer.selectionOptions ?? [])
  .filter(resource => resource.kind === kind)
  .map(resource => ({ value: resource.value, label: resource.label }))
const optionChoices = computed<readonly Choice[]>(() => {
  if (action.value === 'mega-evolve' || action.value === 'mount') return canonicalAbilityChoices
  if (action.value === 'bond') return canonicalMoveChoices
  if (action.value === 'plant' || action.value === 'harvest') return canonicalItemChoices
  if (action.value === 'enter-machine' || action.value === 'exit-machine') return resourceChoices('device')
  return []
})
const itemChoices = computed<readonly Choice[]>(() => {
  if (action.value === 'plant') return canonicalItemChoices
  if (action.value === 'tutor-cube-move') return canonicalMoveChoices
  if (action.value === 'warm-egg') return resourceChoices('egg')
  if (action.value === 'synchronize-keystone') return resourceChoices('keystone')
  if (action.value === 'threaded-shift' && optionId.value === 'object') return resourceChoices('object')
  return []
})

const typedOptionActions = new Set([
  'lure-with-alluring', 'read-aura', 'create-illusion', 'change-shape', 'assemble-zygarde',
  'combine-unown',
])

const branchChoices = computed<readonly Choice[]>(() => {
  if (action.value === 'threaded-shift') return [
    { value: 'anchor', label: 'Terrain anchor' },
    { value: 'object', label: 'Authoritative inanimate object' },
    { value: 'willing-target', label: 'Willing target' },
    { value: 'unwilling-target', label: 'Unwilling target (AC 6)' },
  ]
  if (action.value === 'jump') return [
    { value: 'normal', label: 'Normal Jump' },
    { value: 'running-start', label: 'Trainer Running Start' },
    { value: 'acrobatics-extension', label: 'Acrobatics DC 16 extension' },
    { value: 'running-start-and-extension', label: 'Running Start + DC 16 extension' },
  ]
  if (action.value === 'shape-ground') return [
    { value: 'rough', label: 'Rough Terrain' },
    { value: 'slow', label: 'Slow Terrain' },
    { value: 'rough-and-slow', label: 'Rough and Slow Terrain' },
    { value: 'basic', label: 'Basic Terrain' },
    { value: 'unchanged', label: 'Leave all selected cells unchanged' },
    { value: 'per-cell', label: 'Choose independently for each cell' },
  ]
  if (action.value === 'change-zygarde-form') return [
    { value: '10-percent', label: '10% Forme' },
    { value: '50-percent', label: '50% Forme' },
  ]
  if (action.value === 'telekinetic-maneuver') return [
    { value: 'disarm', label: 'Disarm' }, { value: 'trip', label: 'Trip' }, { value: 'push', label: 'Push' },
  ]
  if (action.value === 'resolve-fortune-roam') return [
    { value: 'returns', label: 'Low-Loyalty user returns' },
    { value: 'runs-away', label: 'Low-Loyalty user runs away' },
  ]
  if (action.value === 'read-dream') return [
    { value: 'private-view', label: 'Private dream reading' },
    { value: 'dream-mist-image', label: 'Project Dream Mist image to selected viewers' },
  ]
  if (action.value === 'sprout') return [
    { value: 'growth', label: 'Grow a nearby plant up to 1 meter' },
    { value: 'berry-yield', label: 'Instantly yield planted Berries' },
  ]
  if (action.value === 'read-mind') return [
    { value: 'unaware', label: 'Target unaware' }, { value: 'aware', label: 'Target aware' },
  ]
  if (action.value === 'track-scent') return [
    { value: 'familiar', label: 'Smelt in past day / belonging' },
    { value: 'random', label: 'Random scent from nothing' },
    { value: 'specific', label: 'Specific scent from nothing' },
  ]
  if (action.value === 'shelter-baby') return [
    { value: 'experience-share:0', label: 'Mother keeps all Experience' },
    { value: 'experience-share:20', label: 'Transfer 20% of mother’s Experience to baby' },
  ]
  if (action.value === 'communicate' && props.offer.source.canonicalId === 'Aura Pulse') return [
    { value: 'project-only', label: 'Project thoughts only' },
    { value: 'exchange-surface-thoughts', label: 'Willing surface-thought exchange' },
  ]
  return []
})

const actionsWithFreeOption = new Set([
  'lure-with-alluring', 'mega-evolve', 'enter-machine', 'exit-machine', 'assemble-zygarde',
  'sprout', 'plant', 'harvest', 'read-aura', 'mount', 'combine-unown', 'bond',
  'create-illusion', 'change-shape',
])
const actionsWithRecipient = new Set([
  'mega-evolve', 'assemble-zygarde', 'sprout', 'produce-dream-mist', 'produce-heart-scale',
  'produce-revival-herb', 'gather-honey', 'produce-moomoo-milk', 'harvest-mushroom',
  'resolve-fortune-roam', 'harvest', 'collect-juicer-output',
])
const actionsWithItem = new Set([
  'plant', 'tutor-cube-move', 'warm-egg', 'synchronize-keystone',
])
const actionsWithDescription = new Set([
  'communicate', 'project-thought', 'track-scent', 'create-illusion', 'change-shape',
  'read-aura', 'read-dream', 'read-mind', 'sprout', 'enter-machine', 'resolve-fortune-roam',
  'influence-nearby-wilds',
])

const showTargets = computed(() => targetingKinds.value.has('participant')
  && !(action.value === 'threaded-shift' && (optionId.value === 'anchor' || optionId.value === 'object')))
const showCells = computed(() => (targetingKinds.value.has('area') || targetingKinds.value.has('cell'))
  && !(action.value === 'threaded-shift' && optionId.value !== 'anchor' && optionId.value !== 'object'))
const showOption = computed(() => branchChoices.value.length > 0 || actionsWithFreeOption.has(action.value))
const showRecipient = computed(() => actionsWithRecipient.has(action.value))
const recipientChoices = computed<readonly Choice[]>(() => action.value === 'collect-juicer-output'
  ? resourceChoices('trainer')
  : props.trainerSlugs.map(slug => ({ value: slug, label: slug })))
const showItem = computed(() => actionsWithItem.has(action.value)
  || (action.value === 'threaded-shift' && optionId.value === 'object'))
const gmConfirmationActions = new Set([
  'lure-with-alluring', 'read-aura', 'read-dream', 'manipulate-metal', 'plant', 'harvest',
  'sprout', 'read-mind', 'bond', 'combine-unown', 'track-scent', 'influence-nearby-wilds', 'change-shape',
  'assemble-zygarde', 'resolve-fortune-roam', 'enter-machine', 'communicate', 'shelter-baby',
])
const showGmConfirmation = computed(() => props.canConfirmAsGm && gmConfirmationActions.has(action.value))
const showDescription = computed(() => actionsWithDescription.has(action.value) || (showGmConfirmation.value && gmConfirmed.value))

const optionLabel = computed(() => ({
  'lure-with-alluring': 'Successful lure result (species:<name>;level:<1-100>)',
  'mega-evolve': 'Mega Ability',
  'manipulate-object': 'Authoritative object IDs (comma separated)',
  'manipulate-metal': 'Authoritative object IDs (comma separated)',
  'enter-machine': 'Authoritative electronic device ID',
  'exit-machine': 'Connected destination device ID',
  'assemble-zygarde': 'Assembly (cells:10;form:10-percent;nature:Hardy;level:20)',
  sprout: 'Result (growth or berry-yield:item:<Berry>;qty:<1-20>)',
  plant: 'Canonical planted output/category',
  harvest: 'Canonical harvest output',
  'read-aura': 'Aura result (hue:<hue>;tone:brightened|darkened|neutral)',
  mount: 'Basic Ability gained from mount',
  'combine-unown': 'Choices (stats:atk;hidden-power:special)',
  bond: 'Bonded species signature Move',
  'create-illusion': 'Parameters (size-mm:500x500x500;motion:static)',
  'change-shape': 'Parameters (mass-percent:100;kind:organic)',
}[action.value] ?? 'Reviewed branch / option'))

const defaultOption = (): string => {
  const choices = branchChoices.value
  if (choices.length) return choices[0]!.value
  return {
    'lure-with-alluring': 'species:Pidgey;level:5',
    'mega-evolve': 'Run Away',
    'assemble-zygarde': 'cells:10;form:10-percent;nature:Hardy;level:20',
    sprout: 'growth',
    'read-aura': 'hue:blue;tone:neutral',
    'combine-unown': 'stats:atk;hidden-power:special',
    'create-illusion': 'size-mm:500x500x500;motion:static',
    'change-shape': 'mass-percent:100;kind:organic',
  }[action.value] ?? ''
}

watch(() => [props.offer.offerId, props.actionId] as const, () => {
  targetPlacementIds.value = []
  cellsText.value = ''
  optionId.value = defaultOption()
  recipientTrainerSlug.value = ''
  canonicalItemId.value = ''
  description.value = ''
  trackerPreyIdentity.value = ''
  dreamViewerIds.value = []
  gmConfirmed.value = false
  trickyDc.value = null
  groundChoiceByCell.value = {}
  auraHue.value = 'blue'
  auraTone.value = 'neutral'
  illusionWidth.value = 500
  illusionHeight.value = 500
  illusionDepth.value = 500
  illusionMotion.value = 'static'
  shapeMassPercent.value = 100
  shapeKind.value = 'organic'
  alluringSpecies.value = 'Pidgey'
  alluringLevel.value = 5
  zygardeCells.value = 10
  zygardeForm.value = '10-percent'
  zygardeNature.value = 'Hardy'
  zygardeLevel.value = 20
  sprouterBerry.value = 'Oran Berry'
  sprouterQuantity.value = 1
  letterStatChoices.value = ['atk', '', '', '']
  hiddenPowerChoices.value = ['special', '', '', '', '', '']
  selectedResourceIds.value = []
  validationError.value = ''
}, { immediate: true })

const cellKeys = computed(() => cellsText.value.split(';').map(value => value.trim()).filter(value => (
  /^-?\d+\s*,\s*-?\d+\s*,\s*-?\d+$/.test(value)
)).map(value => value.split(',').map(part => Number(part.trim())).join(',')))

watch(cellKeys, (keys) => {
  groundChoiceByCell.value = Object.fromEntries(keys.map(key => [key, groundChoiceByCell.value[key] ?? 'unchanged']))
})

const parseCells = (): readonly { x: number; y: number; z: number }[] | null => {
  const values = cellsText.value.split(';').map(value => value.trim()).filter(Boolean)
  const result: { x: number; y: number; z: number }[] = []
  for (const value of values) {
    const coordinates = value.split(',').map(part => Number(part.trim()))
    if (coordinates.length !== 3 || coordinates.some(coordinate => !Number.isSafeInteger(coordinate))) {
      validationError.value = `Invalid cell “${value}”. Use x,y,z; x,y,z.`
      return null
    }
    result.push({ x: coordinates[0]!, y: coordinates[1]!, z: coordinates[2]! })
  }
  return result
}

const submit = (): void => {
  validationError.value = ''
  const cells = parseCells()
  if (!cells) return
  const participantLimits = props.offer.targeting.filter(target => target.kind === 'participant')
  const minimumTargets = showTargets.value ? Math.max(0, ...participantLimits.map(target => target.minSelections)) : 0
  const maximumTargets = showTargets.value ? Math.max(0, ...participantLimits.map(target => target.maxSelections)) : 0
  if (showTargets.value && targetPlacementIds.value.length < minimumTargets) {
    validationError.value = 'Select at least one authoritative target.'
    return
  }
  if (showTargets.value && maximumTargets > 0 && targetPlacementIds.value.length > maximumTargets) {
    validationError.value = `Select no more than ${maximumTargets} authoritative target${maximumTargets === 1 ? '' : 's'}.`
    return
  }
  const cellLimits = props.offer.targeting.filter(target => target.kind === 'area' || target.kind === 'cell')
  const minimumCells = showCells.value ? Math.max(0, ...cellLimits.map(target => target.minSelections)) : 0
  const maximumCells = showCells.value ? Math.max(0, ...cellLimits.map(target => target.maxSelections)) : 0
  if (showCells.value && cells.length < minimumCells) {
    validationError.value = 'Enter at least one authoritative map cell.'
    return
  }
  if (showCells.value && maximumCells > 0 && cells.length > maximumCells) {
    validationError.value = `Enter no more than ${maximumCells} authoritative map cell${maximumCells === 1 ? '' : 's'}.`
    return
  }
  if (showOption.value && !optionId.value.trim()) {
    validationError.value = 'Select or enter the reviewed Capability branch.'
    return
  }
  if (optionChoices.value.length > 0 && !optionChoices.value.some(choice => choice.value === optionId.value)) {
    validationError.value = 'Select an authoritative reviewed option.'
    return
  }
  if (action.value === 'collect-juicer-output' && !recipientTrainerSlug.value.trim()) {
    validationError.value = 'Select the explicitly linked Trainer inventory that will receive the shell item.'
    return
  }
  if (showItem.value && (!canonicalItemId.value.trim()
    || !itemChoices.value.some(choice => choice.value === canonicalItemId.value))) {
    validationError.value = 'Select the authoritative item or resource identity.'
    return
  }
  if ((action.value === 'manipulate-object' || action.value === 'manipulate-metal' || action.value === 'lift-load')
    && (selectedResourceIds.value.length < 1 || selectedResourceIds.value.length > 16)) {
    validationError.value = 'Select 1–16 authoritative world objects.'
    return
  }
  if ((action.value === 'communicate' || action.value === 'project-thought') && !description.value.trim()) {
    validationError.value = 'Enter the bounded private message payload.'
    return
  }
  if (action.value === 'track-scent' && gmConfirmed.value
    && (!trackerPreyIdentity.value.trim()
      || trackerScentSelectionId(optionId.value as TrackerScentBranch, trackerPreyIdentity.value.trim()) === null)) {
    validationError.value = 'Bind the check to one bounded exact authoritative prey identity.'
    return
  }
  let retainedOption = optionId.value.trim()
  if (action.value === 'lure-with-alluring') retainedOption = `species:${alluringSpecies.value.trim()};level:${alluringLevel.value}`
  if (action.value === 'read-aura') retainedOption = `hue:${auraHue.value.trim()};tone:${auraTone.value}`
  if (action.value === 'create-illusion') {
    retainedOption = `size-mm:${illusionWidth.value}x${illusionHeight.value}x${illusionDepth.value};motion:${illusionMotion.value}`
  }
  if (action.value === 'change-shape') retainedOption = `mass-percent:${shapeMassPercent.value};kind:${shapeKind.value}`
  if (action.value === 'track-scent' && trackerPreyIdentity.value.trim()) {
    retainedOption = trackerScentSelectionId(
      optionId.value as TrackerScentBranch,
      trackerPreyIdentity.value.trim(),
    ) ?? ''
  }
  if (action.value === 'assemble-zygarde') {
    retainedOption = `cells:${zygardeCells.value};form:${zygardeForm.value};nature:${zygardeNature.value.trim()};level:${zygardeLevel.value}`
  }
  if (action.value === 'sprout') retainedOption = optionId.value === 'growth'
    ? 'growth' : `berry-yield:item:${sprouterBerry.value.trim()};qty:${sprouterQuantity.value}`
  if (action.value === 'combine-unown') {
    const stats = letterStatChoices.value.filter(Boolean)
    const hidden = hiddenPowerChoices.value.filter(Boolean)
    retainedOption = `stats:${stats.length ? stats.join(',') : 'none'};hidden-power:${hidden.length ? hidden.join(',') : 'none'}`
  }
  if (action.value === 'read-dream' && retainedOption === 'dream-mist-image') {
    if (!dreamViewerIds.value.length || dreamViewerIds.value.length > 16
      || new Set(dreamViewerIds.value).size !== dreamViewerIds.value.length) {
      validationError.value = 'Select 1–16 unique authoritative Dream Mist viewers.'
      return
    }
    retainedOption = `dream-mist-image:viewers:${dreamViewerIds.value.join(',')}`
  }
  if (action.value === 'shape-ground' && retainedOption === 'per-cell') {
    retainedOption = `per-cell:${cells.map(cell => {
      const key = `${cell.x},${cell.y},${cell.z}`
      return `${key}=${groundChoiceByCell.value[key] ?? 'unchanged'}`
    }).join(';')}`
  }
  if (action.value === 'manipulate-object' || action.value === 'manipulate-metal' || action.value === 'lift-load') {
    retainedOption = `objects:${selectedResourceIds.value.join(',')}`
  }
  if (action.value === 'jump' && trickyDc.value !== null) retainedOption += `;tricky-dc:${trickyDc.value}`
  if (action.value === 'lure-with-alluring'
    && (!alluringSpecies.value.trim() || alluringLevel.value < 1 || alluringLevel.value > 100)) {
    validationError.value = 'Enter a canonical species and Level 1–100.'
    return
  }
  if (action.value === 'read-aura' && !auraHue.value.trim()) {
    validationError.value = 'Enter the retained Aura hue.'
    return
  }
  if (action.value === 'create-illusion'
    && [illusionWidth.value, illusionHeight.value, illusionDepth.value].some(value => value < 1 || value > 500)) {
    validationError.value = 'Each Illusion dimension must be 1–500 mm.'
    return
  }
  if (action.value === 'change-shape' && (shapeMassPercent.value < 50 || shapeMassPercent.value > 150)) {
    validationError.value = 'Shapechanged mass must remain from 50% through 150%.'
    return
  }
  if (action.value === 'sprout' && optionId.value === 'berry-yield'
    && (!sprouterBerry.value.trim() || sprouterQuantity.value < 1 || sprouterQuantity.value > 20)) {
    validationError.value = 'Enter a canonical Berry and quantity 1–20.'
    return
  }
  if (action.value === 'assemble-zygarde'
    && (!zygardeNature.value.trim() || zygardeLevel.value < 1 || zygardeLevel.value > 100
      || (zygardeCells.value === 10 && zygardeForm.value !== '10-percent'))) {
    validationError.value = 'Enter a legal Cell count, Forme, Nature, and Level 1–100.'
    return
  }
  emit('submit', {
    targetPlacementIds: [...targetPlacementIds.value],
    cells,
    optionId: retainedOption || null,
    recipientTrainerSlug: recipientTrainerSlug.value.trim() || null,
    canonicalItemId: canonicalItemId.value.trim() || null,
    description: description.value.trim() || null,
    gmConfirmed: props.canConfirmAsGm && gmConfirmed.value,
  })
}
</script>

<template>
  <div class="capability-modal-backdrop" role="presentation" @click.self="emit('cancel')">
    <section class="capability-modal" role="dialog" aria-modal="true" :aria-labelledby="`capability-title-${offer.offerId}`">
      <header>
        <div>
          <p class="capability-modal__eyebrow">{{ offer.source.displayName }}</p>
          <h2 :id="`capability-title-${offer.offerId}`">{{ offer.presentation.label }}</h2>
        </div>
        <button type="button" class="capability-modal__close" aria-label="Cancel Capability action" @click="emit('cancel')">×</button>
      </header>

      <form @submit.prevent="submit">
        <fieldset v-if="showTargets" class="capability-modal__group">
          <legend>Authoritative target</legend>
          <label v-for="participant in participants" :key="participant.id" class="capability-modal__check">
            <input v-model="targetPlacementIds" type="checkbox" :value="participant.id">
            <span>{{ participant.label }} <small>{{ participant.id }}</small></span>
          </label>
        </fieldset>

        <label v-if="showCells" class="capability-modal__field">
          <span>Map cell{{ offer.targeting.some(target => target.maxSelections > 1) ? 's' : '' }}</span>
          <input v-model="cellsText" inputmode="numeric" placeholder="x,y,z; x,y,z" autocomplete="off">
        </label>

        <label v-if="showOption && branchChoices.length" class="capability-modal__field">
          <span>Reviewed branch</span>
          <select v-model="optionId">
            <option v-for="choice in branchChoices" :key="choice.value" :value="choice.value">{{ choice.label }}</option>
          </select>
        </label>
        <fieldset v-if="actionId === 'shape-ground' && optionId === 'per-cell'" class="capability-modal__group">
          <legend>Per-cell terrain result</legend>
          <label v-for="cellKey in cellKeys" :key="cellKey" class="capability-modal__field">
            <span>{{ cellKey }}</span>
            <select v-model="groundChoiceByCell[cellKey]">
              <option value="rough">Rough Terrain</option>
              <option value="slow">Slow Terrain</option>
              <option value="rough-and-slow">Rough and Slow Terrain</option>
              <option value="basic">Basic Terrain</option>
              <option value="unchanged">Leave unchanged</option>
            </select>
          </label>
        </fieldset>
        <label v-else-if="showOption && optionChoices.length" class="capability-modal__field">
          <span>{{ optionLabel }}</span>
          <select v-model="optionId">
            <option value="" disabled>Select an authoritative option</option>
            <option v-for="choice in optionChoices" :key="choice.value" :value="choice.value">{{ choice.label }}</option>
          </select>
        </label>
        <label v-else-if="showOption && !branchChoices.length && !typedOptionActions.has(actionId)" class="capability-modal__field">
          <span>{{ optionLabel }}</span>
          <select v-model="optionId" disabled><option value="">No authoritative options available</option></select>
        </label>

        <fieldset v-if="actionId === 'manipulate-object' || actionId === 'manipulate-metal' || actionId === 'lift-load'" class="capability-modal__group">
          <legend>{{ actionId === 'lift-load' ? 'Adjacent objects and exact combined weight' : 'Authoritative world objects' }}</legend>
          <label v-for="resource in (offer.selectionOptions ?? []).filter(candidate => candidate.kind === 'object')" :key="resource.value" class="capability-modal__check">
            <input v-model="selectedResourceIds" type="checkbox" :value="resource.value">
            <span>{{ resource.label }}</span>
          </label>
        </fieldset>

        <fieldset v-if="actionId === 'lure-with-alluring'" class="capability-modal__group">
          <legend>GM-selected encounter</legend>
          <label class="capability-modal__field"><span>Canonical species</span><select v-model="alluringSpecies"><option v-for="choice in canonicalSpeciesChoices" :key="choice.value" :value="choice.value">{{ choice.label }}</option></select></label>
          <label class="capability-modal__field"><span>Level</span><input v-model.number="alluringLevel" type="number" min="1" max="100"></label>
        </fieldset>

        <fieldset v-if="actionId === 'read-aura'" class="capability-modal__group">
          <legend>Aura result</legend>
          <label class="capability-modal__field"><span>Hue</span><input v-model="auraHue" maxlength="40" autocomplete="off"></label>
          <label class="capability-modal__field"><span>Tone</span><select v-model="auraTone"><option value="brightened">Brightened</option><option value="darkened">Darkened</option><option value="neutral">Neutral</option></select></label>
        </fieldset>

        <fieldset v-if="actionId === 'create-illusion'" class="capability-modal__group">
          <legend>Illusion parameters</legend>
          <label class="capability-modal__field"><span>Width (mm)</span><input v-model.number="illusionWidth" type="number" min="1" max="500"></label>
          <label class="capability-modal__field"><span>Height (mm)</span><input v-model.number="illusionHeight" type="number" min="1" max="500"></label>
          <label class="capability-modal__field"><span>Depth (mm)</span><input v-model.number="illusionDepth" type="number" min="1" max="500"></label>
          <label class="capability-modal__field"><span>Motion</span><select v-model="illusionMotion"><option value="static">Static</option><option value="minor">Minor (reserves Swift Action)</option><option value="major">Major (reserves Standard Action)</option></select></label>
        </fieldset>

        <fieldset v-if="actionId === 'change-shape'" class="capability-modal__group">
          <legend>Shape parameters</legend>
          <label class="capability-modal__field"><span>Mass (% of normal)</span><input v-model.number="shapeMassPercent" type="number" min="50" max="150"></label>
          <label class="capability-modal__field"><span>Shape kind</span><select v-model="shapeKind"><option value="organic">Organic / moving form</option><option value="simple-object">Simple object</option><option value="machine-appearance">Simplified machine appearance</option></select></label>
        </fieldset>

        <fieldset v-if="actionId === 'combine-unown'" class="capability-modal__group">
          <legend>Permanent Letter Press choices</legend>
          <label v-for="(_, index) in letterStatChoices" :key="`letter-stat-${index}`" class="capability-modal__field">
            <span>Base Stat bonus {{ index + 1 }} (first four additions only)</span>
            <select v-model="letterStatChoices[index]"><option value="">No choice</option><option value="hp">HP</option><option value="atk">Attack</option><option value="def">Defense</option><option value="satk">Special Attack</option><option value="sdef">Special Defense</option><option value="spd">Speed</option></select>
          </label>
          <label v-for="(_, index) in hiddenPowerChoices" :key="`hidden-power-${index}`" class="capability-modal__field">
            <span>Hidden Power {{ index + 1 }} attack stat</span>
            <select v-model="hiddenPowerChoices[index]"><option value="">No retained instance</option><option value="attack">Attack</option><option value="special">Special Attack</option></select>
          </label>
        </fieldset>

        <fieldset v-if="actionId === 'sprout' && optionId === 'berry-yield'" class="capability-modal__group">
          <legend>Instant Berry yield</legend>
          <label class="capability-modal__field"><span>Canonical Berry item</span><select v-model="sprouterBerry"><option v-for="choice in canonicalBerryChoices" :key="choice.value" :value="choice.value">{{ choice.label }}</option></select></label>
          <label class="capability-modal__field"><span>Quantity</span><input v-model.number="sprouterQuantity" type="number" min="1" max="20"></label>
        </fieldset>

        <fieldset v-if="actionId === 'assemble-zygarde'" class="capability-modal__group">
          <legend>Zygarde assembly</legend>
          <label class="capability-modal__field"><span>Cells</span><select v-model.number="zygardeCells"><option :value="10">10</option><option :value="50">50</option><option :value="100">100</option></select></label>
          <label class="capability-modal__field"><span>Forme</span><select v-model="zygardeForm"><option value="10-percent">10% Forme</option><option value="50-percent">50% Forme</option></select></label>
          <label class="capability-modal__field"><span>Nature</span><select v-model="zygardeNature"><option v-for="nature in PTU_NATURE_OPTIONS" :key="nature" :value="nature">{{ nature }}</option></select></label>
          <label class="capability-modal__field"><span>Level</span><input v-model.number="zygardeLevel" type="number" min="1" max="100"></label>
        </fieldset>

        <fieldset v-if="actionId === 'read-dream' && optionId === 'dream-mist-image'" class="capability-modal__group">
          <legend>Authorized Dream Mist viewers</legend>
          <label v-for="participant in participants" :key="`dream-viewer-${participant.id}`" class="capability-modal__check">
            <input v-model="dreamViewerIds" type="checkbox" :value="participant.id">
            <span>{{ participant.label }} <small>{{ participant.id }}</small></span>
          </label>
        </fieldset>

        <label v-if="actionId === 'jump'" class="capability-modal__field">
          <span>GM-authored tricky Jump DC (optional)</span>
          <input v-model.number="trickyDc" type="number" min="1" max="40">
        </label>

        <label v-if="showRecipient" class="capability-modal__field">
          <span>Linked Trainer recipient / authority</span>
          <select v-model="recipientTrainerSlug">
            <option value="">{{ actionId === 'collect-juicer-output' ? 'Select an explicitly linked Trainer' : 'Server-selected linked Trainer' }}</option>
            <option v-for="choice in recipientChoices" :key="choice.value" :value="choice.value">{{ choice.label }}</option>
          </select>
        </label>

        <label v-if="showItem" class="capability-modal__field">
          <span>{{ actionId === 'warm-egg' ? 'Authoritative egg ID' : actionId === 'tutor-cube-move' ? 'Canonical Cube Move' : actionId === 'synchronize-keystone' ? 'Odd Keystone ID' : actionId === 'threaded-shift' ? 'Authoritative world object ID' : 'Canonical input item' }}</span>
          <select v-model="canonicalItemId">
            <option value="" disabled>Select an authoritative item or resource</option>
            <option v-for="choice in itemChoices" :key="choice.value" :value="choice.value">{{ choice.label }}</option>
          </select>
        </label>

        <label v-if="actionId === 'track-scent' && canConfirmAsGm" class="capability-modal__field">
          <span>Exact authoritative prey identity</span>
          <input v-model="trackerPreyIdentity" maxlength="160" placeholder="pokemon:species-or-campaign-id">
        </label>

        <label v-if="showDescription" class="capability-modal__field">
          <span>Bounded retained description / private result</span>
          <textarea v-model="description" maxlength="500" rows="3" />
        </label>

        <label v-if="showGmConfirmation" class="capability-modal__check capability-modal__gm">
          <input v-model="gmConfirmed" type="checkbox">
          <span>Resolve bounded GM adjudication now (otherwise create a durable pending request)</span>
        </label>

        <p v-if="validationError" class="capability-modal__error" role="alert">{{ validationError }}</p>
        <footer>
          <button type="button" @click="emit('cancel')">Cancel</button>
          <button type="submit" class="capability-modal__submit">Submit authoritative action</button>
        </footer>
      </form>
    </section>
  </div>
</template>

<style scoped>
.capability-modal-backdrop { position: fixed; inset: 0; z-index: 1200; display: grid; place-items: center; padding: 1rem; background: rgb(4 8 16 / 72%); backdrop-filter: blur(4px); }
.capability-modal { width: min(42rem, 100%); max-height: min(52rem, 92vh); overflow: auto; padding: 1rem; border: 1px solid rgb(125 211 252 / 45%); border-radius: .9rem; color: #e8f7ff; background: #101a27; box-shadow: 0 1.5rem 5rem rgb(0 0 0 / 55%); }
.capability-modal header, .capability-modal footer { display: flex; align-items: center; justify-content: space-between; gap: .75rem; }
.capability-modal h2 { margin: 0; font-size: 1.2rem; }
.capability-modal__eyebrow { margin: 0 0 .2rem; color: #7dd3fc; font-size: .72rem; letter-spacing: .1em; text-transform: uppercase; }
.capability-modal__close { border: 0; color: inherit; background: transparent; font-size: 1.6rem; cursor: pointer; }
.capability-modal form { display: grid; gap: .9rem; margin-top: 1rem; }
.capability-modal__group { display: grid; gap: .45rem; margin: 0; padding: .7rem; border: 1px solid rgb(148 163 184 / 25%); border-radius: .55rem; }
.capability-modal__field { display: grid; gap: .35rem; font-size: .82rem; }
.capability-modal input:not([type='checkbox']), .capability-modal select, .capability-modal textarea { width: 100%; padding: .55rem .65rem; border: 1px solid rgb(148 163 184 / 35%); border-radius: .45rem; color: inherit; background: #172334; }
.capability-modal__check { display: flex; align-items: flex-start; gap: .55rem; font-size: .82rem; }
.capability-modal__check small { color: #94a3b8; }
.capability-modal__gm { padding: .65rem; border-radius: .5rem; background: rgb(245 158 11 / 10%); }
.capability-modal__error { margin: 0; color: #fca5a5; font-size: .82rem; }
.capability-modal footer { justify-content: flex-end; padding-top: .25rem; }
.capability-modal footer button { padding: .55rem .8rem; border: 1px solid rgb(148 163 184 / 35%); border-radius: .45rem; color: inherit; background: #1e293b; cursor: pointer; }
.capability-modal footer .capability-modal__submit { border-color: #38bdf8; background: #0369a1; }
</style>
