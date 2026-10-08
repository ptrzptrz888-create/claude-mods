import type { PluginOptions } from 'claude-code'

import type { AgentStat, ForkGate } from '../types'

/** The six levers of "Sparsame Agenten", each with its own switch. */
export type LeanSettings = {
  isRoutingOn: boolean
  isBriefGateOn: boolean
  isLagebildOn: boolean
  isForkGateOn: boolean
  isRoundWarningOn: boolean
  isAgentDisplayOn: boolean
}

export const leanSettingsOf = (options: PluginOptions): LeanSettings => ({
  isRoutingOn: options.leanAgents !== false,
  isBriefGateOn: options.briefGate !== false,
  isLagebildOn: options.lagebild !== false,
  isForkGateOn: options.forkGate !== false,
  isRoundWarningOn: options.roundWarning !== false,
  isAgentDisplayOn: options.agentDisplay !== false,
})

export type VariantName = 'suche' | 'umsetzung' | 'pruefung'

export const PLUGIN = 'prompt-boost'
export const GENERAL_PURPOSE = 'general-purpose'
export const variantType = (name: VariantName) => `${PLUGIN}:${name}`

/** Rounds at which a running agent is told to check whether it is done. */
export const ROUND_WARNINGS: readonly number[] = [25, 40]

/** What every lean variant keeps of the person's rules without CLAUDE.md. */
const CORE_RULES = `Regeln:
- Antworte auf Deutsch. Schreibe immer „KI“, nie „AI“. Keine Gedankenstriche als Satztrenner.
- Recht, Steuern und Buchhaltung gelten nach deutschem und EU-Recht, nie nach US-Recht.
- Starte keine weiteren Agenten, Subagenten oder Workflows.
- Nutze absolute Pfade. Das Arbeitsverzeichnis steht im Lagebild.
- Lösche oder überschreibe nichts, was der Auftrag nicht ausdrücklich nennt.
- Behaupte nichts, was du nicht geprüft hast. Halte dich an „Fertig wenn“ und hör dann auf.`

const ROLE: Record<VariantName, string> = {
  suche:
    'Du bist ein Such- und Leseagent. Du findest Stellen, liest gezielt und fasst zusammen. ' +
    'Du änderst keine Dateien. Bash nutzt du nur lesend (ls, git log, git diff, rg und Ähnliches).',
  umsetzung:
    'Du bist ein Umsetzungsagent. Du änderst Code und Dateien im genannten Umfang, ' +
    'liest vorher nur die nötigen Stellen und prüfst dein Ergebnis mit einem passenden Befehl.',
  pruefung:
    'Du bist ein Prüfagent. Du führst Tests, Messungen und Prüfbefehle aus und berichtest, was sie zeigen. ' +
    'Du änderst keine Dateien.',
}

const DESCRIPTION: Record<VariantName, string> = {
  suche: 'Schlanker Such- und Leseagent (haiku, nur lesende Werkzeuge). Für Suchen, Lesen, Zusammenfassen.',
  umsetzung: 'Schlanker Umsetzungsagent (sonnet, Lesen, Bash, Edit, Write). Für Änderungen an Code und Dateien.',
  pruefung: 'Schlanker Prüfagent (sonnet, lesend plus Bash). Für Tests, Messungen und Verifikation.',
}

const READ_TOOLS = ['Read', 'Grep', 'Glob', 'Bash'] as const

const TOOLS: Record<VariantName, readonly string[]> = {
  suche: READ_TOOLS,
  umsetzung: [...READ_TOOLS, 'Edit', 'Write'],
  pruefung: READ_TOOLS,
}

const MODEL: Record<VariantName, string> = { suche: 'haiku', umsetzung: 'sonnet', pruefung: 'sonnet' }

export const VARIANTS: readonly VariantName[] = ['suche', 'umsetzung', 'pruefung']

