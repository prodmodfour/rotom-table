import type { MoveAutomationHpSuggestion } from '~/types/moveAutomation'
import type { MoveAutomationMoveLike } from '~/utils/moveAutomation'

export const parseMoveAutomationHpSuggestions = (move: MoveAutomationMoveLike): MoveAutomationHpSuggestion[] => {
  const effect = move.effect ?? ''
  const range = move.range ?? ''
  const out: MoveAutomationHpSuggestion[] = []
  const name = move.name

  const add = (item: MoveAutomationHpSuggestion) => out.push(item)

  if (/user.s Hit Points (?:are|is) (?:reduced by|set to -?50%)|user loses 1\/2|user loses .*half/i.test(effect)) {
    add({ recipient: 'user', mode: 'lose-percent-max', percent: 50, label: 'User loses 50% of Max HP' })
  }
  if (/user loses 1\/3rd|user loses 1\/3|loses 1\/3rd of their Max Hit Points/i.test(effect)) {
    add({ recipient: 'user', mode: 'lose-percent-max', percent: 33.333, label: 'User loses 1/3 Max HP' })
  }
  if (/loses Hit Points equal to [¼1\/4].*Max Hit Points|loses 1\/4 of their maximum Hit Points|loses 1\/4th of their Max Hit Points/i.test(effect)) {
    add({ recipient: 'user', mode: 'lose-percent-max', percent: 25, label: 'User loses 1/4 Max HP' })
  }
  if (/immediately Faints|lowers? (?:the )?user to 0 Hit Points|lowering its HP to 0/i.test(effect)) {
    add({ recipient: 'user', mode: 'set-zero', label: 'User HP becomes 0' })
  }

  const recoil = range.match(/Recoil\s+1\/(\d+)/i)
  if (recoil) {
    const denominator = Number(recoil[1])
    if (denominator > 0) add({ recipient: 'user', mode: 'lose-percent-max', percent: 100 / denominator, label: `Recoil ${recoil[0]}`, optional: true })
  }

  if (/target loses 1\/2 of their current Hit Points/i.test(effect)) {
    add({ recipient: 'target', mode: 'lose-percent-current', percent: 50, label: 'Target loses half current HP' })
  }
  if (/target loses Hit Points equal to the level/i.test(effect) || /target loses 15 Hit Points/i.test(effect) || /causes the target to lose 15 Hit Points/i.test(effect)) {
    const amount = /15 Hit Points/i.test(effect) ? 15 : undefined
    add({ recipient: 'target', mode: 'fixed-loss', amount, label: amount ? `Target loses ${amount} HP` : 'Target loses fixed HP (enter amount)' })
  }

  const selfHealHalf = /user regains Hit Points equal to half|user regains hit points equal to 50%|user is set to their full Hit Point value|user regains Hit Points equal to half of its full/i.test(effect)
  if (selfHealHalf || ['Recover', 'Heal Order', 'Slack Off', 'Roost', 'Moonlight', 'Morning Sun', 'Synthesis', 'Shore Up', 'Rest'].includes(name)) {
    add({ recipient: 'user', mode: 'heal-percent-max', percent: /full Hit Point value|full Hit Points/.test(effect) && /Rest/.test(name) ? 100 : 50, label: name === 'Rest' ? 'User heals to full HP' : 'User heals 50% Max HP', optional: /Sunny|Rainy|Sand|Hail|Grassy Terrain/i.test(effect) })
  }
  if (/target regains Hit Points equal to half|Restores 50% of the target.s max Hit Points|target recovers 50%/i.test(effect)) {
    add({ recipient: 'target', mode: 'heal-percent-max', percent: 50, label: 'Target heals 50% Max HP', optional: /may|instead|Grassy Terrain/i.test(effect) })
  }
  if (/regain Hit Points equal to 1\/4|regain hit points equal to 1\/4|recover a Tick/i.test(effect)) {
    add({ recipient: /target|allies|all allies/i.test(effect) ? 'target' : 'user', mode: 'heal-percent-max', percent: 25, label: 'Heal 1/4 Max HP', optional: true })
  }

  const seen = new Set<string>()
  return out.filter((item) => {
    const key = `${item.recipient}:${item.mode}:${item.percent ?? ''}:${item.amount ?? ''}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
