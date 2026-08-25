import type { ContestCommandKind } from './operations'

export type ContestResourceKind = 'contest-document' | 'trainer-sheet' | 'pokemon-sheet' | 'item-custody' | 'group-inventory' | 'campaign-clock' | 'player-profile' | 'contest-catalog' | 'dice-journal' | 'campaign-history' | 'campaign-attention' | 'encounter-document' | 'encounter-map' | 'encounter-scene' | 'encounter-initiative' | 'encounter-settlement' | 'live-play-operation'
export interface ContestAtomicityDeclarationV1 {
  readonly commandKind: ContestCommandKind
  readonly readKinds: readonly ContestResourceKind[]
  readonly writeKinds: readonly ContestResourceKind[]
  readonly atomicity: 'single-sqlite-transaction'
  readonly exactRetry: true
}

const declaration = (commandKind: ContestCommandKind, readKinds: readonly ContestResourceKind[], writeKinds: readonly ContestResourceKind[]): ContestAtomicityDeclarationV1 => Object.freeze({ commandKind, readKinds: Object.freeze(readKinds), writeKinds: Object.freeze(writeKinds), atomicity: 'single-sqlite-transaction', exactRetry: true })

export const CONTEST_OPERATION_ATOMICITY: Readonly<Record<ContestCommandKind, ContestAtomicityDeclarationV1>> = Object.freeze({
  'create-contest': declaration('create-contest', ['contest-catalog'], ['contest-document']),
  'update-settings': declaration('update-settings', ['contest-document','contest-catalog'], ['contest-document']),
  'set-participant-method': declaration('set-participant-method', ['contest-document','contest-catalog'], ['contest-document']),
  'enroll-contestant': declaration('enroll-contestant', ['contest-document','trainer-sheet','pokemon-sheet','item-custody','contest-catalog','player-profile'], ['contest-document']),
  'remove-contestant': declaration('remove-contestant', ['contest-document'], ['contest-document']),
  'start-introduction': declaration('start-introduction', ['contest-document','trainer-sheet','pokemon-sheet','contest-catalog'], ['contest-document']),
  'declare-introduction': declaration('declare-introduction', ['contest-document','trainer-sheet','pokemon-sheet','item-custody','contest-catalog'], ['contest-document','dice-journal']),
  'restart-introduction': declaration('restart-introduction', ['contest-document'], ['contest-document']),
  'create-battle-encounter': declaration('create-battle-encounter', ['contest-document','trainer-sheet','pokemon-sheet','contest-catalog'], ['contest-document','encounter-document','encounter-map','encounter-scene','encounter-initiative','trainer-sheet','pokemon-sheet']),
  'score-battle-accepted-move': declaration('score-battle-accepted-move', ['contest-document','encounter-document','encounter-map','encounter-scene','live-play-operation','contest-catalog'], ['contest-document','dice-journal']),
  'apply-battle-voltage-lifecycle': declaration('apply-battle-voltage-lifecycle', ['contest-document','encounter-document','encounter-map','encounter-scene','live-play-operation','contest-catalog'], ['contest-document']),
  'end-battle-contest': declaration('end-battle-contest', ['contest-document','encounter-document','encounter-map','encounter-scene','live-play-operation','pokemon-sheet','contest-catalog'], ['contest-document','dice-journal']),
  'start-performance': declaration('start-performance', ['contest-document','contest-catalog'], ['contest-document','dice-journal']),
  'select-rotation-performer': declaration('select-rotation-performer', ['contest-document'], ['contest-document']),
  'declare-appeal': declaration('declare-appeal', ['contest-document','contest-catalog'], ['contest-document','dice-journal']),
  'use-intervention': declaration('use-intervention', ['contest-document','trainer-sheet','pokemon-sheet','item-custody','contest-catalog'], ['contest-document','trainer-sheet','pokemon-sheet','dice-journal']),
  'pass-intervention': declaration('pass-intervention', ['contest-document'], ['contest-document']),
  'set-paused': declaration('set-paused', ['contest-document','encounter-document','encounter-map','encounter-scene'], ['contest-document','encounter-document']),
  'apply-correction': declaration('apply-correction', ['contest-document','encounter-document','encounter-map','encounter-scene','player-profile','contest-catalog'], ['contest-document','encounter-document']),
  'declare-prize': declaration('declare-prize', ['contest-document','contest-catalog'], ['contest-document']),
  'prepare-settlement': declaration('prepare-settlement', ['contest-document','encounter-document','encounter-map','encounter-scene','trainer-sheet','pokemon-sheet','group-inventory','campaign-clock','contest-catalog'], ['contest-document','encounter-settlement']),
  'commit-settlement': declaration('commit-settlement', ['contest-document','encounter-document','encounter-map','encounter-scene','encounter-settlement','trainer-sheet','pokemon-sheet','item-custody','group-inventory','campaign-clock','contest-catalog'], ['contest-document','encounter-document','encounter-map','encounter-settlement','trainer-sheet','pokemon-sheet','item-custody','group-inventory','campaign-history','campaign-attention']),
  'cancel-contest': declaration('cancel-contest', ['contest-document','encounter-document','encounter-map','encounter-scene'], ['contest-document','encounter-document']),
})

export const contestAtomicityFor = (commandKind: ContestCommandKind): ContestAtomicityDeclarationV1 => CONTEST_OPERATION_ATOMICITY[commandKind]
