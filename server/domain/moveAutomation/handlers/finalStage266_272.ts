import type { EncounterCreatureRuleOverlayEffectPayload } from "#shared/moveAutomation/creatureRuleOverlayPayloads";
import type { EncounterEffectDuration } from "#shared/moveAutomation/encounterEffects";
import type {
  MoveCombatStageEffectOperation,
  MoveConditionEffectOperation,
  MoveEffectOperation,
  MoveTemporaryEffectOperation,
} from "#shared/moveAutomation/effects";
import { MOVE_SPEC_PHASES } from "#shared/moveAutomation/spec";
import type { PokemonTypeId } from "#shared/pokemonTypes";
import type {
  RegisteredMoveHandlerContext,
  RegisteredMoveHandlerRegistration,
} from "./registry";
import {
  reviewedCondition,
  reviewedDamage,
  reviewedStage,
  standardAccuracy,
  standardTerminalOperations,
} from "../specs/reviewedSpecBuilder";
export const FINAL_STAGE_266_272_HANDLER_ID =
  "ma266-272.final-stage-context" as const;
const sl = (n: string) =>
    n
      .normalize("NFKD")
      .replace(/[’']/g, "")
      .replace(/[^A-Za-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .toLowerCase(),
  order = (x: readonly MoveEffectOperation[]) =>
    [...x].sort(
      (a, b) =>
        MOVE_SPEC_PHASES.indexOf(a.phase) - MOVE_SPEC_PHASES.indexOf(b.phase),
    );
interface D {
  db: number;
  cls: "physical" | "special";
  type: PokemonTypeId;
  critical?: "always" | "18" | "even";
}
const D: Record<string, D> = {
  "Darkest Lariat": { db: 9, cls: "physical", type: "dark" },
  "Fell Stinger": { db: 5, cls: "physical", type: "bug" },
  "Fiery Dance": { db: 8, cls: "special", type: "fire" },
  "Foul Play": { db: 10, cls: "physical", type: "dark" },
  "Frost Breath": { db: 6, cls: "special", type: "ice", critical: "always" },
  "Hammer Arm": { db: 10, cls: "physical", type: "fighting" },
  "Ice Hammer": { db: 10, cls: "physical", type: "ice" },
  "Jaw Lock": { db: 8, cls: "physical", type: "dark" },
  "Metal Claw": { db: 5, cls: "physical", type: "steel" },
  "Ominous Wind": { db: 6, cls: "special", type: "ghost" },
  "Plasma Fists": { db: 10, cls: "physical", type: "electric" },
  "Power-Up Punch": { db: 4, cls: "physical", type: "fighting" },
  "Psychic Fangs": { db: 9, cls: "physical", type: "psychic" },
  "Silver Wind": { db: 6, cls: "special", type: "bug" },
  "Smack Down": { db: 5, cls: "physical", type: "rock" },
  "Snipe Shot": { db: 8, cls: "special", type: "water", critical: "18" },
  "Spacial Rend": { db: 10, cls: "special", type: "dragon", critical: "even" },
  "Storm Throw": {
    db: 6,
    cls: "physical",
    type: "fighting",
    critical: "always",
  },
  "Thousand Arrows": { db: 9, cls: "physical", type: "ground" },
  "Throat Chop": { db: 8, cls: "physical", type: "dark" },
  "Thunderous Kick": { db: 9, cls: "physical", type: "fighting" },
  "V-Create": { db: 18, cls: "physical", type: "fire" },
};
const attack = (n: string, type?: PokemonTypeId): MoveEffectOperation[] => {
  const d = D[n];
  if (!d) throw new Error(`Missing reviewed damage metadata for ${n}.`);
  const s = sl(n),
    critical =
      d.critical === "always"
        ? {
            trigger: { kind: "range" as const, minimum: 1 },
            prevention: "honor" as const,
          }
        : d.critical === "18"
          ? {
              trigger: { kind: "range" as const, minimum: 18 },
              prevention: "honor" as const,
            }
          : d.critical === "even"
            ? {
                trigger: {
                kind: "natural-rolls" as const,
                values: [2, 4, 6, 8, 10, 12, 14, 16, 18, 20],
              },
                prevention: "honor" as const,
              }
            : undefined;
  return [
    standardAccuracy(s),
    reviewedDamage({
      slug: s,
      damageBase: d.db,
      damageClass: d.cls,
      moveType: type ?? d.type,
      ...(critical ? { criticalHit: critical } : {}),
      ...(n === "Foul Play"
        ? {
            attackStat: {
              kind: "stat" as const,
              subject: { kind: "current-target" as const },
              stat: "attack" as const,
              combatStagePolicy: "honor" as const,
              stageModifierPolicy: "honor" as const,
            },
          }
        : {}),
      ...(n === "Darkest Lariat"
        ? {
            defenseStat: {
              kind: "stat" as const,
              subject: { kind: "current-target" as const },
              stat: "defense" as const,
              combatStagePolicy: "ignore-positive" as const,
              stageModifierPolicy: "honor" as const,
            },
          }
        : {}),
      ...(n === "Thousand Arrows"
        ? {
            typeEffectiveness: {
              immunity: "ignore",
              resistance: "honor",
              weakness: "honor",
              passiveImmunity: "ignore",
              effectivenessOverride: null,
              defenderTypeOverrides: [
                { defenderType: "flying", relation: "neutral" },
              ],
            },
          }
        : {}),
    }),
  ];
};
const stageSets: Record<
  string,
  Array<["atk" | "def" | "satk" | "sdef" | "spd" | "all-stats", number]>
> = {
  "Defend Order": [
    ["def", 1],
    ["sdef", 1],
  ],
  "Dragon Dance": [
    ["atk", 1],
    ["spd", 1],
  ],
  Growth: [
    ["atk", 1],
    ["satk", 1],
  ],
  "Hammer Arm": [["spd", -1]],
  Harden: [["def", 1]],
  "Ice Hammer": [["spd", -1]],
  "Iron Defense": [["def", 2]],
  Meditate: [["atk", 1]],
  "Nasty Plot": [["satk", 2]],
  "Power-Up Punch": [["atk", 1]],
  "Quiver Dance": [
    ["satk", 1],
    ["sdef", 1],
    ["spd", 1],
  ],
  "Rock Polish": [["spd", 2]],
  Sharpen: [["atk", 1]],
  "Shell Smash": [
    ["atk", 2],
    ["satk", 2],
    ["spd", 2],
    ["def", -1],
    ["sdef", -1],
  ],
  Shelter: [
    ["def", 1],
    ["sdef", 1],
  ],
  "Tail Glow": [["satk", 3]],
  "Take Heart": [["all-stats", 1]],
  "Thunderous Kick": [["def", -1]],
  "V-Create": [
    ["def", -1],
    ["sdef", -1],
    ["spd", -1],
  ],
  Withdraw: [["def", 1]],
  "Work Up": [
    ["atk", 1],
    ["satk", 1],
  ],
};
const stageOps = (n: string, mult = 1): MoveEffectOperation[] => {
  const s = sl(n),
    actor = !["Thunderous Kick"].includes(n),
    source = D[n] ? `${s}.damage` : undefined;
  return (stageSets[n] ?? []).map(([stage, value], i) =>
    reviewedStage({
      slug: s,
      id: `stage-${stage}-${i}`,
      recipients: actor ? "actor" : "hit-targets",
      stage,
      value: value * mult,
      phase: D[n] ? "after-damage" : "hit",
      ...(source ? { sourceOperationId: source } : {}),
      ...(actor ? {} : { applyTypeImmunity: true }),
    }),
  );
};
const overlay = (
  s: string,
  id: string,
  recipients: "actor" | "hit-targets",
  payload: EncounterCreatureRuleOverlayEffectPayload,
  duration: EncounterEffectDuration = { kind: "scene", remaining: null },
): MoveTemporaryEffectOperation => ({
  id: `${s}.${id}`,
  kind: "temporary-effect",
  source: { kind: "move", id: `move.${s}` },
  recipients: { kind: recipients },
  phase: "schedule",
  reasonCode: `${s}.${id}`,
  payload: {
    action: "add",
    effectId: `${s}.${id}`,
    recipientScope: "placements",
    definition: {
      kind: "creature-rule-overlay",
      duration,
      stacks: 1,
      charges: null,
      stackPolicy: { kind: "replace", maxStacks: null },
      chargePolicy: { kind: "none", amount: null },
      tags: [s, id],
      payload,
      dispel: { policy: "matching-tags", tags: [s, id] },
      transferPolicy: "expire",
    },
  },
});
const marker = (
  s: string,
  id: string,
  recipients: "actor" | "hit-targets" = "actor",
  duration: EncounterEffectDuration = {
    kind: "turns",
    subject: "source",
    boundary: "end",
    remaining: 1,
  },
): MoveTemporaryEffectOperation => ({
  id: `${s}.${id}`,
  kind: "temporary-effect",
  source: { kind: "move", id: `move.${s}` },
  recipients: { kind: recipients },
  phase: "schedule",
  reasonCode: `${s}.${id}`,
  payload: {
    action: "add",
    effectId: `${s}.${id}`,
    recipientScope: "placements",
    definition: {
      kind: "condition",
      duration,
      stacks: 1,
      charges: null,
      stackPolicy: { kind: "replace", maxStacks: null },
      chargePolicy: { kind: "none", amount: null },
      tags: [s, id],
      payload: { conditionId: id, action: "apply", saveTiming: null },
      dispel: { policy: "matching-tags", tags: [s, id] },
      transferPolicy: "expire",
    },
  },
});
const numeric = (
  s: string,
  id: string,
  attribute: "evasion" | "initiative",
  value: number,
  duration: EncounterEffectDuration,
  recipients: "actor" | "hit-targets" = "actor",
): MoveTemporaryEffectOperation => ({
  id: `${s}.${id}`,
  kind: "temporary-effect",
  source: { kind: "move", id: `move.${s}` },
  recipients: { kind: recipients },
  phase: "schedule",
  reasonCode: `${s}.${id}`,
  payload: {
    action: "add",
    effectId: `${s}.${id}`,
    recipientScope: "placements",
    definition: {
      kind: "numeric-modifier",
      duration,
      stacks: 1,
      charges: null,
      stackPolicy: { kind: "replace", maxStacks: null },
      chargePolicy: { kind: "none", amount: null },
      tags: [s, id],
      payload: {
        attribute,
        operation: attribute === "initiative" ? "set" : "add",
        value,
        rounding: "none",
      },
      dispel: { policy: "matching-tags", tags: [s, id] },
      transferPolicy: "expire",
    },
  },
});
const clear = (s: string): MoveConditionEffectOperation => ({
  id: `${s}.clear-status`,
  kind: "condition",
  source: { kind: "move", id: `move.${s}` },
  recipients: { kind: "actor" },
  phase: "hit",
  reasonCode: `${s}.clear-status`,
  payload: {
    action: "clear",
    conditionId: null,
    conditionSource: null,
    filter: { groups: ["persistent", "volatile"], conditionIds: [], excludedConditionIds: [] },
    randomChoice: null,
    duration: null,
    saveTiming: "canonical",
    stackPolicy: { kind: "refresh", maxStacks: null },
  },
});
const swap = (
  s: string,
  stage: "atk" | "def" | "satk" | "sdef",
): MoveCombatStageEffectOperation => ({
  id: `${s}.swap-${stage}`,
  kind: "combat-stage",
  source: { kind: "move", id: `move.${s}` },
  recipients: { kind: "actor-and-attacked-targets" },
  phase: "hit",
  reasonCode: `${s}.swap-${stage}`,
  payload: {
    action: "swap",
    stage,
    selectedStage: null,
    value: null,
    stageSource: null,
    rounding: null,
  },
});
const target = (c: RegisteredMoveHandlerContext) => {
  const p = c.selectedPlacements[0];
  if (!p) throw Error("target required");
  return p;
};
const ability = (
  c: RegisteredMoveHandlerContext,
  n: string,
): MoveTemporaryEffectOperation => {
  const s = sl(n);
  let val =
    n === "Simple Beam"
      ? "Simple"
      : n === "Worry Seed"
        ? "Insomnia"
        : (c.actor.token.abilityNames?.[0] ?? "Unknown");
  return overlay(
    s,
    "ability",
    "hit-targets",
    {
      domain: "ability",
      action: "replace",
      values: [val],
      referencePlacementId: null,
      suppressionScope: null,
    },
    {
      kind: "turns",
      subject: "source",
      boundary: "end",
      remaining: n === "Entrainment" ? 3 : 999,
    },
  );
};
const typeAdd = (
  s: string,
  type: PokemonTypeId,
): MoveTemporaryEffectOperation =>
  overlay(
    s,
    "type",
    "hit-targets",
    {
      domain: "type",
      action: "add",
      values: [type],
      referencePlacementId: null,
      suppressionScope: null,
    },
    { kind: "turns", subject: "source", boundary: "end", remaining: 5 },
  );
const run = (c: RegisteredMoveHandlerContext) => {
  const n = c.intent.moveName,
    s = sl(n);
  let ops: MoveEffectOperation[] = [];
  if (D[n]) {
    let type: PokemonTypeId | undefined;
    if (
      n === "Thunderous Kick" &&
      c.intent.targetBranchId === "electric"
    )
      type = "electric";
    ops.push(...attack(n, type));
    if (stageSets[n]) ops.push(...stageOps(n));
    if (n === "Fell Stinger")
      ops.push(
        reviewedStage({
          slug: s,
          id: "knockout-attack",
          recipients: "actor",
          stage: "atk",
          value: 2,
          sourceOperationId: `${s}.damage`,
          trigger: {
            kind: "operation-outcome",
            operationId: `${s}.damage`,
            outcome: "applied",
          },
        }),
      );
    if (n === "Fiery Dance")
      ops.push(
        reviewedStage({
          slug: s,
          id: "raise-special-attack",
          recipients: "actor",
          stage: "satk",
          value: 1,
          sourceOperationId: `${s}.damage`,
          trigger: {
            kind: "accuracy-roll",
            rollId: `${s}.accuracy-roll`,
            trigger: {
              kind: "natural-rolls",
              values: [2, 4, 6, 8, 10, 12, 14, 16, 18, 20],
            },
            scope: "resolution",
            application: "once",
          },
        }),
      );
    if (n === "Metal Claw")
      ops.push(
        reviewedStage({
          slug: s,
          id: "raise-attack",
          recipients: "actor",
          stage: "atk",
          value: 1,
          sourceOperationId: `${s}.damage`,
          trigger: {
            kind: "accuracy-roll",
            rollId: `${s}.accuracy-roll`,
            trigger: { kind: "range", minimum: 18 },
            scope: "resolution",
            application: "once",
          },
        }),
      );
    if (n === "Ominous Wind" || n === "Silver Wind")
      ops.push(
        reviewedStage({
          slug: s,
          id: "raise-all",
          recipients: "actor",
          stage: "all-stats",
          value: 1,
          sourceOperationId: `${s}.damage`,
          trigger: {
            kind: "accuracy-roll",
            rollId: `${s}.accuracy-roll`,
            trigger: { kind: "range", minimum: 19 },
            scope: "resolution",
            application: "once",
          },
        }),
      );
    if (n === "Jaw Lock")
      ops.push(marker(s, "grapple-maneuver", "hit-targets"));
    if (n === "Plasma Fists")
      ops.push(
        marker(s, "next-normal-becomes-electric", "hit-targets", {
          kind: "until-triggered",
          remaining: null,
        }),
      );
    if (n === "Psychic Fangs") ops.push(marker(s, "shield-bypass"));
    if (n === "Smack Down" || n === "Thousand Arrows")
      ops.push(
        marker(s, "grounded", "hit-targets", {
          kind: "turns",
          subject: "source",
          boundary: "end",
          remaining: 3,
        }),
      );
    if (n === "Snipe Shot") ops.push(marker(s, "target-lock"));
    if (n === "Throat Chop")
      ops.push(
        overlay(
          s,
          "sonic-lock",
          "hit-targets",
          { domain: "sonic-lock", action: "lock" },
          { kind: "turns", subject: "source", boundary: "end", remaining: 2 },
        ),
      );
  } else if (stageSets[n]) {
    let mult = 1;
    if (
      n === "Growth" &&
      c.queries.weather.active().some((x) => x.kind === "sunny")
    )
      mult = 2;
    ops.push(...stageOps(n, mult));
    if (n === "Shelter")
      ops.push(
        numeric(s, "evasion", "evasion", 2, { kind: "scene", remaining: null }),
      );
    if (n === "Take Heart") ops.push(clear(s));
  } else if (n === "Entrainment" || n === "Simple Beam" || n === "Worry Seed")
    ops.push(standardAccuracy(s), ability(c, n));
  else if (n === "Magic Powder")
    ops.push(standardAccuracy(s), typeAdd(s, "psychic"));
  else if (n === "Soak") ops.push(standardAccuracy(s), typeAdd(s, "water"));
  else if (n === "Magnet Rise")
    ops.push(
      standardAccuracy(s),
      overlay(
        s,
        "levitate",
        "actor",
        {
          domain: "ability",
          action: "add",
          values: ["Levitate"],
          referencePlacementId: null,
          suppressionScope: null,
        },
        { kind: "turns", subject: "source", boundary: "end", remaining: 5 },
      ),
    );
  else if (n === "Minimize")
    ops.push(
      numeric(s, "evasion", "evasion", 4, { kind: "scene", remaining: null }),
      overlay(s, "small", "actor", {
        domain: "size",
        action: "replace",
        value: "small",
        referencePlacementId: null,
      }),
    );
  else if (n === "Foresight" || n === "Miracle Eye" || n === "Odor Sleuth")
    ops.push(marker(s, "immunity-and-illusion-bypass"));
  else if (n === "Guard Swap") ops.push(swap(s, "def"), swap(s, "sdef"));
  else if (n === "Power Swap") ops.push(swap(s, "atk"), swap(s, "satk"));
  else if (n === "Psych Up") {
    for (const st of ["atk", "def", "satk", "sdef", "spd", "acc"] as const)
      ops.push({
        id: `${s}.copy-${st}`,
        kind: "combat-stage",
        source: { kind: "move", id: `move.${s}` },
        recipients: { kind: "actor" },
        phase: "hit",
        reasonCode: `${s}.copy-${st}`,
        payload: {
          action: "copy",
          stage: st,
          selectedStage: null,
          value: null,
          stageSource: { kind: "selected-targets" },
          rounding: null,
        },
      });
  } else if (n === "Reflect Type") {
    const state = c.queries.targetStates.resolve(target(c).id),
      type = (state?.typeIds?.[0] ?? "normal") as PokemonTypeId;
    ops.push(
      standardAccuracy(s),
      overlay(s, "reflected-type", "actor", {
        domain: "type",
        action: "replace",
        values: [type],
        referencePlacementId: null,
        suppressionScope: null,
      }),
    );
  } else if (n === "Refresh") ops.push(clear(s));
  else if (n === "Quash")
    ops.push(
      standardAccuracy(s),
      numeric(
        s,
        "initiative",
        "initiative",
        0,
        { kind: "rounds", boundary: "end", remaining: 1 },
        "hit-targets",
      ),
    );
  else if (n === "Speed Swap")
    ops.push(
      standardAccuracy(s),
      marker(s, "initiative-swap", "hit-targets", {
        kind: "rounds",
        boundary: "end",
        remaining: 1,
      }),
    );
  ops.push(...standardTerminalOperations(s));
  return {
    operations: order(ops),
    traceEntries: [
      {
        kind: "predicate" as const,
        phase: "declare" as const,
        predicateId: `final-stage.${s}`,
        outcome: true,
        reasonCode: "final-stage.authoritative-context-resolved",
        input: { operationCount: ops.length },
      },
    ],
  };
};
export const FINAL_STAGE_266_272_HANDLER_REGISTRATION: RegisteredMoveHandlerRegistration =
  Object.freeze({ id: FINAL_STAGE_266_272_HANDLER_ID, version: 1, run });
