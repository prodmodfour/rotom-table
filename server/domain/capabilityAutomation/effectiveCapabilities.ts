import { CAPABILITY_AUTOMATION_MANIFEST_BY_ID } from '#shared/capabilityAutomation/manifest'
import {
  parseCapabilityLabel,
  type CapabilityParameters,
  type ParsedCapabilityLabel,
} from '#shared/capabilityAutomation/catalog'
import type {
  CapabilityAcquisitionSource,
  EffectiveCapabilityInstance,
  EffectiveCapabilitySet,
  UnresolvedEffectiveCapabilityLabel,
} from '#shared/capabilityAutomation/effective'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import type { PokedexRecord } from '~/types/pokemon'
import type { TrainerSheet } from '~/types/trainerSheet'
import {
  hasPokemonCapabilityEdge,
  selectedPokemonCapabilityEdges,
} from '#shared/capabilityAutomation/pokemonEdges'
import {
  computeFullMaxHp,
  resolveCapabilities as resolvePokemonCapabilities,
  resolveStats,
} from '~/utils/sheets/pokemonDerived'
import { resolveMoveGrantedCapabilities } from '~/utils/sheets/pokemonMoveGrantedCapabilities'
import { resolveTrainerCapabilities } from '~/utils/sheets/trainerDerived'
import { effectiveRuntimeAbilityIds } from '../abilityAutomation/effectiveRuntimeAbilities'
import { authoritativeEquippedItemReferences } from '../moveAutomation/itemResources'
import { activeEncounterTransformation } from '#shared/moveAutomation/transformationEffects'
import {
  catalogEntryForPokemonSheet,
  catalogEntryForTrainerSheet,
} from '~/utils/sheetSpawn'
import pokedexData from '~~/data/reference/pokedex.json'

const pokedex = pokedexData as readonly PokedexRecord[]
const pokedexBySpecies = new Map(pokedex.map(record => [record.species.trim().toLocaleLowerCase('en-US'), record]))

const source = (
  kind: CapabilityAcquisitionSource['kind'],
  sourceId: string,
  precedence: number,
  label: string,
  value: number | null = null,
): CapabilityAcquisitionSource => Object.freeze({ kind, sourceId, precedence, label, value })

interface Candidate {
  readonly parsed: ParsedCapabilityLabel
  readonly value: number | null
  readonly source: CapabilityAcquisitionSource
}

const safePart = (value: string): string => encodeURIComponent(value.normalize('NFKC')).replace(/%/g, '_')
const parametersKey = (parameters: CapabilityParameters): string => {
  if (parameters.kind === 'none') return 'base'
  if (parameters.kind === 'value') return `value-${parameters.value}`
  if (parameters.kind === 'jump') return `jump-${parameters.long}-${parameters.high}`
  if (parameters.kind === 'rider-capacity') return `riders-${parameters.riders}`
  if (parameters.kind === 'categories') return `categories-${parameters.categories.map(safePart).join('.')}`
  if (parameters.kind === 'qualifiers') return `qualifiers-${parameters.qualifiers.map(safePart).join('.')}`
  return `terrains-${parameters.terrains.map(safePart).join('.')}`
}

const numericLabel = (canonicalId: string, value: number): ParsedCapabilityLabel => ({
  canonicalId,
  parameters: { kind: 'value', value },
  normalizedLabel: `${canonicalId} ${value}`,
  matchedBy: 'parameterized',
})

const jumpLabel = (value: string): ParsedCapabilityLabel => parseCapabilityLabel(value)

