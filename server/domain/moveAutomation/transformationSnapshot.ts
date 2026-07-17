import { findMove } from '~~/data/ptuReference'
import {
  parseEncounterTransformationEffectPayload,
  type EncounterTransformationEffectPayload,
} from '#shared/moveAutomation/transformationSnapshots'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SpawnedPokemon, SpriteAnimation, SpriteCrop } from '~/types/pokemon'
import type { TrainerSheet } from '~/types/trainerSheet'
import { moveEntriesForPlacement } from '~/utils/mapTokenMoves'
import type { AuthoritativeMoveRulesContext } from './context'

export type EncounterTransformationSnapshotErrorCode =
  | 'target-missing'
  | 'target-not-pokemon'
  | 'target-sheet-missing'
  | 'target-form-incomplete'
  | 'target-move-unreviewed'
  | 'target-snapshot-invalid'

export class EncounterTransformationSnapshotError extends Error {
  readonly code: EncounterTransformationSnapshotErrorCode

  constructor(code: EncounterTransformationSnapshotErrorCode, message: string) {
    super(message)
    this.name = 'EncounterTransformationSnapshotError'
    this.code = code
  }
}

const fail = (
  code: EncounterTransformationSnapshotErrorCode,
  message: string,
): never => {
  throw new EncounterTransformationSnapshotError(code, message)
}

const cloneAnimation = (animation: SpriteAnimation | undefined): SpriteAnimation | null => (
  animation ? { ...animation, durationsMs: [...animation.durationsMs] } : null
)

const cloneCrop = (crop: SpriteCrop | undefined): SpriteCrop | null => (
  crop ? { ...crop } : null
)

const sheetLookups = (
  context: AuthoritativeMoveRulesContext,
): {
  readonly pokemon: Map<string, CharacterSheet>
  readonly trainer: Map<string, TrainerSheet>
} => {
  const pokemon = new Map<string, CharacterSheet>()
  const trainer = new Map<string, TrainerSheet>()
  for (const resolved of context.resolvedSheets) {
    if (resolved.kind === 'pokemon') pokemon.set(resolved.slug, resolved.sheet as CharacterSheet)
    else trainer.set(resolved.slug, resolved.sheet as TrainerSheet)
  }
  return { pokemon, trainer }
}

const targetMoves = (
  context: AuthoritativeMoveRulesContext,
  placement: NonNullable<ReturnType<AuthoritativeMoveRulesContext['queries']['placements']['get']>>,
): EncounterTransformationEffectPayload['moves'] => moveEntriesForPlacement(
  placement,
  sheetLookups(context),
  { encounterEffects: context.map.encounterState?.effects },
).map((entry) => {
  const requestedName = entry.move.name.trim()
  const canonicalMoveId = findMove(requestedName)?.name
    ?? fail(
      'target-move-unreviewed',
      `Transformation target move ${requestedName || '(blank)'} is absent from the canonical catalog.`,
    )
  const runtime = context.queries.rules.runtimeFor(canonicalMoveId)
    ?? fail(
      'target-move-unreviewed',
      `Transformation target move ${canonicalMoveId} has no reviewed server runtime.`,
    )
  return {
    canonicalMoveId,
    copiedSpecHash: runtime.definitionHash,
  }
})

/**
 * Snapshot exactly the authoritative target facts Transform is permitted to
 * copy. The target sheet joins the resolution read set; no sheet or map value
 * is mutated, and no later target edit can alter the durable active form.
 */
export const snapshotAuthoritativeEncounterTransformation = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly targetPlacementId: string
}): EncounterTransformationEffectPayload => {
  const placement = input.context.queries.placements.get(input.targetPlacementId)
    ?? fail(
      'target-missing',
      `Transformation target placement ${input.targetPlacementId} is missing.`,
    )
  if (placement.sheetKind !== 'pokemon') {
    return fail('target-not-pokemon', 'Transform may snapshot only a Pokémon target.')
  }
  const resolvedSheet = input.context.queries.sheets.forPlacement(placement)
  if (!resolvedSheet || resolvedSheet.kind !== 'pokemon') {
    return fail(
      'target-sheet-missing',
      `Transformation target sheet ${placement.sheetSlug} is unavailable.`,
    )
  }
  input.context.reads.recordPlacement(placement)
  const token = input.context.queries.tokens.get(placement.id)
    ?? fail(
      'target-missing',
      `Transformation target token ${placement.id} could not be projected.`,
    )
  if (!token.ruleCapabilities || token.weightClass === undefined) {
    return fail(
      'target-form-incomplete',
      `Transformation target ${placement.id} has no complete capability or Weight Class projection.`,
    )
  }
  const sourceSheet = resolvedSheet.sheet as CharacterSheet
  const moves = targetMoves(input.context, placement)

  try {
    return parseEncounterTransformationEffectPayload({
      copiedFromPlacementId: placement.id,
      moves,
      typeIds: token.defenderTypes.map(type => type.trim().toLowerCase()),
      abilityNames: [...(token.abilityNames ?? [])],
      weightClass: token.weightClass,
      capabilities: {
        ...token.ruleCapabilities,
        movementSpeeds: { ...token.movementCapabilities },
        movementTraits: token.movementTraits
          ? {
              phasing: token.movementTraits.phasing,
              jump: { ...token.movementTraits.jump },
            }
          : token.ruleCapabilities.movementTraits,
        other: [...token.ruleCapabilities.other],
      },
      appearance: {
        species: token.transformation?.appearanceSpecies ?? sourceSheet.species,
        size: token.size,
        width: token.width,
        height: token.height,
        base: token.base,
        clearance: token.clearance,
        slug: token.slug,
        spriteUrl: token.spriteUrl,
        profileSpriteUrl: token.profileSpriteUrl ?? null,
        backSpriteUrl: token.backSpriteUrl ?? null,
        spriteAnimation: cloneAnimation(token.spriteAnimation),
        backSpriteAnimation: cloneAnimation(token.backSpriteAnimation),
        spriteCrop: cloneCrop(token.spriteCrop),
      },
    }, 'authoritativeTransformationSnapshot')
  }
  catch (error) {
    return fail(
      'target-snapshot-invalid',
      `Transformation target ${placement.id} produced an invalid bounded snapshot: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}
