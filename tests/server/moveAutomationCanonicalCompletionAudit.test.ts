import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import manifestJson from "../../data/move-automation/manifest.json";
import capabilitiesJson from "../../data/move-automation/capabilities.json";
import movesJson from "../../data/reference/moves.json";
import { REGISTERED_MOVE_HANDLER_REGISTRY } from "~~/server/domain/moveAutomation/handlers/registry";
import {
  MOVE_AUTOMATION_RUNTIME_REGISTRY,
  REVIEWED_MOVE_SPEC_V2_REGISTRATIONS,
} from "~~/server/domain/moveAutomation/registry";
const root = resolve(import.meta.dirname, "../..");
describe("canonical 776 completion contract audit", () => {
  it("has one debt-free complete row in frozen canonical order", () => {
    const canonical = Object.keys(movesJson)
      .filter(name => name !== 'The first line contains the Name of the Move. This')
      .sort();
    expect(canonical).toHaveLength(776);
    expect(manifestJson.moves).toHaveLength(776);
    expect(manifestJson.moves.map((row) => row.canonicalId)).toEqual(canonical);
    for (const row of manifestJson.moves) {
      expect(row.baseStatus, row.canonicalId).toBe("complete");
      expect(row.blockerCodes, row.canonicalId).toEqual([]);
      expect(row.limitations, row.canonicalId).toEqual([]);
      expect(row.manualSteps, row.canonicalId).toEqual([]);
      expect(row.scenarioIds.length, row.canonicalId).toBeGreaterThan(0);
      expect(
        row.conformanceEvidence.scenarios.length,
        row.canonicalId,
      ).toBeGreaterThan(0);
      expect(row.unsupportedInteractionIds, row.canonicalId).toEqual([]);
    }
  });
  it("links every row to exactly one existing runtime source and matching normalized hash", () => {
    expect(MOVE_AUTOMATION_RUNTIME_REGISTRY.size).toBe(776);
    const entries = MOVE_AUTOMATION_RUNTIME_REGISTRY.entries();
    expect(new Set(entries.map((entry) => entry.canonicalId)).size).toBe(776);
    for (const row of manifestJson.moves) {
      const runtime = MOVE_AUTOMATION_RUNTIME_REGISTRY.resolve(row.canonicalId);
      expect(runtime, row.canonicalId).not.toBeNull();
      expect(runtime, row.canonicalId).toMatchObject({
        canonicalId: row.canonicalId,
        kind: row.runtime.kind,
        version: row.runtime.version,
        definitionHash: row.runtime.definitionHash,
        sourceModule: row.runtime.sourceModule,
      });
      expect(
        existsSync(resolve(root, row.runtime.sourceModule!)),
        `${row.canonicalId}: ${row.runtime.sourceModule}`,
      ).toBe(true);
    }
  });
  it("has unique v2 definitions and every referenced handler registered", () => {
    const ids = REVIEWED_MOVE_SPEC_V2_REGISTRATIONS.map(
      (item) => item.canonicalId,
    );
    expect(new Set(ids).size).toBe(ids.length);
    for (const registration of REVIEWED_MOVE_SPEC_V2_REGISTRATIONS) {
      const runtime = MOVE_AUTOMATION_RUNTIME_REGISTRY.resolve(
        registration.canonicalId,
      );
      expect(runtime?.kind, registration.canonicalId).toBe("movespec-v2");
      if (runtime?.kind !== "movespec-v2") continue;
      const handlerId = runtime.definition.spec.registeredHandlerId;
      if (handlerId)
        expect(
          REGISTERED_MOVE_HANDLER_REGISTRY.resolve(handlerId),
          registration.canonicalId,
        ).toMatchObject({ id: handlerId });
    }
  });
  it("uses only implemented capabilities and resolvable executable scenario IDs", () => {
    const capabilityStatus = new Map(
      capabilitiesJson.capabilities.map((item) => [
        item.code,
        item.implementationStatus,
      ]),
    );
    const allScenarioSources =
      readFileSync(
        resolve(root, "data/move-automation/scenario-requirements.json"),
        "utf8",
      ) + findScenarioSourceText();
    for (const row of manifestJson.moves) {
      for (const capability of row.capabilityTags)
        expect(
          capabilityStatus.get(capability),
          `${row.canonicalId}: ${capability}`,
        ).toBe("implemented");
      for (const scenarioId of row.scenarioIds)
        expect(
          allScenarioSources,
          `${row.canonicalId}: ${scenarioId}`,
        ).toContain(scenarioId);
    }
  });
});
const findScenarioSourceText = (): string => {
  const walk = (directory: string): string =>
    readdirSync(directory)
      .map((name) => {
        const path = resolve(directory, name);
        return statSync(path).isDirectory()
          ? walk(path)
          : /\.(ts|json)$/.test(name)
            ? readFileSync(path, "utf8")
            : "";
      })
      .join("\n");
  return walk(resolve(root, "tests/fixtures/moveAutomation"));
};
