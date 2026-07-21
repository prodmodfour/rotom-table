import {
  MOVE_PREDICATE_KINDS,
  parseMovePredicate,
} from '#shared/moveAutomation/predicates'
import {
  MOVE_SELECTOR_KINDS,
  parseMoveSelector,
} from '#shared/moveAutomation/selectors'
import {
  ABILITY_CHECK_OPERATION_KIND,
  parseAbilityCheckDefinition,
} from '#shared/abilityAutomation/checks'
import {
  ABILITY_TARGETING_PREDICATE_KIND,
  parseAbilityTargetingPredicate,
} from '#shared/abilityAutomation/targeting'
import {
  ABILITY_ITEM_EVENT_PREDICATE_KIND,
  parseAbilityItemEventPredicate,
} from '#shared/abilityAutomation/itemEventPredicates'
import {
  ABILITY_FIELD_EVENT_PREDICATE_KIND,
  parseAbilityFieldEventPredicate,
} from '#shared/abilityAutomation/fieldEventPredicates'
import {
  ABILITY_PRESENCE_EVENT_PREDICATE_KIND,
  parseAbilityPresenceEventPredicate,
} from '#shared/abilityAutomation/presenceEventPredicates'
import {
  ABILITY_INITIATIVE_EVENT_PREDICATE_KIND,
  parseAbilityInitiativeEventPredicate,
} from '#shared/abilityAutomation/initiativeEventPredicates'
import {
  ABILITY_LIFECYCLE_EVENT_PREDICATE_KIND,
  parseAbilityLifecycleEventPredicate,
} from '#shared/abilityAutomation/lifecycleEventPredicates'
import {
  ABILITY_MOVEMENT_EVENT_PREDICATE_KIND,
  parseAbilityMovementEventPredicate,
} from '#shared/abilityAutomation/movementEventPredicates'
import {
  ABILITY_CONDITION_EVENT_PREDICATE_KIND,
  parseAbilityConditionEventPredicate,
} from '#shared/abilityAutomation/conditionEventPredicates'
import {
  ABILITY_VALUE_CHANGE_EVENT_PREDICATE_KIND,
  parseAbilityValueChangeEventPredicate,
} from '#shared/abilityAutomation/changeEventPredicates'
import {
  ABILITY_HP_EVENT_PREDICATE_KIND,
  parseAbilityHpEventPredicate,
} from '#shared/abilityAutomation/hpEventPredicates'
import {
  ABILITY_STRIKE_EVENT_PREDICATE_KIND,
  parseAbilityStrikeEventPredicate,
} from '#shared/abilityAutomation/strikeEventPredicates'
import {
  ABILITY_MOVE_EVENT_PREDICATE_KIND,
  parseAbilityMoveEventPredicate,
} from '#shared/abilityAutomation/moveEventPredicates'
import {
  ABILITY_SHARED_EFFECT_NODE_KIND,
  parseAbilitySharedEffectNode,
} from '#shared/abilityAutomation/effects'
import {
  ABILITY_MECHANIC_OPERATION_KIND,
  parseAbilityMechanicOperation,
} from '#shared/abilityAutomation/mechanics'
import type { AbilitySpecJsonObject } from '#shared/abilityAutomation/spec'
import {
  createAbilitySpecExtensionRegistry,
  type RegisteredAbilitySpecExtension,
} from './extensionRegistry'

const selectors: readonly RegisteredAbilitySpecExtension[] = MOVE_SELECTOR_KINDS.map(kind => ({
  family: 'selector',
  kind,
  version: 1,
  parse: (value, path) => parseMoveSelector(value, path) as unknown as AbilitySpecJsonObject,
}))

const predicates: readonly RegisteredAbilitySpecExtension[] = MOVE_PREDICATE_KINDS.map(kind => ({
  family: 'predicate',
  kind,
  version: 1,
  parse: (value, path) => parseMovePredicate(value, path) as unknown as AbilitySpecJsonObject,
}))

const abilityCheckOperation: RegisteredAbilitySpecExtension = {
  family: 'operation',
  kind: ABILITY_CHECK_OPERATION_KIND,
  version: 1,
  parse: (value, path) => parseAbilityCheckDefinition(value, path),
}

const abilityTargetingPredicate: RegisteredAbilitySpecExtension = {
  family: 'predicate',
  kind: ABILITY_TARGETING_PREDICATE_KIND,
  version: 1,
  parse: (value, path) => parseAbilityTargetingPredicate(value, path),
}