/** The agent definition `$.agent.register` takes for one variant. */
export const variantSpec = (name: VariantName) => ({
  name,
  description: DESCRIPTION[name],
  prompt: `${ROLE[name]}\n\n${CORE_RULES}`,
  tools: TOOLS[name],
  model: MODEL[name],
  omitClaudeMd: true as const,
})

// Matched on word starts. `\b` treats umlauts as non-letters, so a start is
// "no letter before" here, with the u flag: „Ändere“ counts, „Beschreibe“ not.
const START = '(?<!\\p{L})'
const words = (list: string) => new RegExp(`${START}(${list})`, 'iu')

const NEEDS_FULL_TOOLS = words(
  'browser|mcp__|webfetch|websearch|playwright|chrome|scrapling|firecrawl|internet|subagent|workflow|obsidian',
)
const EDIT_WORDS = words(
  'änder|aender|implementier|schreib|fix|bau|erstell|refaktor|ergänz|ergaenz|anpass|lösch|loesch|entfern|umbenenn|edit|write|implement|create|refactor|add',
)
const CHECK_WORDS = words('test|prüf|pruef|miss|mess|verifizier|validier|verify|check|benchmark')
const SEARCH_WORDS = words(
  'such|find|lies|lese|recherchier|analysier|untersuch|zeig|list|welche|wo(?!\\p{L})|wie viele|search|read|locate|explore|überblick|übersicht|zusammenfass',
)

