import type { DynamicDamageCohort218225MoveName } from '~~/server/domain/moveAutomation/specs/dynamicDamageCohorts218_225'

export interface DynamicDamageScenarioEvidence {
  readonly scenarioId: string
  readonly evidenceClasses: readonly string[]
}

export const MA_218_225_SCENARIOS_BY_MOVE: Readonly<Record<
  DynamicDamageCohort218225MoveName,
  readonly DynamicDamageScenarioEvidence[]
>> = Object.freeze({
  "Arm Thrust": [{
    scenarioId: "arm-thrust.v2-reviewed-conformance",
    evidenceClasses: ["hit", "miss", "crit", "immunity", "retry", "multi-resource-conflict", "enemy"],
  }],
  "Autotomize": [{
    scenarioId: "autotomize.v2-reviewed-conformance",
    evidenceClasses: ["hit", "miss", "crit", "immunity", "retry", "multi-resource-conflict", "enemy", "self", "lifecycle-trigger", "lifecycle-cleanup"],
  }],
  "Barb Barrage": [{
    scenarioId: "barb-barrage.v2-reviewed-conformance",
    evidenceClasses: ["hit", "miss", "crit", "immunity", "retry", "multi-resource-conflict", "enemy", "choice", "pass", "reconnect", "alternate-branch", "threshold-pass", "threshold-fail"],
  }],
  "Barrage": [{
    scenarioId: "barrage.v2-reviewed-conformance",
    evidenceClasses: ["hit", "miss", "crit", "immunity", "retry", "multi-resource-conflict", "enemy"],
  }],
  "Behemoth Bash": [{
    scenarioId: "behemoth-bash.v2-reviewed-conformance",
    evidenceClasses: ["hit", "miss", "crit", "immunity", "retry", "multi-resource-conflict", "enemy", "threshold-pass", "threshold-fail"],
  }],
  "Behemoth Blade": [{
    scenarioId: "behemoth-blade.v2-reviewed-conformance",
    evidenceClasses: ["hit", "miss", "crit", "immunity", "retry", "multi-resource-conflict", "enemy", "threshold-pass", "threshold-fail"],
  }],
  "Body Press": [{
    scenarioId: "body-press.v2-reviewed-conformance",
    evidenceClasses: ["hit", "miss", "crit", "immunity", "retry", "multi-resource-conflict", "enemy"],
  }],
  "Bolt Beak": [{
    scenarioId: "bolt-beak.v2-reviewed-conformance",
    evidenceClasses: ["hit", "miss", "crit", "immunity", "retry", "multi-resource-conflict", "enemy", "threshold-pass", "threshold-fail"],
  }],
  "Bone Rush": [{
    scenarioId: "bone-rush.v2-reviewed-conformance",
    evidenceClasses: ["hit", "miss", "crit", "immunity", "retry", "multi-resource-conflict", "enemy"],
  }],
  "Bonemerang": [{
    scenarioId: "bonemerang.v2-reviewed-conformance",
    evidenceClasses: ["hit", "miss", "crit", "immunity", "retry", "multi-resource-conflict", "enemy"],
  }],
  "Bullet Seed": [{
    scenarioId: "bullet-seed.v2-reviewed-conformance",
    evidenceClasses: ["hit", "miss", "crit", "immunity", "retry", "multi-resource-conflict", "enemy"],
  }],
  "Comet Punch": [{
    scenarioId: "comet-punch.v2-reviewed-conformance",
    evidenceClasses: ["hit", "miss", "crit", "immunity", "retry", "multi-resource-conflict", "enemy"],
  }],
  "Double Hit": [{
    scenarioId: "double-hit.v2-reviewed-conformance",
    evidenceClasses: ["hit", "miss", "crit", "immunity", "retry", "multi-resource-conflict", "enemy"],
  }],
  "Double Iron Bash": [{
    scenarioId: "double-iron-bash.v2-reviewed-conformance",
    evidenceClasses: ["hit", "miss", "crit", "immunity", "retry", "multi-resource-conflict", "enemy", "threshold-pass", "threshold-fail"],
  }],
  "Double Slap": [{
    scenarioId: "double-slap.v2-reviewed-conformance",
    evidenceClasses: ["hit", "miss", "crit", "immunity", "retry", "multi-resource-conflict", "enemy"],
  }],
  "Dragon Darts": [{
    scenarioId: "dragon-darts.v2-reviewed-conformance",
    evidenceClasses: ["hit", "miss", "crit", "immunity", "retry", "multi-resource-conflict", "enemy"],
  }],
  "Dual Chop": [{
    scenarioId: "dual-chop.v2-reviewed-conformance",
    evidenceClasses: ["hit", "miss", "crit", "immunity", "retry", "multi-resource-conflict", "enemy"],
  }],
  "Dual Wingbeat": [{
    scenarioId: "dual-wingbeat.v2-reviewed-conformance",
    evidenceClasses: ["hit", "miss", "crit", "immunity", "retry", "multi-resource-conflict", "enemy"],
  }],
  "Dynamax Cannon": [{
    scenarioId: "dynamax-cannon.v2-reviewed-conformance",
    evidenceClasses: ["hit", "miss", "crit", "immunity", "retry", "multi-resource-conflict", "enemy", "threshold-pass", "threshold-fail"],
  }],
  "Echoed Voice": [{
    scenarioId: "echoed-voice.v2-reviewed-conformance",
    evidenceClasses: ["hit", "miss", "crit", "immunity", "retry", "multi-resource-conflict", "enemy"],
  }],
  "Electro Ball": [{
    scenarioId: "electro-ball.v2-reviewed-conformance",
    evidenceClasses: ["hit", "miss", "crit", "immunity", "retry", "multi-resource-conflict", "enemy"],
  }],
  Facade: [{
    scenarioId: "fac-ade.v2-reviewed-conformance",
    evidenceClasses: ["hit", "miss", "crit", "immunity", "retry", "multi-resource-conflict", "enemy", "threshold-pass", "threshold-fail"],
  }],
  "Fishious Rend": [{
    scenarioId: "fishious-rend.v2-reviewed-conformance",
    evidenceClasses: ["hit", "miss", "crit", "immunity", "retry", "multi-resource-conflict", "enemy", "threshold-pass", "threshold-fail"],
  }],
  "Flail": [{
    scenarioId: "flail.v2-reviewed-conformance",
    evidenceClasses: ["hit", "miss", "crit", "immunity", "retry", "multi-resource-conflict", "enemy", "threshold-pass", "threshold-fail"],
  }],
  "Fusion Bolt": [{
    scenarioId: "fusion-bolt.v2-reviewed-conformance",
    evidenceClasses: ["hit", "miss", "crit", "immunity", "retry", "multi-resource-conflict", "enemy"],
  }],
  "Fusion Flare": [{
    scenarioId: "fusion-flare.v2-reviewed-conformance",
    evidenceClasses: ["hit", "miss", "crit", "immunity", "retry", "multi-resource-conflict", "enemy"],
  }],
  "Gear Grind": [{
    scenarioId: "gear-grind.v2-reviewed-conformance",
    evidenceClasses: ["hit", "miss", "crit", "immunity", "retry", "multi-resource-conflict", "enemy"],
  }],
  "Grass Knot": [{
    scenarioId: "grass-knot.v2-reviewed-conformance",
    evidenceClasses: ["hit", "miss", "crit", "immunity", "retry", "multi-resource-conflict", "enemy", "threshold-pass", "threshold-fail"],
  }],
  "Gyro Ball": [{
    scenarioId: "gyro-ball.v2-reviewed-conformance",
    evidenceClasses: ["hit", "miss", "crit", "immunity", "retry", "multi-resource-conflict", "enemy"],
  }],
  "Heavy Slam": [{
    scenarioId: "heavy-slam.v2-reviewed-conformance",
    evidenceClasses: ["hit", "miss", "crit", "immunity", "retry", "multi-resource-conflict", "enemy", "threshold-pass", "threshold-fail"],
  }],
  "Hex": [{
    scenarioId: "hex.v2-reviewed-conformance",
    evidenceClasses: ["hit", "miss", "crit", "immunity", "retry", "multi-resource-conflict", "enemy", "choice", "pass", "reconnect", "alternate-branch", "threshold-pass", "threshold-fail"],
  }],
  "Ice Ball": [{
    scenarioId: "ice-ball.v2-reviewed-conformance",
    evidenceClasses: ["hit", "miss", "crit", "immunity", "retry", "multi-resource-conflict", "enemy", "lifecycle-trigger", "lifecycle-cleanup"],
  }],
  "Icicle Spear": [{
    scenarioId: "icicle-spear.v2-reviewed-conformance",
    evidenceClasses: ["hit", "miss", "crit", "immunity", "retry", "multi-resource-conflict", "enemy"],
  }],
  "Infernal Parade": [{
    scenarioId: "infernal-parade.v2-reviewed-conformance",
    evidenceClasses: ["hit", "miss", "crit", "immunity", "retry", "multi-resource-conflict", "enemy", "area-mixed-outcomes", "choice", "pass", "reconnect", "alternate-branch", "threshold-pass", "threshold-fail"],
  }],
  "Judgment": [{
    scenarioId: "judgment.v2-reviewed-conformance",
    evidenceClasses: ["hit", "miss", "crit", "immunity", "retry", "multi-resource-conflict", "enemy", "area-mixed-outcomes", "choice", "pass", "reconnect", "alternate-branch"],
  }],
  "Low Kick": [{
    scenarioId: "low-kick.v2-reviewed-conformance",
    evidenceClasses: ["hit", "miss", "crit", "immunity", "retry", "multi-resource-conflict", "enemy"],
  }],
  "Payback": [{
    scenarioId: "payback.v2-reviewed-conformance",
    evidenceClasses: ["hit", "miss", "crit", "immunity", "retry", "multi-resource-conflict", "enemy", "threshold-pass", "threshold-fail"],
  }],
  "Punishment": [{
    scenarioId: "punishment.v2-reviewed-conformance",
    evidenceClasses: ["hit", "miss", "crit", "immunity", "retry", "multi-resource-conflict", "enemy", "threshold-pass", "threshold-fail"],
  }],
  "Retaliate": [{
    scenarioId: "retaliate.v2-reviewed-conformance",
    evidenceClasses: ["hit", "miss", "crit", "immunity", "retry", "multi-resource-conflict", "enemy", "threshold-pass", "threshold-fail"],
  }],
  "Revelation Dance": [{
    scenarioId: "revelation-dance.v2-reviewed-conformance",
    evidenceClasses: ["hit", "miss", "crit", "immunity", "retry", "multi-resource-conflict", "enemy"],
  }],
  "Reversal": [{
    scenarioId: "reversal.v2-reviewed-conformance",
    evidenceClasses: ["hit", "miss", "crit", "immunity", "retry", "multi-resource-conflict", "enemy", "threshold-pass", "threshold-fail"],
  }],
  "Rock Blast": [{
    scenarioId: "rock-blast.v2-reviewed-conformance",
    evidenceClasses: ["hit", "miss", "crit", "immunity", "retry", "multi-resource-conflict", "enemy"],
  }],
  "Round": [{
    scenarioId: "round.v2-reviewed-conformance",
    evidenceClasses: ["hit", "miss", "crit", "immunity", "retry", "multi-resource-conflict", "enemy", "area-mixed-outcomes"],
  }],
  "Scale Shot": [{
    scenarioId: "scale-shot.v2-reviewed-conformance",
    evidenceClasses: ["hit", "miss", "crit", "immunity", "retry", "multi-resource-conflict", "enemy", "self"],
  }],
  "Secret Power": [{
    scenarioId: "secret-power.v2-reviewed-conformance",
    evidenceClasses: ["hit", "miss", "crit", "immunity", "retry", "multi-resource-conflict", "enemy", "threshold-pass", "threshold-fail"],
  }],
  "Smelling Salts": [{
    scenarioId: "smelling-salts.v2-reviewed-conformance",
    evidenceClasses: ["hit", "miss", "crit", "immunity", "retry", "multi-resource-conflict", "enemy", "threshold-pass", "threshold-fail"],
  }],
  "Spike Cannon": [{
    scenarioId: "spike-cannon.v2-reviewed-conformance",
    evidenceClasses: ["hit", "miss", "crit", "immunity", "retry", "multi-resource-conflict", "enemy"],
  }],
  "Stomping Tantrum": [{
    scenarioId: "stomping-tantrum.v2-reviewed-conformance",
    evidenceClasses: ["hit", "miss", "crit", "immunity", "retry", "multi-resource-conflict", "enemy"],
  }],
  "Stored Power": [{
    scenarioId: "stored-power.v2-reviewed-conformance",
    evidenceClasses: ["hit", "miss", "crit", "immunity", "retry", "multi-resource-conflict", "enemy", "threshold-pass", "threshold-fail"],
  }],
  "Tail Slap": [{
    scenarioId: "tail-slap.v2-reviewed-conformance",
    evidenceClasses: ["hit", "miss", "crit", "immunity", "retry", "multi-resource-conflict", "enemy"],
  }],
  "Triple Axel": [{
    scenarioId: "triple-axel.v2-reviewed-conformance",
    evidenceClasses: ["hit", "miss", "crit", "immunity", "retry", "multi-resource-conflict", "enemy", "choice", "pass", "reconnect", "alternate-branch"],
  }],
  "Triple Kick": [{
    scenarioId: "triple-kick.v2-reviewed-conformance",
    evidenceClasses: ["hit", "miss", "crit", "immunity", "retry", "multi-resource-conflict", "enemy", "choice", "pass", "reconnect", "alternate-branch"],
  }],
  "Trump Card": [{
    scenarioId: "trump-card.v2-reviewed-conformance",
    evidenceClasses: ["hit", "miss", "crit", "immunity", "retry", "multi-resource-conflict", "enemy", "lifecycle-trigger", "lifecycle-cleanup"],
  }],
  "Twineedle": [{
    scenarioId: "twineedle.v2-reviewed-conformance",
    evidenceClasses: ["hit", "miss", "crit", "immunity", "retry", "multi-resource-conflict", "enemy", "threshold-pass", "threshold-fail"],
  }],
  "Venoshock": [{
    scenarioId: "venoshock.v2-reviewed-conformance",
    evidenceClasses: ["hit", "miss", "crit", "immunity", "retry", "multi-resource-conflict", "enemy", "threshold-pass", "threshold-fail"],
  }],
  "Wake-Up Slap": [{
    scenarioId: "wake-up-slap.v2-reviewed-conformance",
    evidenceClasses: ["hit", "miss", "crit", "immunity", "retry", "multi-resource-conflict", "enemy", "threshold-pass", "threshold-fail"],
  }],
  "Water Shuriken": [{
    scenarioId: "water-shuriken.v2-reviewed-conformance",
    evidenceClasses: ["hit", "miss", "crit", "immunity", "retry", "multi-resource-conflict", "enemy"],
  }],
})