const itemEventPredicate: RegisteredAbilitySpecExtension = {
  family: 'predicate',
  kind: ABILITY_ITEM_EVENT_PREDICATE_KIND,
  version: 1,
  parse: (value, path) => parseAbilityItemEventPredicate(value, path),
}

const fieldEventPredicate: RegisteredAbilitySpecExtension = {
  family: 'predicate',
  kind: ABILITY_FIELD_EVENT_PREDICATE_KIND,
  version: 1,
  parse: (value, path) => parseAbilityFieldEventPredicate(value, path),
}

const presenceEventPredicate: RegisteredAbilitySpecExtension = {
  family: 'predicate',
  kind: ABILITY_PRESENCE_EVENT_PREDICATE_KIND,
  version: 1,
  parse: (value, path) => parseAbilityPresenceEventPredicate(value, path),
}

const initiativeEventPredicate: RegisteredAbilitySpecExtension = {
  family: 'predicate',
  kind: ABILITY_INITIATIVE_EVENT_PREDICATE_KIND,
  version: 1,
  parse: (value, path) => parseAbilityInitiativeEventPredicate(value, path),
}

const lifecycleEventPredicate: RegisteredAbilitySpecExtension = {
  family: 'predicate',
  kind: ABILITY_LIFECYCLE_EVENT_PREDICATE_KIND,
  version: 1,
  parse: (value, path) => parseAbilityLifecycleEventPredicate(value, path),
}

const movementEventPredicate: RegisteredAbilitySpecExtension = {
  family: 'predicate',
  kind: ABILITY_MOVEMENT_EVENT_PREDICATE_KIND,
  version: 1,
  parse: (value, path) => parseAbilityMovementEventPredicate(value, path),
}

const conditionEventPredicate: RegisteredAbilitySpecExtension = {
  family: 'predicate',
  kind: ABILITY_CONDITION_EVENT_PREDICATE_KIND,
  version: 1,
  parse: (value, path) => parseAbilityConditionEventPredicate(value, path),
}

const valueChangeEventPredicate: RegisteredAbilitySpecExtension = {
  family: 'predicate',
  kind: ABILITY_VALUE_CHANGE_EVENT_PREDICATE_KIND,
  version: 1,
  parse: (value, path) => parseAbilityValueChangeEventPredicate(value, path),
}

const hpEventPredicate: RegisteredAbilitySpecExtension = {
  family: 'predicate',
  kind: ABILITY_HP_EVENT_PREDICATE_KIND,
  version: 1,
  parse: (value, path) => parseAbilityHpEventPredicate(value, path),
}

const strikeEventPredicate: RegisteredAbilitySpecExtension = {
  family: 'predicate',
  kind: ABILITY_STRIKE_EVENT_PREDICATE_KIND,
  version: 1,
  parse: (value, path) => parseAbilityStrikeEventPredicate(value, path),
}

const moveEventPredicate: RegisteredAbilitySpecExtension = {
  family: 'predicate',
  kind: ABILITY_MOVE_EVENT_PREDICATE_KIND,
  version: 1,
  parse: (value, path) => parseAbilityMoveEventPredicate(value, path),
}

const sharedEffect: RegisteredAbilitySpecExtension = {
  family: 'operation',
  kind: ABILITY_SHARED_EFFECT_NODE_KIND,
  version: 1,
  parse: (value, path, context) => parseAbilitySharedEffectNode(value, path, context.phase),
}

const abilityMechanic: RegisteredAbilitySpecExtension = {
  family: 'operation',
  kind: ABILITY_MECHANIC_OPERATION_KIND,
  version: 1,
  parse: (value, path) => parseAbilityMechanicOperation(value, path),
}

/** Closed adapters for only the Move kernel concepts whose semantics are shared. */
export const ABILITY_SPEC_SHARED_KERNEL_EXTENSION_REGISTRY = createAbilitySpecExtensionRegistry([
  ...selectors,
  ...predicates,
  moveEventPredicate,
  strikeEventPredicate,
  hpEventPredicate,
  conditionEventPredicate,
  valueChangeEventPredicate,
  movementEventPredicate,
  presenceEventPredicate,
  initiativeEventPredicate,
  lifecycleEventPredicate,
  itemEventPredicate,
  fieldEventPredicate,
  abilityTargetingPredicate,
  abilityCheckOperation,
  abilityMechanic,
  sharedEffect,
])
