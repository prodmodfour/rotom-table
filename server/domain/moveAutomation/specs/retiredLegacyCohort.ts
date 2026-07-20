import type {
  MoveCombatStageEffectOperation,
  MoveConditionEffectOperation,
  MoveConditionNaturalRollTrigger,
  MoveDamageEffectOperation,
  MoveEffectOperation,
  MoveEffectRecipientSelectorKind,
  MoveRollEffectOperation,
} from "#shared/moveAutomation/effects";
import type {
  MoveSpec,
  MoveSpecCostDeclaration,
  MoveSpecJsonObject,
  MoveSpecTargetingDeclaration,
} from "#shared/moveAutomation/spec";
import type { MoveAutomationScript } from "~/types/moveAutomation";
import { EXPLICIT_MOVE_AUTOMATION_SCRIPTS } from "~/utils/move-automation/registry";
import { RETIRED_LEGACY_HANDLER_ID } from "../handlers/retiredLegacy";
import type { MoveSpecV2Registration } from "../registry";
import {
  areaTargeting,
  createReviewedMoveSpec,
  moveSlug,
  multiTargeting,
  reviewedCondition,
  reviewedDamage,
  reviewedDirectHp,
  reviewedStage,
  selfTargeting,
  singleTargeting,
  standardAccuracy,
  standardActionCost,
  standardTerminalOperations,
} from "./reviewedSpecBuilder";

