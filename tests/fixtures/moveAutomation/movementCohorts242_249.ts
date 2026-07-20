import type { MovementCohort242249MoveName } from '~~/server/domain/moveAutomation/specs/movementCohorts242_249'

export const MA_242_249_SCENARIOS_BY_MOVE: Readonly<Record<MovementCohort242249MoveName, readonly { readonly scenarioId: string; readonly evidenceClasses: readonly string[] }[]>> = Object.freeze({
  "Avalanche": [{
    scenarioId: "avalanche.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "hit", "miss", "crit", "immunity", "enemy"],
  }],
  "Baton Pass": [{
    scenarioId: "baton-pass.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "self", "choice", "pass", "reconnect", "alternate-branch", "lifecycle-trigger", "lifecycle-cleanup"],
  }],
  "Bounce": [{
    scenarioId: "bounce.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "hit", "miss", "crit", "immunity", "enemy"],
  }],
  "Brave Bird": [{
    scenarioId: "brave-bird.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "hit", "miss", "crit", "immunity", "enemy"],
  }],
  "Circle Throw": [{
    scenarioId: "circle-throw.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "hit", "miss", "crit", "immunity", "enemy"],
  }],
  "Close Combat": [{
    scenarioId: "close-combat.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "hit", "miss", "crit", "immunity", "enemy"],
  }],
  "Cut": [{
    scenarioId: "cut.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "hit", "miss", "crit", "immunity", "enemy"],
  }],
  "Defense Curl": [{
    scenarioId: "defense-curl.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "self", "lifecycle-trigger", "lifecycle-cleanup"],
  }],
  "Dig": [{
    scenarioId: "dig.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "hit", "miss", "crit", "immunity", "enemy", "area-mixed-outcomes", "lifecycle-trigger", "lifecycle-cleanup"],
  }],
  "Dive": [{
    scenarioId: "dive.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "hit", "miss", "crit", "immunity", "enemy", "area-mixed-outcomes", "lifecycle-trigger", "lifecycle-cleanup"],
  }],
  "Double-Edge": [{
    scenarioId: "double-edge.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "hit", "miss", "crit", "immunity", "enemy"],
  }],
  "Dragon Ascent": [{
    scenarioId: "dragon-ascent.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "hit", "miss", "crit", "immunity", "enemy"],
  }],
  "Dragon Rush": [{
    scenarioId: "dragon-rush.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "hit", "miss", "crit", "immunity", "enemy"],
  }],
  "Dragon Tail": [{
    scenarioId: "dragon-tail.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "hit", "miss", "crit", "immunity", "enemy"],
  }],
  "Earthquake": [{
    scenarioId: "earthquake.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "hit", "miss", "crit", "immunity", "enemy", "area-mixed-outcomes"],
  }],
  "Endeavor": [{
    scenarioId: "endeavor.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "hit", "miss", "crit", "immunity", "enemy"],
  }],
  "Fairy Lock": [{
    scenarioId: "fairy-lock.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "area-mixed-outcomes", "self", "lifecycle-trigger", "lifecycle-cleanup"],
  }],
  "False Swipe": [{
    scenarioId: "false-swipe.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "hit", "miss", "crit", "immunity", "enemy"],
  }],
  "First Impression": [{
    scenarioId: "first-impression.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "hit", "miss", "crit", "immunity", "enemy", "lifecycle-trigger", "lifecycle-cleanup"],
  }],
  "Flame Charge": [{
    scenarioId: "flame-charge.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "hit", "miss", "crit", "immunity", "enemy"],
  }],
  "Flare Blitz": [{
    scenarioId: "flare-blitz.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "hit", "miss", "crit", "immunity", "enemy"],
  }],
  "Flip Turn": [{
    scenarioId: "flip-turn.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "hit", "miss", "crit", "immunity", "enemy", "choice", "pass", "reconnect", "alternate-branch"],
  }],
  "Fly": [{
    scenarioId: "fly.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "hit", "miss", "crit", "immunity", "enemy", "lifecycle-trigger", "lifecycle-cleanup"],
  }],
  "Flying Press": [{
    scenarioId: "flying-press.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "hit", "miss", "crit", "immunity", "enemy", "choice", "pass", "reconnect", "alternate-branch"],
  }],
  "Focus Energy": [{
    scenarioId: "focus-energy.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "self", "lifecycle-trigger", "lifecycle-cleanup"],
  }],
  "Freeze Shock": [{
    scenarioId: "freeze-shock.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "hit", "miss", "crit", "immunity", "enemy", "lifecycle-trigger", "lifecycle-cleanup"],
  }],
  "Giga Impact": [{
    scenarioId: "giga-impact.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "hit", "miss", "crit", "immunity", "enemy"],
  }],
  "Gust": [{
    scenarioId: "gust.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "hit", "miss", "crit", "immunity", "enemy"],
  }],
  "Head Charge": [{
    scenarioId: "head-charge.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "hit", "miss", "crit", "immunity", "enemy"],
  }],
  "Head Smash": [{
    scenarioId: "head-smash.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "hit", "miss", "crit", "immunity", "enemy"],
  }],
  "Heal Block": [{
    scenarioId: "heal-block.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "lifecycle-trigger", "lifecycle-cleanup"],
  }],
  "Heat Crash": [{
    scenarioId: "heat-crash.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "hit", "miss", "crit", "immunity", "enemy"],
  }],
  "Horn Leech": [{
    scenarioId: "horn-leech.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "hit", "miss", "crit", "immunity", "enemy"],
  }],
  "Hydro Pump": [{
    scenarioId: "hydro-pump.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "hit", "miss", "crit", "immunity", "enemy"],
  }],
  "Hyperspace Hole": [{
    scenarioId: "hyperspace-hole.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "hit", "miss", "crit", "immunity", "enemy"],
  }],
  "Ice Burn": [{
    scenarioId: "ice-burn.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "hit", "miss", "crit", "immunity", "enemy", "lifecycle-trigger", "lifecycle-cleanup"],
  }],
  "Imprison": [{
    scenarioId: "imprison.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "lifecycle-trigger", "lifecycle-cleanup"],
  }],
  "Ingrain": [{
    scenarioId: "ingrain.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "self", "lifecycle-trigger", "lifecycle-cleanup"],
  }],
  "Lock-On": [{
    scenarioId: "lock-on.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "lifecycle-trigger", "lifecycle-cleanup"],
  }],
  "Mega Kick": [{
    scenarioId: "mega-kick.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "hit", "miss", "crit", "immunity", "enemy"],
  }],
  "Megahorn": [{
    scenarioId: "megahorn.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "hit", "miss", "crit", "immunity", "enemy"],
  }],
  "Meteor Mash": [{
    scenarioId: "meteor-mash.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "hit", "miss", "crit", "immunity", "enemy"],
  }],
  "Muddy Water": [{
    scenarioId: "muddy-water.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "hit", "miss", "crit", "immunity", "enemy", "area-mixed-outcomes"],
  }],
  "No Retreat": [{
    scenarioId: "no-retreat.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "self", "lifecycle-trigger", "lifecycle-cleanup"],
  }],
  "Parting Shot": [{
    scenarioId: "parting-shot.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "choice", "pass", "reconnect", "alternate-branch", "lifecycle-trigger", "lifecycle-cleanup"],
  }],
  "Power Shift": [{
    scenarioId: "power-shift.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "self", "lifecycle-trigger", "lifecycle-cleanup"],
  }],
  "Psychic": [{
    scenarioId: "psychic.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "hit", "miss", "crit", "immunity", "enemy"],
  }],
  "Psycho Shift": [{
    scenarioId: "psycho-shift.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "choice", "pass", "reconnect", "alternate-branch", "lifecycle-trigger", "lifecycle-cleanup"],
  }],
  "Rapid Spin": [{
    scenarioId: "rapid-spin.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "hit", "miss", "crit", "immunity", "enemy", "self", "lifecycle-trigger", "lifecycle-cleanup"],
  }],
  "Razor Wind": [{
    scenarioId: "razor-wind.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "hit", "miss", "crit", "immunity", "enemy", "area-mixed-outcomes", "lifecycle-trigger", "lifecycle-cleanup"],
  }],
  "Revenge": [{
    scenarioId: "revenge.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "hit", "miss", "crit", "immunity", "enemy"],
  }],
  "Roar": [{
    scenarioId: "roar.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "area-mixed-outcomes", "lifecycle-trigger", "lifecycle-cleanup"],
  }],
  "Roar of Time": [{
    scenarioId: "roar-of-time.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "hit", "miss", "crit", "immunity", "enemy", "area-mixed-outcomes"],
  }],
  "Rock Wrecker": [{
    scenarioId: "rock-wrecker.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "hit", "miss", "crit", "immunity", "enemy"],
  }],
  "Rollout": [{
    scenarioId: "rollout.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "hit", "miss", "crit", "immunity", "enemy"],
  }],
  "Shift Gear": [{
    scenarioId: "shift-gear.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "self", "lifecycle-trigger", "lifecycle-cleanup"],
  }],
  "Skitter Smack": [{
    scenarioId: "skitter-smack.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "hit", "miss", "crit", "immunity", "enemy"],
  }],
  "Skull Bash": [{
    scenarioId: "skull-bash.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "hit", "miss", "crit", "immunity", "enemy", "lifecycle-trigger", "lifecycle-cleanup"],
  }],
  "Sky Attack": [{
    scenarioId: "sky-attack.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "hit", "miss", "crit", "immunity", "enemy", "lifecycle-trigger", "lifecycle-cleanup"],
  }],
  "Sky Drop": [{
    scenarioId: "sky-drop.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "hit", "miss", "crit", "immunity", "enemy", "lifecycle-trigger", "lifecycle-cleanup"],
  }],
  "Slam": [{
    scenarioId: "slam.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "hit", "miss", "crit", "immunity", "enemy"],
  }],
  "Splash": [{
    scenarioId: "splash.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "self", "lifecycle-trigger", "lifecycle-cleanup"],
  }],
  "Steamroller": [{
    scenarioId: "steamroller.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "hit", "miss", "crit", "immunity", "enemy"],
  }],
  "Steel Wing": [{
    scenarioId: "steel-wing.v2-reviewed-conformance",
    evidenceClasses: ["retry", "multi-resource-conflict", "hit", "miss", "crit", "immunity", "enemy"],
  }],
})
