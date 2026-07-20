import type { FieldHazardCohort226233MoveName } from '~~/server/domain/moveAutomation/specs/fieldHazardCohorts226_233'

export interface FieldHazardScenarioEvidence {
  readonly scenarioId: string
  readonly evidenceClasses: readonly string[]
}

export const MA_226_233_SCENARIOS_BY_MOVE: Readonly<Record<
  FieldHazardCohort226233MoveName,
  readonly FieldHazardScenarioEvidence[]
>> = Object.freeze({
  "Acid Armor": [{
    scenarioId: "acid-armor.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "self", "lifecycle-trigger", "lifecycle-cleanup"],
  }],
  "Aurora Veil": [{
    scenarioId: "aurora-veil.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "self", "ally", "lifecycle-trigger", "lifecycle-cleanup"],
  }],
  "Blizzard": [{
    scenarioId: "blizzard.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "hit", "miss", "crit", "immunity", "enemy", "area-mixed-outcomes", "threshold-pass", "threshold-fail"],
  }],
  "Camouflage": [{
    scenarioId: "camouflage.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "self", "choice", "pass", "reconnect", "alternate-branch"],
  }],
  "Court Change": [{
    scenarioId: "court-change.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict"],
  }],
  "Defog": [{
    scenarioId: "defog.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict"],
  }],
  "Electric Terrain": [{
    scenarioId: "electric-terrain.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "lifecycle-trigger", "lifecycle-cleanup"],
  }],
  "Floral Healing": [{
    scenarioId: "floral-healing.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "threshold-pass", "threshold-fail"],
  }],
  "Geomancy": [{
    scenarioId: "geomancy.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "self", "lifecycle-trigger", "lifecycle-cleanup"],
  }],
  "Grassy Glide": [{
    scenarioId: "grassy-glide.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "hit", "miss", "crit", "immunity", "enemy"],
  }],
  "Grassy Terrain": [{
    scenarioId: "grassy-terrain.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "lifecycle-trigger", "lifecycle-cleanup"],
  }],
  "Gravity": [{
    scenarioId: "gravity.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "lifecycle-trigger", "lifecycle-cleanup"],
  }],
  "Hail": [{
    scenarioId: "hail.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "lifecycle-trigger", "lifecycle-cleanup"],
  }],
  "Hurricane": [{
    scenarioId: "hurricane.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "hit", "miss", "crit", "immunity", "enemy", "area-mixed-outcomes", "threshold-pass", "threshold-fail"],
  }],
  "Inferno": [{
    scenarioId: "inferno.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "hit", "miss", "crit", "immunity", "enemy", "threshold-pass", "threshold-fail"],
  }],
  "Ion Deluge": [{
    scenarioId: "ion-deluge.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "lifecycle-trigger", "lifecycle-cleanup"],
  }],
  "Magic Room": [{
    scenarioId: "magic-room.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "lifecycle-trigger", "lifecycle-cleanup"],
  }],
  "Misty Explosion": [{
    scenarioId: "misty-explosion.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "hit", "miss", "crit", "immunity", "enemy", "area-mixed-outcomes", "lifecycle-trigger", "lifecycle-cleanup"],
  }],
  "Misty Terrain": [{
    scenarioId: "misty-terrain.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "lifecycle-trigger", "lifecycle-cleanup"],
  }],
  "Moonlight": [{
    scenarioId: "moonlight.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "self", "threshold-pass", "threshold-fail"],
  }],
  "Morning Sun": [{
    scenarioId: "morning-sun.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "self", "threshold-pass", "threshold-fail"],
  }],
  "Rain Dance": [{
    scenarioId: "rain-dance.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "lifecycle-trigger", "lifecycle-cleanup"],
  }],
  "Sandstorm": [{
    scenarioId: "sandstorm.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "lifecycle-trigger", "lifecycle-cleanup"],
  }],
  "Shore Up": [{
    scenarioId: "shore-up.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "self", "threshold-pass", "threshold-fail"],
  }],
  "Smokescreen": [{
    scenarioId: "smokescreen.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "lifecycle-trigger", "lifecycle-cleanup"],
  }],
  "Solar Beam": [{
    scenarioId: "solar-beam.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "hit", "miss", "crit", "immunity", "enemy", "threshold-pass", "threshold-fail", "lifecycle-trigger", "lifecycle-cleanup"],
  }],
  "Solar Blade": [{
    scenarioId: "solar-blade.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "hit", "miss", "crit", "immunity", "enemy", "threshold-pass", "threshold-fail", "lifecycle-trigger", "lifecycle-cleanup"],
  }],
  "Steel Roller": [{
    scenarioId: "steel-roller.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "hit", "miss", "crit", "immunity", "enemy", "threshold-pass", "threshold-fail"],
  }],
  "Sunny Day": [{
    scenarioId: "sunny-day.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "lifecycle-trigger", "lifecycle-cleanup"],
  }],
  "Tailwind": [{
    scenarioId: "tailwind.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "self", "ally", "lifecycle-trigger", "lifecycle-cleanup"],
  }],
  "Terrain Pulse": [{
    scenarioId: "terrain-pulse.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "hit", "miss", "crit", "immunity", "enemy", "area-mixed-outcomes", "choice", "pass", "reconnect", "alternate-branch", "threshold-pass", "threshold-fail"],
  }],
  "Thunder": [{
    scenarioId: "thunder.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "hit", "miss", "crit", "immunity", "enemy", "threshold-pass", "threshold-fail"],
  }],
  "Trick Room": [{
    scenarioId: "trick-room.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "lifecycle-trigger", "lifecycle-cleanup"],
  }],
  "Weather Ball": [{
    scenarioId: "weather-ball.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "hit", "miss", "crit", "immunity", "enemy", "choice", "pass", "reconnect", "alternate-branch", "threshold-pass", "threshold-fail"],
  }],
  "Wonder Room": [{
    scenarioId: "wonder-room.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "lifecycle-trigger", "lifecycle-cleanup"],
  }],
  "Zap Cannon": [{
    scenarioId: "zap-cannon.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "hit", "miss", "crit", "immunity", "enemy", "threshold-pass", "threshold-fail"],
  }],
  "Barrier": [{
    scenarioId: "barrier.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict"],
  }],
  "Ceaseless Edge": [{
    scenarioId: "ceaseless-edge.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "hit", "miss", "crit", "immunity", "enemy", "lifecycle-trigger", "lifecycle-cleanup"],
  }],
  "Fire Pledge": [{
    scenarioId: "fire-pledge.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "hit", "miss", "crit", "immunity", "enemy"],
  }],
  "Grass Pledge": [{
    scenarioId: "grass-pledge.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "hit", "miss", "crit", "immunity", "enemy"],
  }],
  "Spikes": [{
    scenarioId: "spikes.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "lifecycle-trigger", "lifecycle-cleanup"],
  }],
  "Stealth Rock": [{
    scenarioId: "stealth-rock.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "lifecycle-trigger", "lifecycle-cleanup"],
  }],
  "Sticky Web": [{
    scenarioId: "sticky-web.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "lifecycle-trigger", "lifecycle-cleanup"],
  }],
  "Stone Axe": [{
    scenarioId: "stone-axe.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "hit", "miss", "crit", "immunity", "enemy", "choice", "pass", "reconnect", "alternate-branch", "lifecycle-trigger", "lifecycle-cleanup"],
  }],
  "Toxic Spikes": [{
    scenarioId: "toxic-spikes.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "lifecycle-trigger", "lifecycle-cleanup"],
  }],
  "Water Pledge": [{
    scenarioId: "water-pledge.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "hit", "miss", "crit", "immunity", "enemy"],
  }],
  "Anchor Shot": [{
    scenarioId: "anchor-shot.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "hit", "miss", "crit", "immunity", "enemy"],
  }],
  "Aqua Ring": [{
    scenarioId: "aqua-ring.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "self", "lifecycle-trigger", "lifecycle-cleanup"],
  }],
  "Astral Barrage": [{
    scenarioId: "astral-barrage.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "hit", "miss", "crit", "immunity", "enemy", "area-mixed-outcomes"],
  }],
  "Bitter Malice": [{
    scenarioId: "bitter-malice.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "hit", "miss", "crit", "immunity", "enemy", "choice", "pass", "reconnect", "alternate-branch", "threshold-pass", "threshold-fail"],
  }],
  "Block": [{
    scenarioId: "block.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict"],
  }],
  "Burn Up": [{
    scenarioId: "burn-up.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "hit", "miss", "crit", "immunity", "enemy", "area-mixed-outcomes", "self", "lifecycle-trigger", "lifecycle-cleanup"],
  }],
  "Charge": [{
    scenarioId: "charge.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "self", "lifecycle-trigger", "lifecycle-cleanup"],
  }],
  "Clear Smog": [{
    scenarioId: "clear-smog.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "hit", "miss", "crit", "immunity", "enemy"],
  }],
})