/** v1-selected rows at the start of the MA-299 retirement observation cut. */
export const RETIRED_LEGACY_MOVE_NAMES = Object.freeze([
  "Accelerock",
  "Acid",
  "Acid Spray",
  "Acupressure",
  "Aerial Ace",
  "Air Cutter",
  "Air Slash",
  "Apple Acid",
  "Aqua Jet",
  "Aqua Tail",
  "Aromatic Mist",
  "Attack Order",
  "Aura Sphere",
  "Aurora Beam",
  "Baby-Doll Eyes",
  "Bite",
  "Blaze Kick",
  "Bleakwind Storm",
  "Blue Flare",
  "Body Slam",
  "Bolt Strike",
  "Bone Club",
  "Boomburst",
  "Branch Poke",
  "Breaking Swipe",
  "Brutal Swing",
  "Bubble",
  "Bubble Beam",
  "Bulldoze",
  "Bullet Punch",
  "Charm",
  "Coaching",
  "Confide",
  "Confuse Ray",
  "Confusion",
  "Cotton Spore",
  "Crabhammer",
  "Cross Chop",
  "Cross Poison",
  "Crunch",
  "Crush Claw",
  "Dark Pulse",
  "Dazzling Gleam",
  "Decorate",
  "Disarming Voice",
  "Discharge",
  "Dizzy Punch",
  "Dragon Breath",
  "Dragon Claw",
  "Dragon Hammer",
  "Dragon Pulse",
  "Drill Peck",
  "Drill Run",
  "Drum Beating",
  "Earth Power",
  "Eerie Impulse",
  "Egg Bomb",
  "Electroweb",
  "Energy Ball",
  "Esper Wing",
  "Extrasensory",
  "Extreme Speed",
  "Fairy Wind",
  "Fake Tears",
  "False Surrender",
  "Feather Dance",
  "Feint Attack",
  "Fire Blast",
  "Fire Lash",
  "Fire Punch",
  "Flame Wheel",
  "Flamethrower",
  "Flash",
  "Flash Cannon",
  "Flatter",
  "Focus Blast",
  "Force Palm",
  "Frustration",
  "Glare",
  "Grass Whistle",
  "Grav Apple",
  "Growl",
  "Gunk Shot",
  "Headbutt",
  "Heal Bell",
  "Heart Stamp",
  "Heat Wave",
  "Hone Claws",
  "Horn Attack",
  "Howl",
  "Hyper Fang",
  "Hypnosis",
  "Ice Beam",
  "Ice Punch",
  "Ice Shard",
  "Icicle Crash",
  "Icy Wind",
  "Iron Head",
  "Iron Tail",
  "Karate Chop",
  "Land’s Wrath",
  "Lava Plume",
  "Leaf Blade",
  "Leafage",
  "Leer",
  "Lick",
  "Liquidation",
  "Lovely Kiss",
  "Low Sweep",
  "Luster Purge",
  "Mach Punch",
  "Magical Leaf",
  "Magnet Bomb",
  "Mega Punch",
  "Metal Sound",
  "Mirror Shot",
  "Mist Ball",
  "Moonblast",
  "Mountain Gale",
  "Mud Bomb",
  "Mud Shot",
  "Mud Sport",
  "Mud-Slap",
  "Mystical Fire",
  "Needle Arm",
  "Night Daze",
  "Night Slash",
  "Noble Roar",
  "Nuzzle",
  "Octazooka",
  "Origin Pulse",
  "Overdrive",
  "Peck",
  "Petal Blizzard",
  "Play Nice",
  "Play Rough",
  "Poison Fang",
  "Poison Gas",
  "Poison Jab",
  "Poison Powder",
  "Poison Sting",
  "Poison Tail",
  "Pound",
  "Powder Snow",
  "Power Gem",
  "Power Whip",
  "Precipice Blades",
  "Psybeam",
  "Psycho Cut",
  "Psywave",
  "Pyro Ball",
  "Quick Attack",
  "Raging Fury",
  "Razor Leaf",
  "Razor Shell",
  "Return",
  "Rock Climb",
  "Rock Slide",
  "Rock Smash",
  "Rock Throw",
  "Rock Tomb",
  "Rolling Kick",
  "Sacred Fire",
  "Sacred Sword",
  "Sandstorm Sear",
  "Scald",
  "Scary Face",
  "Scorching Sands",
  "Screech",
  "Searing Shot",
  "Seed Bomb",
  "Seed Flare",
  "Shadow Ball",
  "Shadow Bone",
  "Shadow Claw",
  "Shadow Punch",
  "Shadow Sneak",
  "Shock Wave",
  "Signal Beam",
  "Slash",
  "Sleep Powder",
  "Sludge",
  "Sludge Bomb",
  "Sludge Wave",
  "Smart Strike",
  "Smog",
  "Snarl",
  "Spark",
  "Spirit Break",
  "Spore",
  "Steam Eruption",
  "Stone Edge",
  "Strange Steam",
  "Struggle",
  "Struggle (Firestarter Physical)",
  "Struggle (Firestarter Special)",
  "Struggle (Fountain Physical)",
  "Struggle (Fountain Special)",
  "Struggle (Freezer Physical)",
  "Struggle (Freezer Special)",
  "Struggle (Guster Physical)",
  "Struggle (Guster Special)",
  "Struggle (Materializer Physical)",
  "Struggle (Materializer Special)",
  "Struggle (Telekinetic Physical)",
  "Struggle (Telekinetic Special)",
  "Struggle (Zapper Physical)",
  "Struggle (Zapper Special)",
  "Struggle Bug",
  "Stun Spore",
  "Swagger",
  "Swift",
  "Tail Whip",
  "Taunt",
  "Tearful Look",
  "Teeter Dance",
  "Thunder Punch",
  "Thunder Shock",
  "Thunderbolt",
  "Tickle",
  "Torment",
  "Vacuum Wave",
  "Vice Grip",
  "Vine Whip",
  "Water Gun",
  "Water Pulse",
  "Waterfall",
  "Wildbolt Storm",
  "Will-O-Wisp",
  "Wing Attack",
  "X-Scissor",
  "Zen Headbutt",
  "Zing Zap",
] as const);
export type RetiredLegacyMoveName = (typeof RETIRED_LEGACY_MOVE_NAMES)[number];

const areaPredicate = (script: MoveAutomationScript): MoveSpecJsonObject => ({
  relationship: script.areaTargetRelationship ?? "any",
  willingness: "any",
  excludeActor: script.areaTargetRelationship !== "ally",
});

const targetingRule = (
  mode: MoveAutomationScript["targetMode"] | "multi-target",
  count: number | null,
  script: MoveAutomationScript,
): MoveSpecTargetingDeclaration => {
  if (mode === "self") return selfTargeting();
  if (mode === "one-target") return singleTargeting();
  if (mode === "multi-target" && count !== null)
    return multiTargeting(1, count);
  if (mode === "multi-target") return areaTargeting(areaPredicate(script));
  return { kind: "none", minTargets: 0, maxTargets: 0, selector: null };
};

