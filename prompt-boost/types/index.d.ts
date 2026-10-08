/** How a prompt's optimized brief reaches the model. */
export type Mode = 'ergaenzen' | 'ersetzen' | 'aus'

/** Which kind of model a prompt is tuned for. */
export type ModelFamily = 'frontier' | 'balanced' | 'fast' | 'unknown'

/** How demanding the analyser judged a task. */
export type Complexity = 'einfach' | 'mittel' | 'schwer'

/** The result of analysing one prompt, shown in the pane. */
export type Analysis = {
  original: string
  model: string
  family: ModelFamily
  isSkipped: boolean
  usedContext: boolean
  reason: string
  intent: string
  gaps: string[]
  questions: string[]
  assumptions: string[]
  complexity: Complexity
  skill: string
  tip: string
  /** Writing tips for the person, from this very prompt. */
  lessons: string[]
  brief: string
  mode: Mode
  durationMs: number
}

/** One subagent prompt the mod rewrote, and how its report turned out. */
export type AgentRewrite = {
  agentId: string
  description: string
  subagentType: string
  model: string
  isOptimized: boolean
  before: number
  after: number
  /** Report sections the agent left out; null while it runs. */
  missing: string[] | null
  /** The type the main loop asked for when the mod routed it to a variant. */
  routedFrom: string | null
}

export type NoteKind = 'befund' | 'ausgeschlossen' | 'entscheidung'

/** One finding, dead end or decision the main loop recorded for agents. */
export type LagebildNote = {
  kind: NoteKind
  text: string
  /** ISO 8601, e.g. 2026-10-08T09:30:00.000Z */
  at: string
}

/** What the main loop knows, for every agent it starts. */
export type LagebildState = {
  notes: LagebildNote[]
  read: string[]
  changed: string[]
}

/** Whether a refused fork waits for the person's answer, or was approved. */
export type ForkGate = {
  isAsked: boolean
  isApproved: boolean
}

/** Rounds and tokens of one subagent, for the status band and its summary. */
export type AgentStat = {
  agentId: string
  label: string
  type: string
  model: string
  routedFrom: string | null
  rounds: number
  /** Context of the first request: the agent's fixed base plus its brief. */
  startContext: number
  lastContext: number
  /** Context summed over every request, cached reads included. */
  totalInput: number
  isDone: boolean
}

/** The rating band above the prompt after a boosted turn. */
export type RatingAsk = {
  intent: string
  model: string
  stage: 'frage' | 'notiz'
}

/** Where the processing of one prompt stands, for the status band. */
export type Progress = {
  phase: 'analyse' | 'verlauf' | 'fertig' | 'unveraendert' | 'fehler'
  /** True once the conversation was (or is being) read. */
  isReadingContext: boolean
  startedAt: number
  durationMs: number
  detail: string
}

/** One rating, kept in the store to learn the person's style. */
export type Feedback = {
  /** ISO 8601, e.g. 2026-10-08T09:30:00.000Z */
  at: string
  intent: string
  model: string
  rating: 'gut' | 'daneben'
  note: string
}

declare module 'claude-code' {
  interface PluginState {
    'prompt-boost': {
      last: Analysis | null
      agents: AgentRewrite[]
      rating: RatingAsk | null
      progress: Progress | null
      lagebild: LagebildState
      agentStats: AgentStat[]
      forkGate: ForkGate
    }
  }
}
