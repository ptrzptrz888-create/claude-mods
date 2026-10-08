import type { ModelCompleteRequest } from 'claude-code'

import type { Complexity, ModelFamily } from '../types'
import { familyOf, profileOf } from './model-profiles'

/** Past this length a prompt is mostly pasted material: left as it is. */
export const MAX_INPUT_CHARS = 20_000
const TIMEOUT_MS = 25_000
/** A rewrite far shorter than the original has most likely dropped details. */
const MIN_REWRITE_RATIO = 0.6

export type Verdict = {
  isSkipped: boolean
  needsContext: boolean
  reason: string
  intent: string
  gaps: string[]
  questions: string[]
  assumptions: string[]
  complexity: Complexity
  skill: string
  lessons: string[]
  brief: string
}

/** What the analyser knows beyond the prompt itself. */
export type Extras = {
  /** The person's prompt style, distilled from their ratings. */
  personalStyle: string
  /** The core table of the skill router. */
  router: string
}

const JSON_SHAPE = `{"skip": boolean, "needsContext": boolean, "reason": "ein Satz", "intent": "ein Satz", "gaps": ["..."], "questions": ["..."], "assumptions": ["..."], "complexity": "einfach" | "mittel" | "schwer", "skill": "Name oder leer", "lessons": ["..."], "brief": "das Briefing oder leer"}`

const rules = (style: string, extras: Extras) => `Zielmodell: ${style}

Felder:
- skip: true, wenn der Prompt schon klar und vollständig ist oder eine kurze Antwort, Bestätigung oder Plauderei ist.
- gaps: Lücken, die du mit einer vernünftigen Annahme überbrücken kannst. Die Annahme gehört in assumptions, markiert mit „Annahme:“.
- questions: nur Punkte, die das Ergebnis wesentlich verändern und sich nicht sinnvoll annehmen lassen. Höchstens drei, jede als konkrete Frage. Im Zweifel lieber eine Annahme.
- complexity: einfach (Nachschlagen, kleine Änderung, kurze Antwort), mittel (normale Umsetzung oder Text), schwer (Architektur, schwierige Abwägung, viele Dateien, heikle Fehlersuche).
- skill: der eine passende Skill oder das Werkzeug aus der Router-Tabelle unten, wenn ein Auslöser klar passt. Sonst leer. Bei kurzen Fragen und Erklärungen immer leer.
- lessons: 1 bis 3 Schreibtipps an die Person, wie sie genau diesen Prompt selbst besser hätte formulieren können. Je ein kurzer Satz, konkret auf diesen Prompt bezogen (etwa „Nenne den Ordner, in dem die Rechnungen liegen“), keine allgemeinen Floskeln. Leer, wenn der Prompt schon gut war.
- brief: ein Arbeitsbriefing für das Zielmodell, in der Sprache des Prompts.

Regeln für das Briefing:
- Übernimm jedes konkrete Detail (Pfade, Namen, Zahlen, Zitate) wörtlich. Nichts weglassen.
- Erfinde keine Fakten und erweitere den Umfang nicht.
- Gliedere nur so weit, wie die Aufgabe es braucht. Mögliche Abschnitte: Ziel, Kontext, Anforderungen, Randbedingungen, Fertig wenn, Ausgabe.
- „Fertig wenn" ist ein prüfbares Endkriterium.
${extras.personalStyle === '' ? '' : `\nVorlieben dieser Person, gelernt aus ihren Bewertungen (beachten):\n${extras.personalStyle}\n`}${extras.router === '' ? '' : `\nRouter-Tabelle für skill:\n${extras.router}\n`}
Antworte ausschließlich mit einem JSON-Objekt, ohne Codeblock:
${JSON_SHAPE}`

const ANALYSE_SYSTEM = (style: string, extras: Extras) => `Du bist Prompt-Ingenieur für eine Coding- und Arbeitssitzung mit Claude.
Du bekommst einen Prompt, den eine Person gerade geschrieben hat. Du siehst den bisherigen Gesprächsverlauf NICHT.

Setze needsContext auf true (und skip auf true), wenn der Prompt sich auf den Gesprächsverlauf bezieht („wie oben", „mach weiter", „das", „Punkt 2") und ohne ihn nicht sinnvoll zu verstehen ist.
Fragen danach, welches Ding, welche Datei, welcher Ort oder welche Plattform gemeint ist, gehören nicht in questions: Der Verlauf beantwortet sie meist. Setze in diesem Fall needsContext auf true.

${rules(style, extras)}`

const AGENT_SYSTEM = (style: string) => `Du bist Prompt-Ingenieur. Du bekommst den Auftrag, den ein Hauptagent einem Subagenten geben will.
Der Subagent startet ohne jeden Gesprächsverlauf: Er kennt nur diesen Text.

Zielmodell des Subagenten: ${style}

Schreibe den Auftrag so um, dass ein fähiger Kollege ohne Vorwissen ihn sofort richtig ausführt:
- Ziel und Zweck (warum die Aufgabe wichtig ist und wofür das Ergebnis gebraucht wird)
- Bekannter Kontext: alle Pfade, Namen, Befunde und Einschränkungen aus dem Original, wörtlich
- Umfang und Grenzen: was ausdrücklich nicht zu tun ist
- Fertig wenn: ein prüfbares Endkriterium
- Rückgabe: welches Format der Bericht haben soll

Regeln: Nichts erfinden, nichts weglassen, den Umfang nicht erweitern. Sprache des Originals beibehalten.
Antworte ausschließlich mit dem neuen Auftrag, ohne Einleitung und ohne Codeblock.`

