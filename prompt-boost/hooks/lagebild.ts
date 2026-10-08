import type { LagebildNote, LagebildState, NoteKind } from '../types'

/** Marks a prompt the Lagebild was already appended to. */
export const LAGEBILD_MARK = '## Lagebild (prompt-boost)'

/** About 1,500 tokens at four characters per token. */
export const MAX_LAGEBILD_CHARS = 6000

const MAX_FILES = 15
const MAX_NOTES = 30
const MAX_GOAL_CHARS = 600
const MAX_GIT_LINES = 15

/** What the session tells about itself when an agent starts. */
export type LagebildFacts = {
  goal: string
  cwd: string
  git: string
}

export const NOTE_KINDS: readonly NoteKind[] = ['befund', 'ausgeschlossen', 'entscheidung']

export const asNoteKind = (value: unknown): NoteKind | null =>
  NOTE_KINDS.find(kind => kind === value) ?? null

const pushUnique = (list: readonly string[], item: string, max: number) =>
  [...list.filter(entry => entry !== item), item].slice(-max)

/** Records a file the main loop read or changed; a changed file leaves "read". */
export const withFile = (state: LagebildState, kind: 'read' | 'changed', path: string): LagebildState =>
  kind === 'changed'
    ? { ...state, changed: pushUnique(state.changed, path, MAX_FILES), read: state.read.filter(p => p !== path) }
    : state.changed.includes(path)
      ? state
      : { ...state, read: pushUnique(state.read, path, MAX_FILES) }

export const withNote = (state: LagebildState, note: LagebildNote): LagebildState => ({
  ...state,
  notes: [...state.notes, { ...note, text: note.text.trim() }].slice(-MAX_NOTES),
})

const HEADINGS: Record<NoteKind, string> = {
  entscheidung: 'Entscheidungen',
  befund: 'Befunde',
  ausgeschlossen: 'Ausgeschlossen',
}

const section = (title: string, items: readonly string[]) =>
  items.length === 0 ? '' : `\n**${title}**\n${items.map(item => `- ${item}`).join('\n')}`

const clip = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max - 1)}…`)

const compose = (state: LagebildState, facts: LagebildFacts): string => {
  const git = facts.git.trim().split('\n').filter(Boolean).slice(0, MAX_GIT_LINES)
  const notesOf = (kind: NoteKind) => state.notes.filter(note => note.kind === kind).map(note => note.text)

  return [
    LAGEBILD_MARK,
    'Was die Hauptsession schon weiß. Lies Bekanntes nicht neu ein, außer der Auftrag verlangt es.',
    `\n**Arbeitsverzeichnis** ${facts.cwd}`,
    facts.goal.trim() === '' ? '' : `\n**Ziel der Session**\n${clip(facts.goal.trim(), MAX_GOAL_CHARS)}`,
    git.length === 0 ? '' : `\n**Git**\n${git.join('\n')}`,
    ...NOTE_KINDS.map(kind => section(HEADINGS[kind], notesOf(kind))),
    section('Geändert in dieser Session', state.changed),
    section('Bereits gelesen', state.read),
  ]
    .filter(part => part !== '')
    .join('\n')
}

/**
 * The Lagebild as an agent reads it, within MAX_LAGEBILD_CHARS: the oldest
 * notes go first, then the oldest read files, then the text is cut.
 */
export const renderLagebild = (state: LagebildState, facts: LagebildFacts): string => {
  let current = state
  let text = compose(current, facts)
  while (text.length > MAX_LAGEBILD_CHARS && (current.notes.length > 0 || current.read.length > 0)) {
    current =
      current.notes.length > 0
        ? { ...current, notes: current.notes.slice(1) }
        : { ...current, read: current.read.slice(1) }
    text = compose(current, facts)
  }

  return clip(text, MAX_LAGEBILD_CHARS)
}
