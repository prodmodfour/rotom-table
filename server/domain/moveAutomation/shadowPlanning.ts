import { createHash } from "node:crypto";
import type { AuthoritativeMoveRandomSource } from "./random";
import {
  planAuthoritativeMoveState,
  type AuthoritativeMoveStatePlan,
  type PlanAuthoritativeMoveStateInput,
} from "../planAuthoritativeMoveState";
import type { MoveAutomationRuntimeRegistry } from "./registry";

export interface MoveAutomationShadowDiagnostic {
  readonly code: "move-shadow-plan-match" | "move-shadow-plan-mismatch";
  readonly canonicalId: string;
  readonly selectedRuntime: string;
  readonly shadowRuntime: string;
  readonly selectedDigest: string;
  readonly shadowDigest: string;
  readonly selectedChangeCount: number;
  readonly shadowChangeCount: number;
}

export interface PlanMoveWithDevelopmentShadowInput extends Omit<
  PlanAuthoritativeMoveStateInput,
  "random" | "runtimeRegistry"
> {
  readonly selectedRuntimeRegistry: MoveAutomationRuntimeRegistry;
  readonly shadowRuntimeRegistry: MoveAutomationRuntimeRegistry;
  /** Each factory must return an independent stream seeded with the same draws. */
  readonly randomFactory: () => AuthoritativeMoveRandomSource;
  readonly environment?: string;
  readonly onDiagnostic?: (diagnostic: MoveAutomationShadowDiagnostic) => void;
}

const stableValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(
        ([key]) =>
          ![
            "updatedAt",
            "scriptKind",
            "scriptVersion",
            "definitionHash",
          ].includes(key),
      )
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, stableValue(entry)]),
  );
};

/** Hash mechanics privately; diagnostics never expose sheets, targets, HP, choices, or command bodies. */
export const moveAutomationShadowPlanDigest = (
  plan: AuthoritativeMoveStatePlan,
): string => {
  const nextMap = structuredClone(plan.nextMap);
  delete nextMap.metadata;
  const projection = stableValue({
    map: nextMap,
    sheets: plan.sheetWrites.map((write) => ({
      kind: write.kind,
      slug: write.slug,
      changedFields: write.changedFields,
      current: write.nextSheet,
    })),
    transaction: plan.resolution.transaction,
    movement: plan.resolution.movement,
    usage: plan.usage,
  });
  return createHash("sha256").update(JSON.stringify(projection)).digest("hex");
};

/**
 * Development-only dual planning. Both planners receive detached snapshots and
 * independent seeded streams; only the manifest-selected plan is returned.
 * This function has no repository dependency and therefore cannot persist the
 * shadow plan or spend a second resource set.
 */
export const planMoveWithDevelopmentShadow = (
  input: PlanMoveWithDevelopmentShadowInput,
): AuthoritativeMoveStatePlan => {
  const environment =
    input.environment ?? process.env.NODE_ENV ?? "development";
  const selectedRuntime = input.selectedRuntimeRegistry.resolve(
    input.intent.moveName,
  );
  if (environment === "production") {
    return planAuthoritativeMoveState({
      ...input,
      random: input.randomFactory(),
      runtimeRegistry: input.selectedRuntimeRegistry,
    });
  }

  const detachedBase = (): PlanAuthoritativeMoveStateInput => ({
    ...input,
    map: structuredClone(input.map),
    pokemonSheets: new Map(
      [...input.pokemonSheets].map(([key, sheet]) => [
        key,
        structuredClone(sheet),
      ]),
    ),
    trainerSheets: new Map(
      [...input.trainerSheets].map(([key, sheet]) => [
        key,
        structuredClone(sheet),
      ]),
    ),
    intent: structuredClone(input.intent),
  });
  const selected = planAuthoritativeMoveState({
    ...detachedBase(),
    random: input.randomFactory(),
    runtimeRegistry: input.selectedRuntimeRegistry,
  });
  const shadow = planAuthoritativeMoveState({
    ...detachedBase(),
    random: input.randomFactory(),
    runtimeRegistry: input.shadowRuntimeRegistry,
  });
  const shadowRuntime = input.shadowRuntimeRegistry.resolve(
    input.intent.moveName,
  );
  const selectedDigest = moveAutomationShadowPlanDigest(selected);
  const shadowDigest = moveAutomationShadowPlanDigest(shadow);
  input.onDiagnostic?.({
    code:
      selectedDigest === shadowDigest
        ? "move-shadow-plan-match"
        : "move-shadow-plan-mismatch",
    canonicalId: input.intent.moveName,
    selectedRuntime: selectedRuntime
      ? `${selectedRuntime.kind}:v${selectedRuntime.version}`
      : "missing",
    shadowRuntime: shadowRuntime
      ? `${shadowRuntime.kind}:v${shadowRuntime.version}`
      : "missing",
    selectedDigest,
    shadowDigest,
    selectedChangeCount: selected.stateChanges.changes.length,
    shadowChangeCount: shadow.stateChanges.changes.length,
  });
  return selected;
};