const targeting = (
  script: MoveAutomationScript,
): MoveSpecTargetingDeclaration => {
  if (!script.targetBranches?.length) {
    return targetingRule(script.targetMode, script.targetCount, script);
  }
  const first = script.targetBranches[0]!;
  const base = targetingRule(first.targetMode, first.targetCount, script);
  return {
    ...base,
    branches: script.targetBranches.map((branch) => ({
      id: branch.id,
      ...targetingRule(branch.targetMode, branch.targetCount, script),
    })),
  };
};

const naturalTrigger = (
  threshold: string | undefined,
): MoveConditionNaturalRollTrigger | undefined => {
  if (!threshold) return undefined;
  if (threshold === "even roll") {
    return {
      kind: "natural-rolls",
      values: [2, 4, 6, 8, 10, 12, 14, 16, 18, 20],
    };
  }
  const range = /^(\d+)(?:-|\+)/.exec(threshold);
  return range ? { kind: "range", minimum: Number(range[1]) } : undefined;
};

const recipientsFor = (
  script: MoveAutomationScript,
  recipient: "user" | "target",
): MoveEffectRecipientSelectorKind => {
  if (recipient === "user") return "actor";
  if (script.requiresAccuracy) return "hit-targets";
  return script.targetMode === "multi-target"
    ? "area-targets"
    : "selected-targets";
};

const conditionId = (value: string): string =>
  ({
    Burn: "burned",
    Burned: "burned",
    Freeze: "frozen",
    Frozen: "frozen",
    Paralysis: "paralysis",
    Poison: "poisoned",
    Poisoned: "poisoned",
    Sleep: "sleep",
  })[value] ?? value.toLowerCase().replace(/[^a-z0-9]+/g, "-");

const accuracy = (
  script: MoveAutomationScript,
  slug: string,
): MoveEffectOperation[] =>
  script.requiresAccuracy ? [standardAccuracy(slug)] : [];

const hasKeyword = (script: MoveAutomationScript, keyword: string): boolean =>
  script.keywords.some((candidate) => candidate.trim().toLowerCase() === keyword.toLowerCase());

const damage = (
  script: MoveAutomationScript,
  slug: string,
): MoveDamageEffectOperation => {
  const operation = reviewedDamage({
    slug,
    damageBase: script.damageBase ?? 0,
    damageClass:
      script.damageClass?.toLowerCase() === "special" ? "special" : "physical",
    moveType: script.type.toLowerCase(),
    recipients:
      hasKeyword(script, "Smite") || !script.requiresAccuracy
        ? "attacked-targets"
        : "hit-targets",
    ...(script.criticalRange === null
      ? {}
      : {
          criticalHit: {
            trigger: { kind: "range", minimum: script.criticalRange },
            prevention: "honor",
          },
        }),
  });
  if (script.requiresAccuracy) return operation;
  return {
    ...operation,
    source: { kind: "move", id: `move.${slug}` },
    payload: {
      ...operation.payload,
      accuracyRollId: null,
      criticalRollId: null,
    },
  };
};

const conditionOperations = (
  script: MoveAutomationScript,
  slug: string,
): MoveConditionEffectOperation[] =>
  script.conditionSuggestions.map((suggestion, index) => {
    const trigger = naturalTrigger(suggestion.threshold);
    return reviewedCondition({
      slug,
      id: `condition-${index + 1}`,
      recipients:
        trigger && suggestion.recipient === "target"
          ? "attacked-targets"
          : recipientsFor(script, suggestion.recipient),
      conditionId: conditionId(suggestion.condition),
      action: suggestion.action === "remove" ? "remove" : "apply",
      phase: script.damaging ? "after-damage" : "hit",
      ...(script.requiresAccuracy
        ? { sourceOperationId: `${slug}.accuracy` }
        : {}),
      ...(trigger
        ? { accuracyRollTrigger: { rollId: `${slug}.accuracy-roll`, trigger } }
        : {}),
      applyTypeImmunity: script.damaging && suggestion.recipient === "target",
    });
  });

