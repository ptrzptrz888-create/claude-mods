import type { Analysis, Progress } from '../types'
import { profileOf } from './model-profiles'

const ORIGINAL_PREVIEW_CHARS = 600

export type StepState = 'done' | 'running' | 'waiting' | 'skipped' | 'failed'
export type Step = { label: string; state: StepState }

export const MARK: Record<StepState, string> = {
  done: '✓',
  running: '…',
  waiting: '○',
  skipped: '–',
  failed: '✗',
}

export const seconds = (ms: number) => `${(ms / 1000).toFixed(1).replace('.', ',')} s`

/** The three steps of the status band, from where processing stands. */
export const stepsOf = (progress: Progress): Step[] => {
  const context: StepState = progress.isReadingContext ? 'done' : 'skipped'
  switch (progress.phase) {
    case 'analyse':
      return [
        { label: 'Analyse', state: 'running' },
        { label: 'Verlauf', state: 'waiting' },
        { label: 'Briefing', state: 'waiting' },
      ]
    case 'verlauf':
      return [
        { label: 'Analyse', state: 'done' },
        { label: 'Verlauf', state: 'running' },
        { label: 'Briefing', state: 'waiting' },
      ]
    case 'fertig':
      return [
        { label: 'Analyse', state: 'done' },
        { label: 'Verlauf', state: context },
        { label: 'Briefing', state: 'done' },
      ]
    case 'unveraendert':
      return [
        { label: 'Analyse', state: 'done' },
        { label: 'Verlauf', state: context },
        { label: 'Briefing', state: 'skipped' },
      ]
    case 'fehler':
      return [
        { label: 'Analyse', state: progress.isReadingContext ? 'done' : 'failed' },
        { label: 'Verlauf', state: progress.isReadingContext ? 'failed' : 'skipped' },
        { label: 'Briefing', state: 'skipped' },
      ]
  }
}

/** The words after the steps: what is happening or how it ended. */
export const headlineOf = (progress: Progress): string => {
  switch (progress.phase) {
    case 'analyse':
      return 'analysiert deinen Prompt'
    case 'verlauf':
      return 'liest den Gesprächsverlauf'
    case 'fertig':
      return `fertig in ${seconds(progress.durationMs)} · verbesserte Fassung steht im Verlauf`
    case 'unveraendert':
      return `unverändert gesendet · ${progress.detail}`
    case 'fehler':
      return `Fehler, Original gesendet · ${progress.detail}`
  }
}

const preview = (text: string) => {
  const trimmed = text.trim()

  return trimmed.length > ORIGINAL_PREVIEW_CHARS ? `${trimmed.slice(0, ORIGINAL_PREVIEW_CHARS)} …` : trimmed
}

const section = (title: string, lines: readonly string[]) => (lines.length === 0 ? [] : ['', title, ...lines])

/**
 * The transcript entry for a boosted prompt: original and improved version
 * side by side, plus what to write differently next time.
 */
export const briefLog = (analysis: Analysis): string =>
  [
    `prompt-boost · optimiert für ${profileOf(analysis.family).label}` +
      `${analysis.usedContext ? ' mit Verlauf' : ''} · ${seconds(analysis.durationMs)}`,
    '',
    'Dein Prompt:',
    preview(analysis.original),
    '',
    'Verbesserte Fassung:',
    analysis.brief,
    ...section(
      'So schreibst du es nächstes Mal gleich so:',
      analysis.lessons.map(lesson => `• ${lesson}`),
    ),
    ...section(
      'Rückfragen, die Claude dir gleich stellt:',
      analysis.questions.map(question => `• ${question}`),
    ),
  ].join('\n')

/** The transcript entry for a prompt that went out as written. */
export const skippedLog = (analysis: Analysis): string =>
  [
    `prompt-boost · unverändert gesendet · ${seconds(analysis.durationMs)} · ${analysis.reason}`,
    ...section(
      'Trotzdem ein Tipp:',
      analysis.lessons.map(lesson => `• ${lesson}`),
    ),
  ].join('\n')