const asStrings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && v.trim() !== '') : []

const asText = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

const asComplexity = (value: unknown): Complexity =>
  value === 'einfach' || value === 'schwer' ? value : 'mittel'

/** Reads the analysis JSON out of a reply, tolerating text around it. */
export const parseVerdict = (reply: string): Verdict | null => {
  const start = reply.indexOf('{')
  const end = reply.lastIndexOf('}')
  if (start === -1 || end <= start) return null

  try {
    const raw = JSON.parse(reply.slice(start, end + 1)) as Record<string, unknown>
    const brief = asText(raw.brief)
    const needsContext = raw.needsContext === true

    return {
      isSkipped: raw.skip === true || needsContext || brief === '',
      needsContext,
      reason: asText(raw.reason),
      intent: asText(raw.intent),
      gaps: asStrings(raw.gaps),
      questions: asStrings(raw.questions).slice(0, 3),
      assumptions: asStrings(raw.assumptions),
      complexity: asComplexity(raw.complexity),
      skill: asText(raw.skill),
      lessons: asStrings(raw.lessons).slice(0, 3),
      brief,
    }
  } catch {
    return null
  }
}

/** Steps 1 and 2: the quick request, without the conversation. */
export const analyseRequest = (args: {
  text: string
  model: string
  optimizerModel: string
  extras: Extras
}): ModelCompleteRequest => ({
  model: args.optimizerModel,
  system: ANALYSE_SYSTEM(profileOf(familyOf(args.model)).style, args.extras),
  prompt: `<prompt>\n${args.text}\n</prompt>`,
  maxTokens: 3000,
  effort: 'low',
  timeoutMs: TIMEOUT_MS,
})

/** The quick analysis's questions, for the fork to check against the conversation. */
const candidatesNote = (candidates: readonly string[]) =>
  candidates.length === 0
    ? ''
    : `\nEine Analyse ohne Verlauf hätte diese Fragen gestellt. Übernimm in questions nur die, die der Verlauf nicht beantwortet:\n${candidates.map(question => `- ${question}`).join('\n')}\n`

/**
 * The context request: one message appended to the session's own transcript,
 * so the analyser reads the whole conversation from the prompt cache.
 */
export const forkPrompt = (args: { text: string; model: string; extras: Extras; candidates: readonly string[] }) =>
  `[prompt-boost, interne Analyse. Führe nichts aus und rufe keine Werkzeuge auf.]
Die Person hat gerade diesen neuen Prompt geschrieben. Analysiere ihn vor dem Hintergrund des bisherigen Gesprächs und löse Verweise wie „wie oben" oder „Punkt 2" mit dem Verlauf auf.

<prompt>
${args.text}
</prompt>
${candidatesNote(args.candidates)}
${rules(profileOf(familyOf(args.model)).style, args.extras)}`

/** Step 4: the request that rewrites a subagent's task as a self-contained brief. */
export const agentRequest = (args: { prompt: string; targetModel: string; optimizerModel: string }): ModelCompleteRequest => ({
  model: args.optimizerModel,
  system: AGENT_SYSTEM(profileOf(familyOf(args.targetModel)).style),
  prompt: `<auftrag>\n${args.prompt}\n</auftrag>`,
  maxTokens: 4000,
  effort: 'low',
  timeoutMs: TIMEOUT_MS,
})

/** Keeps a rewrite only when it has not obviously dropped details. */
export const acceptAgentRewrite = (original: string, reply: string): string | null => {
  const text = reply.trim()

  return text.length >= original.length * MIN_REWRITE_RATIO ? text : null
}

const FAMILY_FOR: Record<Complexity, { family: ModelFamily; alias: string; label: string }> = {
  einfach: { family: 'fast', alias: 'haiku', label: 'Haiku' },
  mittel: { family: 'balanced', alias: 'sonnet', label: 'Sonnet' },
  schwer: { family: 'frontier', alias: 'opus', label: 'Opus' },
}

const RANK: Record<ModelFamily, number> = { fast: 0, balanced: 1, frontier: 2, unknown: -1 }

/**
 * Idea 4: a hint when the selected model clearly does not fit. Saving is
 * suggested for simple tasks only, so a big model on normal work stays quiet.
 */
export const modelTip = (current: ModelFamily, complexity: Complexity): string => {
  const fit = FAMILY_FOR[complexity]
  if (current === 'unknown' || current === fit.family) return ''
  if (RANK[current] < RANK[fit.family]) {
    return `Tipp: Die Aufgabe ist anspruchsvoll, ${fit.label} liefert hier verlässlicher (/model ${fit.alias}).`
  }

  if (complexity !== 'einfach') return ''

  return current === 'frontier'
    ? 'Tipp: Für diese einfache Aufgabe reicht Haiku oder Sonnet, das spart Kosten (/model sonnet).'
    : 'Tipp: Für diese einfache Aufgabe reicht Haiku, das spart Kosten (/model haiku).'
}
