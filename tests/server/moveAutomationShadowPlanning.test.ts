import { describe, expect, it, vi } from "vitest";
import manifestJson from "../../data/move-automation/manifest.json";
import legacyFingerprintsJson from "../../data/move-automation/legacy-v1-fingerprints.json";
import type { MoveAutomationManifest } from "#shared/moveAutomation/manifest";
import { scratchV2PassHitFixture } from "../fixtures/moveAutomation/scratchV2";
import { createFiniteAuthoritativeMoveRandomStream } from "~~/server/domain/moveAutomation/random";
import {
  createMoveAutomationRuntimeRegistry,
  REVIEWED_MOVE_SPEC_V2_REGISTRATIONS,
} from "~~/server/domain/moveAutomation/registry";
import { planMoveWithDevelopmentShadow } from "~~/server/domain/moveAutomation/shadowPlanning";
import { EXPLICIT_MOVE_AUTOMATION_REGISTRY_SOURCES } from "~/utils/move-automation/registry";
const registry = (legacy: boolean) => {
  const manifest = structuredClone(
    manifestJson,
  ) as unknown as MoveAutomationManifest;
  if (legacy) {
    const row = manifest.moves.find((x) => x.canonicalId === "Scratch")!,
      fp = legacyFingerprintsJson.entries.find(
        (x) => x.canonicalId === "Scratch",
      )!;
    (row as { runtime: unknown }).runtime = {
      kind: "legacy-v1",
      version: fp.version,
      definitionHash: fp.definitionHash,
      sourceModule: fp.sourceModule,
    };
  }
  return createMoveAutomationRuntimeRegistry({
    manifest,
    legacySources: EXPLICIT_MOVE_AUTOMATION_REGISTRY_SOURCES,
    moveSpecs: REVIEWED_MOVE_SPEC_V2_REGISTRATIONS,
  });
};
describe("development move shadow planning", () => {
  it("compares seeded legacy/v2 plans and returns only the selected immutable plan", () => {
    const fixture = scratchV2PassHitFixture(),
      diagnostic = vi.fn(),
      before = structuredClone(fixture.map);
    const plan = planMoveWithDevelopmentShadow({
      ...fixture,
      operationId: "op_shadowplanning1",
      now: () => 5_000,
      selectedRuntimeRegistry: registry(false),
      shadowRuntimeRegistry: registry(true),
      randomFactory: () =>
        createFiniteAuthoritativeMoveRandomStream(fixture.randomValues),
      environment: "test",
      onDiagnostic: diagnostic,
    });
    expect(plan.resolution.auditTrace.program.runtimeKind).toBe("movespec-v2");
    expect(fixture.map).toEqual(before);
    expect(diagnostic).toHaveBeenCalledOnce();
    expect(diagnostic.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        canonicalId: "Scratch",
        selectedRuntime: "movespec-v2:v2",
        shadowRuntime: "legacy-v1:v1",
        selectedDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
        shadowDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expect(JSON.stringify(diagnostic.mock.calls[0]?.[0])).not.toContain(
      "currentHp",
    );
  });
  it("cannot execute a shadow planner in production", () => {
    const fixture = scratchV2PassHitFixture(),
      diagnostic = vi.fn(),
      sourceShadow = registry(true),
      resolve = vi.fn(sourceShadow.resolve),
      shadow = {
        size: sourceShadow.size,
        handlerRegistry: sourceShadow.handlerRegistry,
        resolve,
        entries: sourceShadow.entries,
      };
    const plan = planMoveWithDevelopmentShadow({
      ...fixture,
      operationId: "op_shadowplanning2",
      now: () => 5_000,
      selectedRuntimeRegistry: registry(false),
      shadowRuntimeRegistry: shadow,
      randomFactory: () =>
        createFiniteAuthoritativeMoveRandomStream(fixture.randomValues),
      environment: "production",
      onDiagnostic: diagnostic,
    });
    expect(plan.resolution.auditTrace.program.runtimeKind).toBe("movespec-v2");
    expect(diagnostic).not.toHaveBeenCalled();
    expect(resolve).not.toHaveBeenCalled();
  });
});