const LABEL_LINE = /^[\s>*#-]*\**\s*([A-Za-zÄÖÜäöü ,]{2,24}?)\s*\**\s*:/

/** The `Ziel:` part of a brief when it has one, else the whole brief. */
const goalOf = (prompt: string): string => {
  const lines = prompt.split('\n')
  const start = lines.findIndex(line => /^(ziel|goal)$/i.test(LABEL_LINE.exec(line)?.[1]?.trim() ?? ''))
  if (start === -1) return prompt
  const rest = lines.slice(start + 1)
  const end = rest.findIndex(line => LABEL_LINE.test(line) || line.startsWith('#'))
  const body = [lines[start] ?? '', ...(end === -1 ? rest : rest.slice(0, end))]

  return body.join('\n').replace(LABEL_LINE, '').trim()
}

/**
 * Which lean variant a general-purpose brief goes to, or null when it needs
 * tools no variant has. Mixed or unclear briefs go to `umsetzung`: dearer,
 * but never short of a tool halfway through.
 */
export const classify = (prompt: string): VariantName | null => {
  if (NEEDS_FULL_TOOLS.test(prompt)) return null
  const goal = goalOf(prompt)
  if (EDIT_WORDS.test(goal)) return 'umsetzung'
  if (CHECK_WORDS.test(goal)) return 'pruefung'

  return SEARCH_WORDS.test(goal) ? 'suche' : 'umsetzung'
}

const FIELD_PATTERNS: readonly (readonly [string, RegExp])[] = [
  ['Ziel', /(?:^|\n)[\s>*#-]*\**\s*(?:ziel|goal|zweck)\b/i],
  ['Fertig wenn', /(?:^|\n)[\s>*#-]*\**\s*(?:fertig,? wenn|done when|endkriterium|abbruchkriterium)\b/i],
  ['Rückgabe', /(?:^|\n)[\s>*#-]*\**\s*(?:rückgabe|rueckgabe|return|ausgabeformat|berichtsformat)\b/i],
]

/** The mandatory brief fields a prompt leaves out, by their German label. */
export const missingBriefFields = (prompt: string): string[] =>
  FIELD_PATTERNS.filter(([, pattern]) => !pattern.test(prompt)).map(([label]) => label)

export const briefDenial = (missing: readonly string[]) =>
  `prompt-boost: Briefing unvollständig, es fehlt ${missing.join(', ')}. ` +
  'Ohne Endkriterium und Rückgabeformat braucht ein Agent die meisten Runden. ' +
  'Stell den Auftrag noch einmal mit diesen Feldern:\n' +
  'Ziel: …\nKontext: … (Pfade, bisherige Befunde, Ausgeschlossenes)\nGrenzen: …\nFertig wenn: …\nRückgabe: …\n' +
  'Ein zweiter Versuch mit derselben Beschreibung geht in jedem Fall durch.'

export const FORK_DENIAL =
  'prompt-boost: Ein Fork erbt den kompletten Gesprächsverlauf und startet mit bis zu 180k Tokens. ' +
  'Frag die Person im Chat, ob sie diesen Fork freigibt, und nenne kurz den Grund. ' +
  'Stimmt sie zu, geht genau ein Fork durch. Sonst starte einen normalen Agenten mit vollständigem Briefing.'

const AFFIRMATIVE = /^\s*(ja|jo|jep|ok|okay|yes|klar|gerne|passt|mach|los|fork|freigegeben)\b/i

/** Whether the person's reply approves the fork the main loop asked about. */
export const isApproval = (text: string) => AFFIRMATIVE.test(text)

/** The fork gate after the person's next prompt: approved once, or closed. */
export const settleFork = (gate: ForkGate, text: string): ForkGate => ({
  isAsked: false,
  isApproved: gate.isAsked && isApproval(text),
})

export const LAGEBILD_TOOL = 'Lagebild'
export const LAGEBILD_TOOL_ID = `mcp__${PLUGIN}__${LAGEBILD_TOOL}`
export const LAGEBILD_COMMAND = 'lagebild'
export const COSTS_COMMAND = 'agent-kosten'

/** The tool the main loop records findings with; deferred off, so it is at hand. */
export const LAGEBILD_TOOL_SPEC = {
  name: LAGEBILD_TOOL,
  description:
    'Hält einen Befund, eine ausgeschlossene Spur oder eine Entscheidung fürs Lagebild fest, ' +
    'das jeder neue Subagent mitbekommt. Ein kurzer Satz pro Aufruf, mit Pfad oder Messwert, wenn vorhanden.',
  inputSchema: {
    type: 'object',
    properties: {
      art: { type: 'string', enum: ['befund', 'ausgeschlossen', 'entscheidung'] },
      text: { type: 'string', description: 'Ein Satz, z. B. „Steuerlogik liegt in src/tax.ts:40“.' },
    },
    required: ['art', 'text'],
  },
  isDeferred: false,
} as const

export const LEAN_COMMANDS = [
  { name: LAGEBILD_COMMAND, description: 'Zeigt das Lagebild, das neue Agenten bekommen' },
  { name: COSTS_COMMAND, description: 'Misst die Tokenkosten der Subagenten vor und seit „Sparsame Agenten“' },
] as const

/** The note a running agent gets at a warning round. */
export const roundNote = (round: number) =>
  `[prompt-boost] Runde ${round}. Prüfe, ob „Fertig wenn“ erreicht ist. ` +
  'Wenn ja, schließ jetzt mit dem Bericht ab. Wenn nein, nenne im Bericht, was dich aufhält, statt weiter zu suchen.'

/** 67753 → "68k", 7802540 → "7,8 Mio." */
export const formatTokens = (tokens: number): string => {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1).replace('.', ',')} Mio.`
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k`

  return String(tokens)
}

/** One running agent in the status band. */
export const agentLine = (stat: AgentStat) =>
  `${stat.type.replace(`${PLUGIN}:`, '')} · ${stat.label} · Runde ${stat.rounds} · ${formatTokens(stat.lastContext)} Kontext`

/** The person's line after an agent ended. */
export const summaryLine = (stat: AgentStat) =>
  `prompt-boost: Agent „${stat.label}“ fertig (${stat.type}` +
  (stat.routedFrom === null ? '' : `, umgeleitet von ${stat.routedFrom}`) +
  `, ${stat.model}) · ${stat.rounds} Runden · Start ${formatTokens(stat.startContext)}` +
  ` · Summe ${formatTokens(stat.totalInput)} Input`
