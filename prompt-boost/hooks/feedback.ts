import type { ModelCompleteRequest } from 'claude-code'

import type { Feedback } from '../types'

/** How many ratings are kept to learn from. */
export const FEEDBACK_LIMIT = 60
/** After this many new ratings the style is distilled again. */
export const DISTILL_EVERY = 5

/** Reads the stored list defensively: anything malformed is dropped. */
export const asFeedbackList = (value: unknown): Feedback[] =>
  Array.isArray(value)
    ? value.filter(
        (item): item is Feedback =>
          typeof item === 'object' && item !== null && (item.rating === 'gut' || item.rating === 'daneben'),
      )
    : []

export const addFeedback = (list: readonly Feedback[], entry: Feedback): Feedback[] =>
  [...list, entry].slice(-FEEDBACK_LIMIT)

/** Idea 3: turns the ratings into a short personal prompt style. */
export const distillRequest = (list: readonly Feedback[], optimizerModel: string): ModelCompleteRequest => ({
  model: optimizerModel,
  system: `Du leitest aus Bewertungen ab, wie Arbeitsbriefings für eine bestimmte Person aussehen sollten.
Jede Zeile ist ein Auftrag, den ein Briefing begleitet hat, mit Bewertung (gut oder daneben) und optional einer Notiz der Person.
Schreibe höchstens 10 knappe Stichpunkte: was bei dieser Person funktioniert und was zu vermeiden ist.
Nur Muster, die sich aus mehreren Bewertungen oder einer ausdrücklichen Notiz ergeben. Keine Vermutungen, keine Einleitung.`,
  prompt: list
    .map(item => `- [${item.rating}] ${item.intent}${item.note === '' ? '' : ` · Notiz: ${item.note}`}`)
    .join('\n'),
  maxTokens: 800,
  effort: 'low',
  timeoutMs: 25_000,
})
