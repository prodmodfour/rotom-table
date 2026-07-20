import type { HpCohort211217MoveName } from '~~/server/domain/moveAutomation/specs/hpCohorts211_217'

export interface HpCohortScenarioEvidence {
  readonly scenarioId: string
  readonly evidenceClasses: readonly string[]
}

export const MA_211_217_SCENARIOS_BY_MOVE: Readonly<Record<
  HpCohort211217MoveName,
  readonly HpCohortScenarioEvidence[]
>> = Object.freeze({
  "Belly Drum": [{
    scenarioId: "belly-drum.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "self"],
  }],
  "Bind": [{
    scenarioId: "bind.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict"],
  }],
  "Brine": [{
    scenarioId: "brine.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "hit", "miss", "crit", "immunity", "enemy", "threshold-pass", "threshold-fail"],
  }],
  "Chloroblast": [{
    scenarioId: "chloroblast.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "hit", "miss", "crit", "immunity", "area-mixed-outcomes", "self", "enemy"],
  }],
  "Clamp": [{
    scenarioId: "clamp.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict"],
  }],
  "Clangorous Soul": [{
    scenarioId: "clangorous-soul.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "self"],
  }],
  "Crush Grip": [{
    scenarioId: "crush-grip.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "hit", "miss", "crit", "immunity", "enemy", "threshold-pass", "threshold-fail"],
  }],
  "Dragon Energy": [{
    scenarioId: "dragon-energy.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "hit", "miss", "crit", "immunity", "area-mixed-outcomes", "enemy", "threshold-pass", "threshold-fail"],
  }],
  "Drain Punch": [{
    scenarioId: "drain-punch.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "hit", "miss", "crit", "immunity", "enemy"],
  }],
  "Draining Kiss": [{
    scenarioId: "draining-kiss.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "hit", "miss", "crit", "immunity", "enemy"],
  }],
  "Dream Eater": [{
    scenarioId: "dream-eater.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "hit", "miss", "crit", "immunity", "enemy", "threshold-pass", "threshold-fail"],
  }],
  "Eruption": [{
    scenarioId: "eruption.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "hit", "miss", "crit", "immunity", "area-mixed-outcomes", "enemy", "threshold-pass", "threshold-fail"],
  }],
  "Explosion": [{
    scenarioId: "explosion.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "hit", "miss", "crit", "immunity", "area-mixed-outcomes", "self", "enemy"],
  }],
  "Final Gambit": [{
    scenarioId: "final-gambit.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "hit", "miss", "crit", "immunity", "self", "enemy"],
  }],
  "Flame Burst": [{
    scenarioId: "flame-burst.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "hit", "miss", "crit", "immunity", "enemy"],
  }],
  "Giga Drain": [{
    scenarioId: "giga-drain.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "hit", "miss", "crit", "immunity", "enemy"],
  }],
  "Heal Order": [{
    scenarioId: "heal-order.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "self"],
  }],
  "Heal Pulse": [{
    scenarioId: "heal-pulse.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "ally"],
  }],
  "Hold Hands": [{
    scenarioId: "hold-hands.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "self", "ally", "lifecycle-trigger", "lifecycle-cleanup"],
  }],
  "Jungle Healing": [{
    scenarioId: "jungle-healing.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "area-mixed-outcomes", "self", "ally"],
  }],
  "Leech Life": [{
    scenarioId: "leech-life.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "hit", "miss", "crit", "immunity", "enemy"],
  }],
  "Life Dew": [{
    scenarioId: "life-dew.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "area-mixed-outcomes", "self", "ally"],
  }],
  "Light of Ruin": [{
    scenarioId: "light-of-ruin.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "hit", "miss", "crit", "immunity", "area-mixed-outcomes", "self", "enemy"],
  }],
  "Mega Drain": [{
    scenarioId: "mega-drain.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "hit", "miss", "crit", "immunity", "enemy"],
  }],
  "Metal Burst": [{
    scenarioId: "metal-burst.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict"],
  }],
  "Milk Drink": [{
    scenarioId: "milk-drink.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "ally"],
  }],
  "Mind Blown": [{
    scenarioId: "mind-blown.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "hit", "miss", "crit", "immunity", "area-mixed-outcomes", "self", "enemy"],
  }],
  "Mystical Power": [{
    scenarioId: "mystical-power.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "hit", "miss", "crit", "immunity", "self", "enemy", "alternate-branch", "choice", "pass", "reconnect"],
  }],
  "Nature’s Madness": [{
    scenarioId: "natures-madness.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "hit", "miss", "crit", "immunity", "enemy"],
  }],
  "Night Shade": [{
    scenarioId: "night-shade.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "hit", "miss", "crit", "immunity", "enemy"],
  }],
  "Oblivion Wing": [{
    scenarioId: "oblivion-wing.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "hit", "miss", "crit", "immunity", "enemy"],
  }],
  "Pain Split": [{
    scenarioId: "pain-split.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "self", "ally"],
  }],
  "Parabolic Charge": [{
    scenarioId: "parabolic-charge.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "hit", "miss", "crit", "immunity", "area-mixed-outcomes", "enemy"],
  }],
  "Pollen Puff": [{
    scenarioId: "pollen-puff.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "hit", "miss", "crit", "immunity", "ally", "enemy", "alternate-branch"],
  }],
  "Purify": [{
    scenarioId: "purify.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "ally"],
  }],
  "Recover": [{
    scenarioId: "recover.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "self"],
  }],
  "Relic Song": [{
    scenarioId: "relic-song.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "hit", "miss", "crit", "immunity", "area-mixed-outcomes", "self", "enemy", "alternate-branch", "choice", "pass", "reconnect", "threshold-pass", "threshold-fail", "lifecycle-trigger", "lifecycle-cleanup"],
  }],
  "Seismic Toss": [{
    scenarioId: "seismic-toss.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "hit", "miss", "crit", "immunity", "enemy"],
  }],
  "Self-Destruct": [{
    scenarioId: "self-destruct.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "hit", "miss", "crit", "immunity", "area-mixed-outcomes", "self", "enemy"],
  }],
  "Slack Off": [{
    scenarioId: "slack-off.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "self"],
  }],
  "Soft-Boiled": [{
    scenarioId: "soft-boiled.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "ally"],
  }],
  "Steel Beam": [{
    scenarioId: "steel-beam.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "hit", "miss", "crit", "immunity", "area-mixed-outcomes", "self", "enemy"],
  }],
  "Strength Sap": [{
    scenarioId: "strength-sap.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "ally", "enemy", "alternate-branch", "choice", "pass", "reconnect"],
  }],
  "Submission": [{
    scenarioId: "submission.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "hit", "miss", "crit", "immunity", "enemy", "threshold-pass", "threshold-fail"],
  }],
  "Super Fang": [{
    scenarioId: "super-fang.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "hit", "miss", "crit", "immunity", "enemy"],
  }],
  "Toxic Thread": [{
    scenarioId: "toxic-thread.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "enemy", "alternate-branch", "threshold-pass", "threshold-fail"],
  }],
  "Water Spout": [{
    scenarioId: "water-spout.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "hit", "miss", "crit", "immunity", "enemy", "threshold-pass", "threshold-fail"],
  }],
  "Wave Crash": [{
    scenarioId: "wave-crash.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "hit", "miss", "crit", "immunity", "enemy"],
  }],
  "Wrap": [{
    scenarioId: "wrap.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict"],
  }],
  "Wring Out": [{
    scenarioId: "wring-out.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "hit", "miss", "crit", "immunity", "enemy", "threshold-pass", "threshold-fail"],
  }],
})