const pokemonCandidates = (
  placement: SheetPlacement,
  sheet: CharacterSheet,
): readonly Candidate[] => {
  const species = pokedexBySpecies.get(sheet.species.trim().toLocaleLowerCase('en-US'))
  const speciesCaps = species?.capabilities ?? {}
  const sheetCaps = sheet.capabilities ?? {}
  const resolved = resolvePokemonCapabilities(sheet)
  const grants = resolveMoveGrantedCapabilities([...(sheet.movelist ?? []), ...(sheet.appliedMoves ?? [])])
  const advancedMobility = new Set(selectedPokemonCapabilityEdges(sheet, 'Advanced Mobility')
    .map(value => value.toLocaleLowerCase('en-US')))
  const capabilityTraining = new Set(selectedPokemonCapabilityEdges(sheet, 'Capability Training')
    .map(value => value.toLocaleLowerCase('en-US')))
  const candidates: Candidate[] = []
  const numericKeys: ReadonlyArray<{
    canonicalId: string
    sheetKey: 'overland' | 'sky' | 'swim' | 'levitate' | 'burrow' | 'power'
  }> = [
    { canonicalId: 'Overland', sheetKey: 'overland' },
    { canonicalId: 'Sky', sheetKey: 'sky' },
    { canonicalId: 'Swim', sheetKey: 'swim' },
    { canonicalId: 'Levitate', sheetKey: 'levitate' },
    { canonicalId: 'Burrow', sheetKey: 'burrow' },
    { canonicalId: 'Power', sheetKey: 'power' },
  ]
  const resolvedByLabel = new Map(resolved.rows.map(row => [row.label, row.value]))
  for (const descriptor of numericKeys) {
    const raw = resolvedByLabel.get(descriptor.canonicalId)
    if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) continue
    const authored = sheetCaps[descriptor.sheetKey]
    const speciesValue = speciesCaps[descriptor.sheetKey]
    const baseKind = authored !== undefined ? 'sheet-override' as const : 'species-default' as const
    const baseValue = authored ?? speciesValue ?? 0
    const baseSource = source(
      baseKind,
      baseKind === 'sheet-override'
        ? `sheet:pokemon:${sheet.slug}:capabilities.${descriptor.sheetKey}`
        : `species:${species?.species ?? sheet.species}:capabilities.${descriptor.sheetKey}`,
      baseKind === 'sheet-override' ? 200 : 100,
      descriptor.canonicalId,
      Number.isFinite(baseValue) ? baseValue : 0,
    )
    candidates.push({ parsed: numericLabel(descriptor.canonicalId, raw), value: raw, source: baseSource })
    const bonus = grants.numberedBonuses[descriptor.sheetKey] ?? 0
    if (bonus > 0) candidates.push({
      parsed: numericLabel(descriptor.canonicalId, raw),
      value: raw,
      source: source('move-grant', `sheet:pokemon:${sheet.slug}:movelist:${descriptor.sheetKey}`, 300, descriptor.canonicalId, bonus),
    })
    const edgeBonus = advancedMobility.has(descriptor.canonicalId.toLocaleLowerCase('en-US')) ? 2
      : capabilityTraining.has(descriptor.canonicalId.toLocaleLowerCase('en-US'))
        && descriptor.canonicalId === 'Power' ? 1 : 0
    if (edgeBonus > 0) candidates.push({
      parsed: numericLabel(descriptor.canonicalId, raw + edgeBonus),
      value: raw + edgeBonus,
      source: source('edge-grant', `sheet:pokemon:${sheet.slug}:edge:${safePart(descriptor.canonicalId)}`, 350, `${edgeBonus === 2 ? 'Advanced Mobility' : 'Capability Training'} (${descriptor.canonicalId})`, edgeBonus),
    })
  }

  const rawJump = resolvedByLabel.get('Jump')
  if (typeof rawJump === 'string') {
    const parsed = jumpLabel(rawJump)
    if (parsed.canonicalId) {
      const baseKind = sheetCaps.jump !== undefined ? 'sheet-override' as const : 'species-default' as const
      candidates.push({
        parsed,
        value: null,
        source: source(
          baseKind,
          baseKind === 'sheet-override' ? `sheet:pokemon:${sheet.slug}:capabilities.jump` : `species:${species?.species ?? sheet.species}:capabilities.jump`,
          baseKind === 'sheet-override' ? 200 : 100,
          'Jump',
        ),
      })
      if (grants.jumpBonuses.long > 0 || grants.jumpBonuses.high > 0) candidates.push({
        parsed,
        value: null,
        source: source('move-grant', `sheet:pokemon:${sheet.slug}:movelist:jump`, 300, 'Jump'),
      })
      if (parsed.parameters.kind === 'jump') {
        const longBonus = ['long jump', 'long', 'jump (long)'].some(value => capabilityTraining.has(value)) ? 1 : 0
        const highBonus = ['high jump', 'high', 'jump (high)'].some(value => capabilityTraining.has(value)) ? 1 : 0
        if (longBonus || highBonus) candidates.push({
          parsed: jumpLabel(`${parsed.parameters.long + longBonus}/${parsed.parameters.high + highBonus}`),
          value: null,
          source: source('edge-grant', `sheet:pokemon:${sheet.slug}:edge:Capability_Training:${longBonus ? 'long' : 'high'}`, 350, `Capability Training (${longBonus ? 'Long Jump' : 'High Jump'})`, 1),
        })
      }
    }
  }

  if (resolved.naturewalk?.trim()) {
    const parsed = parseCapabilityLabel(`Naturewalk (${resolved.naturewalk})`)
    if (parsed.canonicalId) {
      const kind = sheetCaps.naturewalk !== undefined || (sheetCaps.other ?? []).some(label => /^\s*naturewalk\s*\(/i.test(label))
        ? 'sheet-override' as const : 'species-default' as const
      candidates.push({
        parsed,
        value: null,
        source: source(kind, kind === 'sheet-override'
          ? `sheet:pokemon:${sheet.slug}:capabilities.naturewalk`
          : `species:${species?.species ?? sheet.species}:capabilities.naturewalk`, kind === 'sheet-override' ? 200 : 100, 'Naturewalk'),
      })
    }
  }

  const speciesLabels = new Set((speciesCaps.other ?? []).map(label => label.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US')))
  const sheetLabels = new Set((sheetCaps.other ?? []).map(label => label.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US')))
  const moveLabels = new Set([
    ...grants.other,
    ...grants.valuedOtherBonuses.map(entry => `${entry.capability} ${entry.bonus}`),
  ].map(label => label.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US')))
  if (hasPokemonCapabilityEdge(sheet, 'Aura Pulse')) candidates.push({
    parsed: parseCapabilityLabel('Aura Pulse'),
    value: null,
    source: source('edge-grant', `sheet:pokemon:${sheet.slug}:edge:Aura_Pulse`, 350, 'Aura Pulse'),
  })
  for (const label of resolved.other) {
    const normalized = label.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US')
    const kind = moveLabels.has(normalized) ? 'move-grant' as const
      : sheetLabels.has(normalized) ? 'sheet-override' as const
        : 'species-default' as const
    const reviewedLabels = normalized === 'tracker underdog' ? ['Tracker', 'Underdog'] : [label]
    for (const reviewedLabel of reviewedLabels) {
      const parsed = parseCapabilityLabel(reviewedLabel)
      candidates.push({
        parsed,
        value: parsed.canonicalId && parsed.parameters.kind === 'value' ? parsed.parameters.value : null,
        source: source(
          kind,
          kind === 'move-grant' ? `sheet:pokemon:${sheet.slug}:movelist:other:${safePart(label)}:${safePart(reviewedLabel)}`
            : kind === 'sheet-override' ? `sheet:pokemon:${sheet.slug}:capabilities.other:${safePart(label)}:${safePart(reviewedLabel)}`
              : `species:${species?.species ?? sheet.species}:capabilities.other:${safePart(label)}:${safePart(reviewedLabel)}`,
          kind === 'move-grant' ? 300 : kind === 'sheet-override' ? 200 : 100,
          label,
        ),
      })
    }
    // If whitespace/source spelling differs, identity provenance still defaults
    // to species unless an authored normalized label exactly replaced it.
    void speciesLabels
  }
  return candidates
}

const activeAbilityFormSpecies = (input: {
  readonly map: TabletopMap
  readonly placement: SheetPlacement
  readonly sheet: CharacterSheet
  readonly effectiveAbilityIds: ReadonlySet<string>
}): string | null => {
  const species = input.sheet.species.trim().toLocaleLowerCase('en-US')
  const effects = (input.map.encounterState?.effects ?? []).filter(effect => (
    effect.affected.placementIds.includes(input.placement.id)
    && effect.suppression.sources.length === 0
    && (effect.duration.remaining === null || effect.duration.remaining > 0)
  ))
  const hasTag = (tag: string): boolean => effects.some(effect => effect.tags.includes(tag))
  const hpTotal = resolveStats(input.sheet).find(stat => stat.key === 'hp')?.total ?? 0
  const maximumHp = Math.max(1, computeFullMaxHp(input.sheet, hpTotal))
  const currentHp = Math.max(0, input.sheet.combat?.currentHp ?? maximumHp)
  const temporaryHp = Math.max(0, input.map.temporaryHitPoints?.byPlacementId[input.placement.id] ?? 0)
  if (input.effectiveAbilityIds.has('Schooling') && species.includes('wishiwashi')) {
    return hasTag('aa088-schooling') && (currentHp * 2 >= maximumHp || temporaryHp > 0)
      ? 'Wishiwashi Schooling' : 'Wishiwashi Solo'
  }
  if (input.effectiveAbilityIds.has('Shields Down') && species.includes('minior')) {
    return currentHp * 2 <= maximumHp || hasTag('aa089-shields-down-core')
      ? 'Minior Core' : 'Minior Meteor'
  }
  if (species.includes('darmanitan')) {
    if (hasTag('aa100-zen-mode')) return 'Darmanitan Zen Mode'
    if (hasTag('aa100-zen-snowed')) return 'Darmanitan Galar Zen Mode'
    if (input.effectiveAbilityIds.has('Zen Snowed')) return 'Darmanitan Galar Standard Mode'
    if (input.effectiveAbilityIds.has('Zen Mode')) return 'Darmanitan'
  }
  return null
}

const formProjectionCandidates = (
  placement: SheetPlacement,
  sheet: CharacterSheet,
  targetSpecies: string,
  sourcePrefix = 'ability-form',
): readonly Candidate[] => pokemonCandidates(placement, { ...sheet, species: targetSpecies }).map(candidate => ({
  ...candidate,
  source: source(
    'form-projection',
    `${sourcePrefix}:${placement.id}:${safePart(targetSpecies)}:${safePart(candidate.source.sourceId)}`,
    600,
    candidate.source.label,
    candidate.value,
  ),
}))

const transformationCandidates = (
  map: TabletopMap,
  placement: SheetPlacement,
): readonly Candidate[] | null => {
  const transformation = activeEncounterTransformation({
    placementId: placement.id,
    effects: map.encounterState?.effects,
  })
  if (!transformation) return null
  const snapshot = transformation.payload.capabilities
  const candidates: Candidate[] = []
  const numeric: ReadonlyArray<readonly [string, number | undefined]> = [
    ['Overland', snapshot.movementSpeeds.overland],
    ['Sky', snapshot.movementSpeeds.sky],
    ['Swim', snapshot.movementSpeeds.swim],
    ['Levitate', snapshot.movementSpeeds.levitate],
    ['Burrow', snapshot.movementSpeeds.burrow],
    ['Teleporter', snapshot.movementSpeeds.teleporter],
    ['Power', snapshot.power ?? undefined],
  ]
  for (const [canonicalId, value] of numeric) {
    if (value === undefined || !Number.isFinite(value) || value < 0) continue
    candidates.push({
      parsed: numericLabel(canonicalId, value),
      value,
      source: source('form-projection', `transform:${transformation.id}:${canonicalId}`, 600, canonicalId, value),
    })
  }
  const jump = snapshot.movementTraits.jump
  candidates.push({
    parsed: jumpLabel(`${jump.long}/${jump.high}`),
    value: null,
    source: source('form-projection', `transform:${transformation.id}:Jump`, 600, 'Jump'),
  })
  if (snapshot.naturewalk?.trim()) candidates.push({
    parsed: parseCapabilityLabel(`Naturewalk (${snapshot.naturewalk})`),
    value: null,
    source: source('form-projection', `transform:${transformation.id}:Naturewalk`, 600, 'Naturewalk'),
  })
  for (const label of snapshot.other) candidates.push({
    parsed: parseCapabilityLabel(label),
    value: null,
    source: source('form-projection', `transform:${transformation.id}:${safePart(label)}`, 600, label),
  })
  return candidates
}

const trainerCandidates = (
  placement: SheetPlacement,
  sheet: TrainerSheet,
): readonly Candidate[] => {
  const resolved = resolveTrainerCapabilities(sheet)
  const authored = sheet.capabilities ?? {}
  const keyByCanonical: Readonly<Record<string, keyof typeof authored>> = {
    Overland: 'overland', 'Throwing Range': 'throwingRange', 'High Jump': 'highJump',
    'Long Jump': 'longJump', Swim: 'swim', Power: 'power', Sky: 'sky',
    Levitate: 'levitate', Burrow: 'burrow',
  }
  const candidates: Candidate[] = []
  for (const row of resolved.rows) {
    if (typeof row.value !== 'number' || !Number.isFinite(row.value) || row.value < 0) continue
    const key = keyByCanonical[row.label]
    const isAuthored = key !== undefined && authored[key] !== undefined
    candidates.push({
      parsed: numericLabel(row.label, row.value),
      value: row.value,
      source: source(
        isAuthored ? 'sheet-override' : 'trainer-formula',
        isAuthored ? `sheet:trainer:${sheet.slug}:capabilities.${String(key)}` : `sheet:trainer:${sheet.slug}:formula:${safePart(row.label)}`,
        isAuthored ? 200 : 150,
        row.label,
        row.value,
      ),
    })
  }
  const longJump = resolved.rows.find(row => row.label === 'Long Jump')?.value
  const highJump = resolved.rows.find(row => row.label === 'High Jump')?.value
  if (typeof longJump === 'number' && typeof highJump === 'number') {
    candidates.push({
      parsed: jumpLabel(`${longJump}/${highJump}`),
      value: null,
      source: source('trainer-formula', `sheet:trainer:${sheet.slug}:formula:Jump`, 150, 'Jump'),
    })
  }
  for (const label of resolved.other) candidates.push({
    parsed: parseCapabilityLabel(label),
    value: null,
    source: source('sheet-override', `sheet:trainer:${sheet.slug}:capabilities.other:${safePart(label)}`, 200, label),
  })
  const edgeNames = new Set((sheet.edges ?? []).map(edge => edge.name.trim().toLocaleLowerCase('en-US')))
  const featureNames = new Set((sheet.features ?? []).map(feature => feature.name.trim().toLocaleLowerCase('en-US')))
  if (edgeNames.has('art of stealth')) candidates.push({
    parsed: parseCapabilityLabel('Stealth'), value: null,
    source: source('edge-grant', `sheet:trainer:${sheet.slug}:edge:Art of Stealth`, 350, 'Art of Stealth'),
  })
  if (featureNames.has('mental resistance')) candidates.push({
    parsed: parseCapabilityLabel('Mindlock'), value: null,
    source: source('feature-grant', `sheet:trainer:${sheet.slug}:feature:Mental Resistance`, 350, 'Mental Resistance'),
  })
  if (featureNames.has('telekinetic')) candidates.push({
    parsed: parseCapabilityLabel('Telekinetic'), value: null,
    source: source('feature-grant', `sheet:trainer:${sheet.slug}:feature:Telekinetic`, 350, 'Telekinetic'),
  })
  const numericRows = new Map(resolved.rows.map(row => [row.label, typeof row.value === 'number' ? row.value : Number(row.value)]))
  const addNumericEdge = (canonicalId: string, bonus: number, edgeName: string): void => {
    const base = numericRows.get(canonicalId)
    if (!Number.isFinite(base)) return
    candidates.push({
      parsed: numericLabel(canonicalId, base! + bonus), value: base! + bonus,
      source: source('edge-grant', `sheet:trainer:${sheet.slug}:edge:${safePart(edgeName)}`, 350, edgeName, bonus),
    })
  }
  if (edgeNames.has('power boost')) addNumericEdge('Power', 2, 'Power Boost')
  if (edgeNames.has('acrobat')) {
    addNumericEdge('High Jump', 1, 'Acrobat')
    addNumericEdge('Long Jump', 1, 'Acrobat')
    const high = numericRows.get('High Jump')
    const long = numericRows.get('Long Jump')
    if (Number.isFinite(high) && Number.isFinite(long)) candidates.push({
      parsed: jumpLabel(`${long! + 1}/${high! + 1}`),
      value: null,
      source: source('edge-grant', `sheet:trainer:${sheet.slug}:edge:Acrobat:Jump`, 350, 'Acrobat', 1),
    })
  }
  return candidates
}

const effectCandidates = (
  map: TabletopMap,
  placement: SheetPlacement,
  sheet: CharacterSheet | TrainerSheet,
): { readonly grants: readonly Candidate[]; readonly suppressions: ReadonlyMap<string, readonly string[]> } => {
  const grants: Candidate[] = []
  const suppressions = new Map<string, string[]>()
  const transformed = activeEncounterTransformation({
    placementId: placement.id,
    effects: map.encounterState?.effects,
  })
  const catalog = placement.sheetKind === 'pokemon'
    ? catalogEntryForPokemonSheet(sheet as CharacterSheet)
    : catalogEntryForTrainerSheet(sheet as TrainerSheet)
  const base = transformed?.payload.appearance.base ?? catalog?.base ?? 1
  const clearance = transformed?.payload.appearance.clearance ?? catalog?.clearance ?? 1
  const applies = (effect: NonNullable<TabletopMap['encounterState']>['effects'][number]): boolean => (
    effect.affected.placementIds.includes(placement.id)
    || (placement.sideId !== undefined && effect.affected.sideIds.includes(placement.sideId))
    || effect.affected.cells.some(cell => (
      cell.x >= placement.position.x && cell.x < placement.position.x + base
      && cell.y >= placement.position.y && cell.y < placement.position.y + clearance
      && cell.z >= placement.position.z && cell.z < placement.position.z + base
    ))
  )
  for (const effect of map.encounterState?.effects ?? []) {
    if (effect.kind !== 'capability' || effect.tags.includes('capability-mode')
      || effect.suppression.sources.length > 0
      || effect.charges === 0
      || (effect.duration.remaining !== null && effect.duration.remaining <= 0)
      || !applies(effect)) continue
    const rawCapabilityId = effect.payload.capabilityId
    const parsedDirect = parseCapabilityLabel(rawCapabilityId)
    const parsed = parsedDirect.canonicalId ? parsedDirect : parseCapabilityLabel(
      rawCapabilityId
        .replace(/^(?:capability|movement)(?:\.mode)?[.:]/i, '')
        .replace(/[._-]+/g, ' '),
    )
    if (!parsed.canonicalId) continue
    if (effect.payload.action === 'grant') {
      const value = typeof effect.payload.value === 'number' ? effect.payload.value : null
      grants.push({
        parsed: value === null ? parsed : numericLabel(parsed.canonicalId, value),
        value,
        source: source('encounter-grant', `encounter-effect:${effect.id}`, 500, parsed.canonicalId, value),
      })
      // Capability effects are ordered overlays. A later grant restores a
      // capability suppressed by an earlier effect rather than remaining
      // permanently dominated by it.
      suppressions.delete(parsed.canonicalId)
    }
    else {
      suppressions.set(parsed.canonicalId, [`encounter-effect:${effect.id}`])
    }
  }
  return { grants, suppressions }
}

const EQUIPPED_ITEM_CAPABILITY_GRANTS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  'dark-vision-goggles': Object.freeze(['Darkvision']),
  'jungle-boots': Object.freeze(['Naturewalk (Forest)']),
  're-breather': Object.freeze(['Gilled']),
  'snow-boots': Object.freeze(['Naturewalk (Tundra)']),
})

const combineParameters = (candidates: readonly Candidate[]): CapabilityParameters => {
  const selected = [...candidates].sort((left, right) => right.source.precedence - left.source.precedence)[0]!
  if (selected.parsed.canonicalId === 'Naturewalk') {
    const parameterCandidates = selected.source.kind === 'form-projection'
      ? candidates.filter(candidate => candidate.source.kind === 'form-projection')
      : candidates
    const terrains = [...new Set(parameterCandidates.flatMap(candidate => (
      candidate.parsed.parameters.kind === 'terrains' ? candidate.parsed.parameters.terrains : []
    )))]
    return { kind: 'terrains', terrains: Object.freeze(terrains) }
  }
  if (selected.parsed.canonicalId === 'Mountable X') {
    const riders = Math.max(0, ...candidates.flatMap(candidate => (
      candidate.parsed.parameters.kind === 'rider-capacity' ? [candidate.parsed.parameters.riders] : []
    )))
    return riders > 0 ? { kind: 'rider-capacity', riders } : { kind: 'none' }
  }
  return selected.parsed.parameters
}

export const resolveEffectiveCapabilities = (input: {
  readonly map: TabletopMap
  readonly placement: SheetPlacement
  readonly sheet: CharacterSheet | TrainerSheet
  readonly sheets?: {
    readonly pokemon: ReadonlyMap<string, CharacterSheet>
    readonly trainer: ReadonlyMap<string, TrainerSheet>
  }
}): EffectiveCapabilitySet => {
  const transformed = transformationCandidates(input.map, input.placement)
  const runtimeAbilityIds = effectiveRuntimeAbilityIds({
    map: input.map,
    placement: input.placement,
    sheet: input.sheet,
  })
  const abilityFormSpecies = !transformed && input.placement.sheetKind === 'pokemon'
    ? activeAbilityFormSpecies({
        map: input.map,
        placement: input.placement,
        sheet: input.sheet as CharacterSheet,
        effectiveAbilityIds: new Set(runtimeAbilityIds),
      })
    : null
  const base = [...(transformed ?? (abilityFormSpecies && input.placement.sheetKind === 'pokemon'
    ? formProjectionCandidates(input.placement, input.sheet as CharacterSheet, abilityFormSpecies)
    : input.placement.sheetKind === 'pokemon'
      ? pokemonCandidates(input.placement, input.sheet as CharacterSheet)
      : trainerCandidates(input.placement, input.sheet as TrainerSheet)))]
  for (const reference of authoritativeEquippedItemReferences(input.placement, input.sheet)) {
    for (const label of EQUIPPED_ITEM_CAPABILITY_GRANTS[reference.canonicalItemId] ?? []) {
      base.push({
        parsed: parseCapabilityLabel(label),
        value: null,
        source: source(
          'item-grant',
          `item:${input.placement.id}:${reference.itemId}:${reference.canonicalItemId}`,
          375,
          reference.canonicalItemId,
        ),
      })
    }
  }
  const effectiveAbilityIds = runtimeAbilityIds
  if (effectiveAbilityIds.includes('Illusion')) base.push({
    parsed: parseCapabilityLabel('Illusionist'), value: null,
    source: source('ability-grant', `ability:${input.placement.id}:Illusion`, 400, 'Illusion'),
  })
  if (effectiveAbilityIds.includes('Magnet Pull')) base.push({
    parsed: parseCapabilityLabel('Magnetic'), value: null,
    source: source('ability-grant', `ability:${input.placement.id}:Magnet Pull`, 400, 'Magnet Pull'),
  })
  if (effectiveAbilityIds.includes('Levitate')) {
    const native = base.filter(candidate => candidate.parsed.canonicalId === 'Levitate')
      .map(candidate => candidate.value ?? 0).reduce((maximum, value) => Math.max(maximum, value), 0)
    const value = native > 0 ? native + 2 : 4
    base.push({
      parsed: numericLabel('Levitate', value), value,
      source: source('ability-grant', `ability:${input.placement.id}:Levitate`, 400, 'Levitate Ability', value),
    })
  }
  const effects = effectCandidates(input.map, input.placement, input.sheet)
  if (!transformed && input.placement.sheetKind === 'pokemon') {
    const pokemon = input.sheet as CharacterSheet
    const activeMode = (input.map.encounterState?.capabilityRuntime?.modes ?? []).find((mode) => {
      if (!((mode.mode === 'crowned' && mode.canonicalId === 'Weapon Bond')
        || (mode.mode === 'zygarde-form' && mode.canonicalId === 'Zygarde Cells'))
        || mode.actorPlacementId !== input.placement.id
        || (mode.expiresAt !== null && mode.expiresAt <= (input.map.updatedAt ?? 0))) return false
      const sourceGroup = base.filter(candidate => candidate.parsed.canonicalId === mode.canonicalId)
      if (sourceGroup.length === 0 || (effects.suppressions.get(mode.canonicalId)?.length ?? 0) > 0) return false
      const parameters = combineParameters(sourceGroup)
      const instanceId = `capability:${safePart(input.placement.id)}:${safePart(mode.canonicalId)}:${parametersKey(parameters)}`
      return mode.capabilityInstanceId === instanceId
    })
    const species = pokemon.species.trim().toLocaleLowerCase('en-US')
    const fainted = (pokemon.combat?.currentHp ?? 1) <= 0
      || (pokemon.combat?.conditions ?? []).some(condition => condition.trim().toLocaleLowerCase('en-US') === 'fainted')
    const targetSpecies = activeMode?.mode === 'crowned' && activeMode.canonicalId === 'Weapon Bond' && !fainted
      ? species.includes('zacian') ? 'Zacian Crowned Sword Forme'
        : species.includes('zamazenta') ? 'Zamazenta Crowned Shield Forme' : null
      : activeMode?.mode === 'zygarde-form' && activeMode.canonicalId === 'Zygarde Cells'
        && !species.includes('complete')
        ? activeMode.description === '10-percent' ? 'Zygarde 10% Forme'
          : activeMode.description === '50-percent' ? 'Zygarde 50% Forme' : null
        : null
    if (targetSpecies) {
      const external = base.filter(candidate => (
        candidate.source.kind === 'item-grant' || candidate.source.kind === 'ability-grant'
      ))
      base.splice(0, base.length,
        ...formProjectionCandidates(input.placement, pokemon, targetSpecies, 'capability-form'),
        ...external)
    }
  }
  const preliminaryCandidates = [...base, ...effects.grants]
  const link = (input.map.encounterState?.capabilityRuntime?.links ?? []).find(candidate => (
    candidate.ownerPlacementId === input.placement.id
    && (candidate.kind === 'as-one-mount' || candidate.kind === 'viral-fusion')
  ))
  const linkedPlacement = link?.participantPlacementIds.length === 1
    ? input.map.placements.find(candidate => candidate.id === link.participantPlacementIds[0])
    : null
  const linkedSheet = linkedPlacement && input.sheets
    ? linkedPlacement.sheetKind === 'pokemon'
      ? input.sheets.pokemon.get(linkedPlacement.sheetSlug)
      : input.sheets.trainer.get(linkedPlacement.sheetSlug)
    : null
  const linkSourceCapability = link?.kind === 'as-one-mount' ? 'As One'
    : link?.kind === 'viral-fusion' ? 'Viral Fusion' : null
  const linkSourceGroup = linkSourceCapability === null ? [] : preliminaryCandidates.filter(candidate => (
    candidate.parsed.canonicalId === linkSourceCapability
  ))
  const linkSourceParameters = linkSourceGroup.length > 0 ? combineParameters(linkSourceGroup) : null
  const linkSourceInstanceId = linkSourceCapability && linkSourceParameters
    ? `capability:${safePart(input.placement.id)}:${safePart(linkSourceCapability)}:${parametersKey(linkSourceParameters)}`
    : null
  const linkSourceEffective = linkSourceCapability !== null
    && linkSourceGroup.length > 0
    && (effects.suppressions.get(linkSourceCapability)?.length ?? 0) === 0
    && link?.capabilityInstanceId === linkSourceInstanceId
  if (link && linkedPlacement && linkedSheet && linkSourceEffective) {
    const linkedBase = linkedPlacement.sheetKind === 'pokemon'
      ? pokemonCandidates(linkedPlacement, linkedSheet as CharacterSheet)
      : trainerCandidates(linkedPlacement, linkedSheet as TrainerSheet)
    const replaced = new Set(['Overland', 'Sky', 'Swim', 'Levitate', 'Burrow', 'Teleporter', 'Jump', 'High Jump', 'Long Jump', 'Naturewalk'])
    if (link.kind === 'viral-fusion') replaced.add('Power')
    const ownPower = base.filter(candidate => candidate.parsed.canonicalId === 'Power')
      .reduce((maximum, candidate) => Math.max(maximum, candidate.value ?? 0), 0)
    for (const candidate of linkedBase) {
      if (!candidate.parsed.canonicalId || !replaced.has(candidate.parsed.canonicalId)) continue
      if (candidate.parsed.canonicalId === 'Power' && (candidate.value ?? 0) <= ownPower) continue
      base.push({
        parsed: candidate.parsed,
        value: candidate.value,
        source: source('form-projection', `capability-link:${link.id}:${candidate.parsed.canonicalId}`, 600, candidate.source.label, candidate.value),
      })
    }
  }
  const candidates = [...base, ...effects.grants]
  const unresolved: UnresolvedEffectiveCapabilityLabel[] = candidates.flatMap(candidate => (
    candidate.parsed.canonicalId === null && candidate.parsed.normalizedLabel
      ? [{ normalizedLabel: candidate.parsed.normalizedLabel, source: candidate.source, reason: 'unknown-canonical-identity' as const }]
      : []
  ))
  const grouped = new Map<string, Candidate[]>()
  for (const candidate of candidates) {
    if (!candidate.parsed.canonicalId) continue
    const group = grouped.get(candidate.parsed.canonicalId) ?? []
    group.push(candidate)
    grouped.set(candidate.parsed.canonicalId, group)
  }
  const instances: EffectiveCapabilityInstance[] = [...grouped.entries()].map(([canonicalId, group]) => {
    const sources = [...new Map(group.map(candidate => [candidate.source.sourceId, candidate.source])).values()]
      .sort((left, right) => left.precedence - right.precedence || left.sourceId.localeCompare(right.sourceId))
    const primarySource = sources.at(-1)!
    const parameters = combineParameters(group)
    const selectedNumeric = [...group]
      .filter(candidate => candidate.value !== null)
      .sort((left, right) => right.source.precedence - left.source.precedence || right.source.sourceId.localeCompare(left.source.sourceId))[0]
    const value = selectedNumeric?.value ?? (parameters.kind === 'value' ? parameters.value : null)
    const permanentSuppressionReasons = input.placement.sheetKind === 'pokemon'
      && canonicalId === 'Underdog'
      && Boolean((input.sheet as CharacterSheet).capabilityCampaignState?.letterPress)
      ? [`sheet:pokemon:${input.sheet.slug}:capabilityCampaignState.letterPress`] : []
    const suppressionReasons = Object.freeze([
      ...(effects.suppressions.get(canonicalId) ?? []),
      ...permanentSuppressionReasons,
    ])
    const manifest = CAPABILITY_AUTOMATION_MANIFEST_BY_ID.get(canonicalId)
    if (!manifest) throw new Error(`Effective capability ${canonicalId} has no reviewed manifest entry.`)
    return Object.freeze({
      instanceId: `capability:${safePart(input.placement.id)}:${safePart(canonicalId)}:${parametersKey(parameters)}`,
      canonicalId,
      parameters,
      value,
      effective: suppressionReasons.length === 0,
      suppressionReasons,
      sources: Object.freeze(sources),
      primarySource,
      sourceEffectSha256: manifest.sourceEffectSha256,
    })
  }).sort((left, right) => left.canonicalId < right.canonicalId ? -1 : left.canonicalId > right.canonicalId ? 1 : 0)

  return Object.freeze({
    actorPlacementId: input.placement.id,
    instances: Object.freeze(instances),
    unresolved: Object.freeze(unresolved),
  })
}