const electricCoatConsumption = (
  script: MoveAutomationScript,
  slug: string,
): readonly MoveConditionEffectOperation[] =>
  script.damaging && script.type.trim().toLowerCase() === "electric"
    ? [
        reviewedCondition({
          slug,
          id: "consume-electric-resistant-coat",
          recipients: "hit-targets",
          conditionId: "electric-resistant-coat",
          action: "remove",
          phase: "after-damage",
          applyTypeImmunity: false,
        }),
      ]
    : [];

const stageOperations = (
  script: MoveAutomationScript,
  slug: string,
): MoveCombatStageEffectOperation[] =>
  script.stageSuggestions.map((suggestion, index) => {
    const trigger = naturalTrigger(suggestion.threshold);
    return reviewedStage({
      slug,
      id: `stage-${index + 1}`,
      recipients:
        trigger && suggestion.recipient === "target"
          ? "attacked-targets"
          : recipientsFor(script, suggestion.recipient),
      stage: suggestion.key,
      value: suggestion.delta,
      phase: script.damaging ? "after-damage" : "hit",
      ...(script.requiresAccuracy
        ? { sourceOperationId: `${slug}.accuracy` }
        : {}),
      ...(trigger
        ? {
            trigger: {
              kind: "accuracy-roll",
              rollId: `${slug}.accuracy-roll`,
              trigger,
              scope:
                suggestion.recipient === "user" ? "resolution" : "recipient",
              application: "once",
            },
          }
        : {}),
      applyTypeImmunity: script.damaging && suggestion.recipient === "target",
    });
  });

const randomTableRoll = (
  slug: string,
  id: string,
  operationIds: readonly string[],
  phase: MoveRollEffectOperation["phase"],
): MoveRollEffectOperation => ({
  id: `${slug}.${id}`,
  kind: "roll",
  source: { kind: "move", id: `move.${slug}` },
  recipients: { kind: "none" },
  phase,
  reasonCode: `${slug}.${id}`,
  payload: {
    rollId: `${slug}.${id}-roll`,
    formula: { kind: "table", tableId: `${slug}.${id}-table` },
    table: {
      tableId: `${slug}.${id}-table`,
      distribution: "equal",
      entries: operationIds.map((operationId, index) => ({
        id: `${slug}.${id}-outcome-${index + 1}`,
        weight: null,
        operationIds: [operationId],
        predicate: null,
      })),
      maximumRerolls: 0,
    },
  },
});

const acupressureOperations = (
  script: MoveAutomationScript,
  slug: string,
): readonly MoveEffectOperation[] => {
  const stages = stageOperations(script, slug).map((operation) => {
    const { trigger: _trigger, ...payload } = operation.payload;
    return {
      ...operation,
      source: { kind: "operation" as const, id: `${slug}.random-stage` },
      payload,
    };
  });
  return [
    ...accuracy(script, slug),
    randomTableRoll(
      slug,
      "random-stage",
      stages.map((stage) => stage.id),
      "hit",
    ),
    ...stages,
  ];
};

const psywaveOperations = (
  script: MoveAutomationScript,
  slug: string,
): readonly MoveEffectOperation[] => {
  const tableId = `${slug}.level-multiplier`;
  const multipliers =
    script.directHpLoss?.kind === "user-level-roll-table"
      ? script.directHpLoss.rollTable.map((entry) => entry.multiplier)
      : [1];
  const direct = multipliers.map((multiplier, index) =>
    reviewedDirectHp({
      slug,
      id: `level-loss-${index + 1}`,
      recipients: "hit-targets",
      sourceOperationId: tableId,
      phase: "damage",
      calculation: {
        kind: "formula",
        expression: {
          kind: "arithmetic",
          operator: "multiply",
          operands: [
            {
              kind: "stat",
              subject: { kind: "actor" },
              stat: "level",
              combatStagePolicy: "ignore",
              stageModifierPolicy: "ignore",
            },
            { kind: "constant", value: multiplier },
          ],
        },
      },
      accuracyRollId: `${slug}.accuracy-roll`,
      applyTypeImmunity: true,
    }),
  );
  return [
    ...accuracy(script, slug),
    randomTableRoll(
      slug,
      "level-multiplier",
      direct.map((operation) => operation.id),
      "damage",
    ),
    ...direct,
  ];
};

