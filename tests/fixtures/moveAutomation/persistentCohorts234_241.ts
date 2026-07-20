import type { PersistentCohort234241MoveName } from '~~/server/domain/moveAutomation/specs/persistentCohorts234_241'

export const MA_234_241_SCENARIOS_BY_MOVE: Readonly<Record<PersistentCohort234241MoveName, readonly { readonly scenarioId: string; readonly evidenceClasses: readonly string[] }[]>> = Object.freeze({
  "Conversion": [{
    scenarioId: "conversion.v2-reviewed-conformance",
    evidenceClasses: ["lifecycle-trigger", "lifecycle-cleanup", "retry", "multi-resource-conflict", "self", "choice", "pass", "reconnect", "alternate-branch"],
  }],
  "Conversion2": [{
    scenarioId: "conversion2.v2-reviewed-conformance",
    evidenceClasses: ["lifecycle-trigger", "lifecycle-cleanup", "retry", "multi-resource-conflict", "self", "choice", "pass", "reconnect", "alternate-branch"],
  }],
  "Core Enforcer": [{
    scenarioId: "core-enforcer.v2-reviewed-conformance",
    evidenceClasses: ["lifecycle-trigger", "lifecycle-cleanup", "retry", "multi-resource-conflict", "hit", "miss", "crit", "immunity", "enemy", "area-mixed-outcomes", "choice", "pass", "reconnect", "alternate-branch"],
  }],
  "Curse": [{
    scenarioId: "curse.v2-reviewed-conformance",
    evidenceClasses: ["lifecycle-trigger", "lifecycle-cleanup", "retry", "multi-resource-conflict", "self"],
  }],
  "Destiny Bond": [{
    scenarioId: "destiny-bond.v2-reviewed-conformance",
    evidenceClasses: ["lifecycle-trigger", "lifecycle-cleanup", "retry", "multi-resource-conflict", "area-mixed-outcomes"],
  }],
  "Doom Desire": [{
    scenarioId: "doom-desire.v2-reviewed-conformance",
    evidenceClasses: ["lifecycle-trigger", "lifecycle-cleanup", "retry", "multi-resource-conflict", "hit", "miss", "crit", "immunity", "enemy"],
  }],
  "Double Team": [{
    scenarioId: "double-team.v2-reviewed-conformance",
    evidenceClasses: ["lifecycle-trigger", "lifecycle-cleanup", "retry", "multi-resource-conflict", "self"],
  }],
  "Electrify": [{
    scenarioId: "electrify.v2-reviewed-conformance",
    evidenceClasses: ["lifecycle-trigger", "lifecycle-cleanup", "retry", "multi-resource-conflict"],
  }],
  "Fire Spin": [{
    scenarioId: "fire-spin.v2-reviewed-conformance",
    evidenceClasses: ["lifecycle-trigger", "lifecycle-cleanup", "retry", "multi-resource-conflict", "hit", "miss", "crit", "immunity", "enemy"],
  }],
  "Forest’s Curse": [{
    scenarioId: "forests-curse.v2-reviewed-conformance",
    evidenceClasses: ["lifecycle-trigger", "lifecycle-cleanup", "retry", "multi-resource-conflict"],
  }],
  "Future Sight": [{
    scenarioId: "future-sight.v2-reviewed-conformance",
    evidenceClasses: ["lifecycle-trigger", "lifecycle-cleanup", "retry", "multi-resource-conflict", "hit", "miss", "crit", "immunity", "enemy"],
  }],
  "Gastro Acid": [{
    scenarioId: "gastro-acid.v2-reviewed-conformance",
    evidenceClasses: ["lifecycle-trigger", "lifecycle-cleanup", "retry", "multi-resource-conflict", "choice", "pass", "reconnect", "alternate-branch"],
  }],
  "Glacial Lance": [{
    scenarioId: "glacial-lance.v2-reviewed-conformance",
    evidenceClasses: ["lifecycle-trigger", "lifecycle-cleanup", "retry", "multi-resource-conflict", "hit", "miss", "crit", "immunity", "enemy", "area-mixed-outcomes"],
  }],
  "Guard Split": [{
    scenarioId: "guard-split.v2-reviewed-conformance",
    evidenceClasses: ["lifecycle-trigger", "lifecycle-cleanup", "retry", "multi-resource-conflict"],
  }],
  "Headlong Rush": [{
    scenarioId: "headlong-rush.v2-reviewed-conformance",
    evidenceClasses: ["lifecycle-trigger", "lifecycle-cleanup", "retry", "multi-resource-conflict", "hit", "miss", "crit", "immunity", "enemy"],
  }],
  "Healing Wish": [{
    scenarioId: "healing-wish.v2-reviewed-conformance",
    evidenceClasses: ["lifecycle-trigger", "lifecycle-cleanup", "retry", "multi-resource-conflict"],
  }],
  "High Horsepower": [{
    scenarioId: "high-horsepower.v2-reviewed-conformance",
    evidenceClasses: ["lifecycle-trigger", "lifecycle-cleanup", "retry", "multi-resource-conflict", "hit", "miss", "crit", "immunity", "enemy"],
  }],
  "Infestation": [{
    scenarioId: "infestation.v2-reviewed-conformance",
    evidenceClasses: ["lifecycle-trigger", "lifecycle-cleanup", "retry", "multi-resource-conflict", "hit", "miss", "crit", "immunity", "enemy"],
  }],
  "Laser Focus": [{
    scenarioId: "laser-focus.v2-reviewed-conformance",
    evidenceClasses: ["lifecycle-trigger", "lifecycle-cleanup", "retry", "multi-resource-conflict", "self"],
  }],
  "Lash Out": [{
    scenarioId: "lash-out.v2-reviewed-conformance",
    evidenceClasses: ["lifecycle-trigger", "lifecycle-cleanup", "retry", "multi-resource-conflict", "hit", "miss", "crit", "immunity", "enemy"],
  }],
  "Leech Seed": [{
    scenarioId: "leech-seed.v2-reviewed-conformance",
    evidenceClasses: ["lifecycle-trigger", "lifecycle-cleanup", "retry", "multi-resource-conflict"],
  }],
  "Light Screen": [{
    scenarioId: "light-screen.v2-reviewed-conformance",
    evidenceClasses: ["lifecycle-trigger", "lifecycle-cleanup", "retry", "multi-resource-conflict"],
  }],
  "Lucky Chant": [{
    scenarioId: "lucky-chant.v2-reviewed-conformance",
    evidenceClasses: ["lifecycle-trigger", "lifecycle-cleanup", "retry", "multi-resource-conflict"],
  }],
  "Lunar Blessing": [{
    scenarioId: "lunar-blessing.v2-reviewed-conformance",
    evidenceClasses: ["lifecycle-trigger", "lifecycle-cleanup", "retry", "multi-resource-conflict", "self"],
  }],
  "Lunar Dance": [{
    scenarioId: "lunar-dance.v2-reviewed-conformance",
    evidenceClasses: ["lifecycle-trigger", "lifecycle-cleanup", "retry", "multi-resource-conflict"],
  }],
  "Lunge": [{
    scenarioId: "lunge.v2-reviewed-conformance",
    evidenceClasses: ["lifecycle-trigger", "lifecycle-cleanup", "retry", "multi-resource-conflict", "hit", "miss", "crit", "immunity", "enemy"],
  }],
  "Magma Storm": [{
    scenarioId: "magma-storm.v2-reviewed-conformance",
    evidenceClasses: ["lifecycle-trigger", "lifecycle-cleanup", "retry", "multi-resource-conflict", "hit", "miss", "crit", "immunity", "enemy"],
  }],
  "Mean Look": [{
    scenarioId: "mean-look.v2-reviewed-conformance",
    evidenceClasses: ["lifecycle-trigger", "lifecycle-cleanup", "retry", "multi-resource-conflict"],
  }],
  "Mind Reader": [{
    scenarioId: "mind-reader.v2-reviewed-conformance",
    evidenceClasses: ["lifecycle-trigger", "lifecycle-cleanup", "retry", "multi-resource-conflict"],
  }],
  "Mist": [{
    scenarioId: "mist.v2-reviewed-conformance",
    evidenceClasses: ["lifecycle-trigger", "lifecycle-cleanup", "retry", "multi-resource-conflict"],
  }],
  "Nightmare": [{
    scenarioId: "nightmare.v2-reviewed-conformance",
    evidenceClasses: ["lifecycle-trigger", "lifecycle-cleanup", "retry", "multi-resource-conflict"],
  }],
  "Octolock": [{
    scenarioId: "octolock.v2-reviewed-conformance",
    evidenceClasses: ["lifecycle-trigger", "lifecycle-cleanup", "retry", "multi-resource-conflict"],
  }],
  "Perish Song": [{
    scenarioId: "perish-song.v2-reviewed-conformance",
    evidenceClasses: ["lifecycle-trigger", "lifecycle-cleanup", "retry", "multi-resource-conflict", "area-mixed-outcomes", "self"],
  }],
  "Power Split": [{
    scenarioId: "power-split.v2-reviewed-conformance",
    evidenceClasses: ["lifecycle-trigger", "lifecycle-cleanup", "retry", "multi-resource-conflict"],
  }],
  "Psyshield Bash": [{
    scenarioId: "psyshield-bash.v2-reviewed-conformance",
    evidenceClasses: ["lifecycle-trigger", "lifecycle-cleanup", "retry", "multi-resource-conflict", "hit", "miss", "crit", "immunity", "enemy"],
  }],
  "Psyshock": [{
    scenarioId: "psyshock.v2-reviewed-conformance",
    evidenceClasses: ["lifecycle-trigger", "lifecycle-cleanup", "retry", "multi-resource-conflict", "hit", "miss", "crit", "immunity", "enemy"],
  }],
  "Psystrike": [{
    scenarioId: "psystrike.v2-reviewed-conformance",
    evidenceClasses: ["lifecycle-trigger", "lifecycle-cleanup", "retry", "multi-resource-conflict", "hit", "miss", "crit", "immunity", "enemy"],
  }],
  "Rage": [{
    scenarioId: "rage.v2-reviewed-conformance",
    evidenceClasses: ["lifecycle-trigger", "lifecycle-cleanup", "retry", "multi-resource-conflict", "hit", "miss", "crit", "immunity", "enemy", "self"],
  }],
  "Rest": [{
    scenarioId: "rest.v2-reviewed-conformance",
    evidenceClasses: ["lifecycle-trigger", "lifecycle-cleanup", "retry", "multi-resource-conflict", "self"],
  }],
  "Roost": [{
    scenarioId: "roost.v2-reviewed-conformance",
    evidenceClasses: ["lifecycle-trigger", "lifecycle-cleanup", "retry", "multi-resource-conflict", "self"],
  }],
  "Safeguard": [{
    scenarioId: "safeguard.v2-reviewed-conformance",
    evidenceClasses: ["lifecycle-trigger", "lifecycle-cleanup", "retry", "multi-resource-conflict"],
  }],
  "Secret Sword": [{
    scenarioId: "secret-sword.v2-reviewed-conformance",
    evidenceClasses: ["lifecycle-trigger", "lifecycle-cleanup", "retry", "multi-resource-conflict", "hit", "miss", "crit", "immunity", "enemy"],
  }],
  "Sing": [{
    scenarioId: "sing.v2-reviewed-conformance",
    evidenceClasses: ["lifecycle-trigger", "lifecycle-cleanup", "retry", "multi-resource-conflict", "area-mixed-outcomes"],
  }],
  "Snap Trap": [{
    scenarioId: "snap-trap.v2-reviewed-conformance",
    evidenceClasses: ["lifecycle-trigger", "lifecycle-cleanup", "retry", "multi-resource-conflict", "hit", "miss", "crit", "immunity", "enemy"],
  }],
  "Sonic Boom": [{
    scenarioId: "sonic-boom.v2-reviewed-conformance",
    evidenceClasses: ["lifecycle-trigger", "lifecycle-cleanup", "retry", "multi-resource-conflict", "hit", "miss", "crit", "immunity", "enemy"],
  }],
  "Spider Web": [{
    scenarioId: "spider-web.v2-reviewed-conformance",
    evidenceClasses: ["lifecycle-trigger", "lifecycle-cleanup", "retry", "multi-resource-conflict"],
  }],
  "Spirit Shackle": [{
    scenarioId: "spirit-shackle.v2-reviewed-conformance",
    evidenceClasses: ["lifecycle-trigger", "lifecycle-cleanup", "retry", "multi-resource-conflict", "hit", "miss", "crit", "immunity", "enemy"],
  }],
  "Spit Up": [{
    scenarioId: "spit-up.v2-reviewed-conformance",
    evidenceClasses: ["lifecycle-trigger", "lifecycle-cleanup", "retry", "multi-resource-conflict", "hit", "miss", "crit", "immunity", "enemy"],
  }],
  "Spotlight": [{
    scenarioId: "spotlight.v2-reviewed-conformance",
    evidenceClasses: ["lifecycle-trigger", "lifecycle-cleanup", "retry", "multi-resource-conflict"],
  }],
  "Stockpile": [{
    scenarioId: "stockpile.v2-reviewed-conformance",
    evidenceClasses: ["lifecycle-trigger", "lifecycle-cleanup", "retry", "multi-resource-conflict", "self"],
  }],
  "Substitute": [{
    scenarioId: "substitute.v2-reviewed-conformance",
    evidenceClasses: ["lifecycle-trigger", "lifecycle-cleanup", "retry", "multi-resource-conflict", "self"],
  }],
  "Swallow": [{
    scenarioId: "swallow.v2-reviewed-conformance",
    evidenceClasses: ["lifecycle-trigger", "lifecycle-cleanup", "retry", "multi-resource-conflict", "self"],
  }],
  "Sweet Kiss": [{
    scenarioId: "sweet-kiss.v2-reviewed-conformance",
    evidenceClasses: ["lifecycle-trigger", "lifecycle-cleanup", "retry", "multi-resource-conflict"],
  }],
  "Tar Shot": [{
    scenarioId: "tar-shot.v2-reviewed-conformance",
    evidenceClasses: ["lifecycle-trigger", "lifecycle-cleanup", "retry", "multi-resource-conflict"],
  }],
  "Thousand Waves": [{
    scenarioId: "thousand-waves.v2-reviewed-conformance",
    evidenceClasses: ["lifecycle-trigger", "lifecycle-cleanup", "retry", "multi-resource-conflict", "hit", "miss", "crit", "immunity", "enemy", "area-mixed-outcomes"],
  }],
  "Thunder Cage": [{
    scenarioId: "thunder-cage.v2-reviewed-conformance",
    evidenceClasses: ["lifecycle-trigger", "lifecycle-cleanup", "retry", "multi-resource-conflict", "hit", "miss", "crit", "immunity", "enemy", "area-mixed-outcomes"],
  }],
  "Trop Kick": [{
    scenarioId: "trop-kick.v2-reviewed-conformance",
    evidenceClasses: ["lifecycle-trigger", "lifecycle-cleanup", "retry", "multi-resource-conflict", "hit", "miss", "crit", "immunity", "enemy"],
  }],
  "Victory Dance": [{
    scenarioId: "victory-dance.v2-reviewed-conformance",
    evidenceClasses: ["lifecycle-trigger", "lifecycle-cleanup", "retry", "multi-resource-conflict", "self"],
  }],
  "Water Sport": [{
    scenarioId: "water-sport.v2-reviewed-conformance",
    evidenceClasses: ["lifecycle-trigger", "lifecycle-cleanup", "retry", "multi-resource-conflict", "area-mixed-outcomes", "self"],
  }],
  "Whirlpool": [{
    scenarioId: "whirlpool.v2-reviewed-conformance",
    evidenceClasses: ["lifecycle-trigger", "lifecycle-cleanup", "retry", "multi-resource-conflict", "hit", "miss", "crit", "immunity", "enemy"],
  }],
  "Wish": [{
    scenarioId: "wish.v2-reviewed-conformance",
    evidenceClasses: ["lifecycle-trigger", "lifecycle-cleanup", "retry", "multi-resource-conflict"],
  }],
})