const costs = (
  script: MoveAutomationScript,
  slug: string,
): readonly MoveSpecCostDeclaration[] => {
  const standard = standardActionCost(slug);
  const response = /\bInterrupt\b/i.test(script.range)
    ? "interrupt"
    : /\bReaction\b/i.test(script.range)
      ? "reaction"
      : null;
  const declarations: MoveSpecCostDeclaration[] = response
    ? [
        {
          id: `${slug}.cost.${response}`,
          phase: "declare",
          cost: { kind: "action-resource", resource: response, amount: 1 },
        },
      ]
    : [standard];
  if (/\bPriority\b/i.test(script.range)) {
    declarations.unshift({
      id: `${slug}.cost.priority`,
      phase: "declare",
      cost: { kind: "priority", mode: "standard" },
    });
  }
  if (script.areaTemplates?.some((candidate) => candidate.kind === "pass")) {
    declarations.push(
      {
        id: `${slug}.cost.pass-shift`,
        phase: "movement",
        cost: { kind: "action-resource", resource: "shift", amount: 1 },
      },
      {
        id: `${slug}.cost.pass-distance`,
        phase: "movement",
        cost: { kind: "movement-distance", amount: "resolved-distance" },
      },
    );
  }
  return declarations;
};

const passMovement = (
  script: MoveAutomationScript,
  slug: string,
): MoveEffectOperation[] => {
  const template = script.areaTemplates?.find(
    (candidate) => candidate.kind === "pass",
  );
  if (!template) return [];
  return [
    {
      id: `${slug}.pass-movement`,
      kind: "movement-request",
      source: { kind: "move", id: `move.${slug}` },
      recipients: { kind: "actor" },
      phase: "movement",
      reasonCode: `${slug}.pass-movement`,
      payload: {
        requestId: `${slug}.pass-destination`,
        mode: "voluntary",
        distance: template.size,
        destinationSetId: `${slug}.pass-destinations`,
      },
    },
  ];
};

const operations = (
  script: MoveAutomationScript,
): readonly MoveEffectOperation[] => {
  const slug = moveSlug(script.moveName);
  const core =
    script.moveName === "Acupressure"
      ? acupressureOperations(script, slug)
      : script.moveName === "Psywave"
        ? psywaveOperations(script, slug)
        : [
            ...accuracy(script, slug),
            ...(script.damaging && script.moveName !== "Frustration" && script.moveName !== "Return"
              ? [damage(script, slug)]
              : []),
            ...conditionOperations(script, slug),
            ...stageOperations(script, slug),
            ...electricCoatConsumption(script, slug),
          ];
  return [
    ...core,
    ...passMovement(script, slug),
    ...standardTerminalOperations(slug),
  ];
};

const specs = Object.fromEntries(
  RETIRED_LEGACY_MOVE_NAMES.map((canonicalId) => {
    const script = EXPLICIT_MOVE_AUTOMATION_SCRIPTS.get(canonicalId);
    if (!script)
      throw new Error(`Retired legacy source is missing ${canonicalId}.`);
    return [
      canonicalId,
      createReviewedMoveSpec({
        canonicalId,
        targeting: targeting(script),
        costs: costs(script, moveSlug(canonicalId)),
        operations: operations(script),
        registeredHandlerId:
          canonicalId === "Frustration" || canonicalId === "Return"
            ? RETIRED_LEGACY_HANDLER_ID
            : null,
        tags: [
          "legacy-retirement",
          "reviewed",
          ...(script.conditionSuggestions.some((suggestion) => naturalTrigger(suggestion.threshold))
            || script.stageSuggestions.some((suggestion) => naturalTrigger(suggestion.threshold))
            ? ["natural-effect-range"]
            : []),
        ],
      }),
    ];
  }),
) as Record<RetiredLegacyMoveName, MoveSpec>;

export const RETIRED_LEGACY_MOVE_SPEC_REGISTRATIONS: readonly MoveSpecV2Registration[] =
  Object.freeze(
    RETIRED_LEGACY_MOVE_NAMES.map((canonicalId) =>
      Object.freeze({
        canonicalId,
        sourceModule:
          "server/domain/moveAutomation/specs/retiredLegacyCohort.ts",
        spec: specs[canonicalId],
      }),
    ),
  );
