import { bashModifiedPaths } from './bash-paths'

/** Dateiendungen, die als Code gelten und den Lint-Hinweis auslösen. */
export const CODE_EXTENSIONS = [
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'mts', 'cts',
  'py', 'go', 'rs', 'swift', 'kt', 'java', 'cs', 'php', 'rb', 'vue', 'svelte',
] as const

/** Obergrenze für den Systemprompt-Abschnitt (R9). */
export const SECTION_LIMIT = 1200

/** Dateinamen, die nur von Hand gepflegt werden sollen (R8). Kleingeschrieben. */
const INSTRUCTION_FILE_NAMES: ReadonlySet<string> = new Set([
  'claude.md', 'claude.local.md', 'agents.md', 'skill.md',
])

/** Ordner, deren Inhalt als Anweisung an Claude gilt (R8). */
const INSTRUCTION_DIRS = ['/.claude/skills/', '/.claude/agents/', '/.claude/rules/'] as const

const CODE_EXTENSION_SET: ReadonlySet<string> = new Set(CODE_EXTENSIONS)

const WRITE_TOOLS: ReadonlySet<string> = new Set(['Edit', 'Write', 'MultiEdit'])

const SCP_URL = /^git@[^:/\s]+:(.+)$/
const REPO_NAME = /^[A-Za-z0-9._-]+$/
const GIT_SUFFIX = /\.git$/

const RULE_HEADING = '# Clean Code (Mod clean-code)'

const RULE_LINES = [
  '- R1 Nach jeder Code-Änderung den Linter laufen lassen und alle Befunde beheben.',
  '- R2 Streng typisieren, TypeScript mit strict statt JavaScript.',
  '- R3 Wiederkehrende Fehler als Lint-Regel festhalten, nicht als Prosa im Prompt.',
  '- R4 Bei Fragen zu einer Bibliothek zuerst den Quellcode im Referenzordner oder in node_modules lesen.',
  '- R5 Idiomatisch im Stil des Frameworks schreiben.',
  '- R6 Agentenfreundliche, explizite Techniken wählen und das Ökosystem prüfen.',
  '- R7 Die eleganteste, kompakteste und lesbarste Lösung wählen, nicht die aufgeblähte.',
  '- R8 CLAUDE.md, AGENTS.md und Skills nicht ohne Freigabe der Person ändern.',
] as const

type LintRule = {
  readonly when: (probe: LintProbe) => boolean
  readonly command: string
}

export type LintProbe = {
  readonly packageJson?: string
  readonly files: readonly string[]
}

export type DirectoryEntry = {
  readonly name: string
  readonly kind: 'file' | 'dir' | 'other'
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const baseNameOf = (path: string): string => path.split('/').pop()?.toLowerCase() ?? ''

/** Ob die Datei Code ist, nach der Endung, Groß- und Kleinschreibung egal. */
export const isCodeFile = (path: string): boolean => {
  const extension = /\.([a-z]+)$/i.exec(path)?.[1]?.toLowerCase()

  return extension !== undefined && CODE_EXTENSION_SET.has(extension)
}

/** Ob die Datei eine Anweisungsdatei ist, die nur von Hand geändert werden soll (R8). */
export const isInstructionFile = (path: string): boolean => {
  if (INSTRUCTION_FILE_NAMES.has(baseNameOf(path))) return true
  const anchored = `/${path}`

  return INSTRUCTION_DIRS.some(dir => anchored.includes(dir))
}

/** Ersetzt ein führendes `~` durch das Home-Verzeichnis. */
export const expandHome = (path: string, home: string): string => {
  if (path === '~') return home
  if (path.startsWith('~/')) return `${home}${path.slice(1)}`

  return path
}

/** Der Pfad einer https- oder git@-URL, sonst `undefined`. */
const pathOf = (url: string): string | undefined => {
  const scp = SCP_URL.exec(url)
  if (scp?.[1] !== undefined) return scp[1]

  try {
    const parsed = new URL(url)

    return parsed.protocol === 'https:' ? parsed.pathname : undefined
  } catch {
    return undefined
  }
}

/** Der Name des Repos aus einer Git-URL, ohne `.git`. Unbekannte Formen ergeben `undefined`. */
export const repoNameOf = (url: string): string | undefined => {
  const path = pathOf(url)
  if (path === undefined) return undefined

  const segment = path.split('/').filter(part => part !== '').pop()
  const name = segment?.replace(GIT_SUFFIX, '')
  const isUsable = name !== undefined && name !== '.' && name !== '..' && REPO_NAME.test(name)

  return isUsable ? name : undefined
}

const hasFile = (probe: LintProbe, name: string): boolean => probe.files.includes(name)

/** Ob die package.json ein `scripts.lint` hat. Kaputtes JSON gilt als „nein“. */
const hasLintScript = (packageJson: string | undefined): boolean => {
  if (packageJson === undefined) return false

  try {
    const parsed: unknown = JSON.parse(packageJson)

    return isRecord(parsed) && isRecord(parsed.scripts) && typeof parsed.scripts.lint === 'string'
  } catch {
    return false
  }
}

const OXLINT_CONFIG_FILES: readonly string[] = [
  '.oxlintrc.json', 'oxlint.config.ts', 'oxlint.config.mts', 'oxlint.config.js', 'oxlint.config.mjs',
]

const LINT_RULES: readonly LintRule[] = [
  { when: probe => hasLintScript(probe.packageJson), command: 'npm run lint' },
  { when: probe => OXLINT_CONFIG_FILES.some(file => hasFile(probe, file)), command: 'npx oxlint' },
  { when: probe => hasFile(probe, 'biome.json') || hasFile(probe, 'biome.jsonc'), command: 'npx biome check' },
  { when: probe => hasFile(probe, 'ruff.toml') || hasFile(probe, 'pyproject.toml'), command: 'ruff check' },
  { when: probe => hasFile(probe, 'Cargo.toml'), command: 'cargo clippy' },
  { when: probe => hasFile(probe, 'go.mod'), command: 'go vet ./...' },
]

/** Der Lint-Befehl des Projekts nach fester Reihenfolge, sonst `undefined`. */
export const detectLintCommand = (probe: LintProbe): string | undefined =>
  LINT_RULES.find(rule => rule.when(probe))?.command

/** Der Hinweis nach einer Code-Änderung (R1). */
export const lintHintText = (command?: string): string =>
  command === undefined
    ? 'Kein Linter erkannt. Vor dem Abschluss Typprüfung oder Tests laufen lassen und einen strengen Linter vorschlagen (etwa oxlint mit dem Preset Ultracite und strict).'
    : `Code geändert. Vor dem Abschluss \`${command}\` ausführen und alle Befunde beheben. Wiederkehrende Fehler als Lint-Regel vorschlagen statt als Prosa.`

const referenceText = (refs: readonly string[], refsDir: string, shownCount: number): string => {
  if (refs.length === 0) return 'Referenzordner leer, mit /ref-add <git-url> füllen.'

  const shown = refs.slice(0, shownCount).join(', ')
  const rest = refs.length - shownCount
  const tail = rest > 0 ? ` … und ${rest} weitere` : ''

  return `Referenzordner ${refsDir}: ${shown}${tail}. Bei Fragen zu diesen Bibliotheken zuerst dort den Quellcode lesen.`
}

const sectionWith = (refs: readonly string[], refsDir: string, shownCount: number): string =>
  [RULE_HEADING, ...RULE_LINES, referenceText(refs, refsDir, shownCount)].join('\n')

/**
 * Der Systemprompt-Abschnitt. Passt die volle Referenzliste nicht in
 * SECTION_LIMIT, kürzt er die Liste mit „… und N weitere“.
 */
export const rulesSection = (refs: readonly string[], refsDir: string): string => {
  for (let shownCount = refs.length; shownCount > 0; shownCount -= 1) {
    const section = sectionWith(refs, refsDir, shownCount)
    if (section.length <= SECTION_LIMIT) return section
  }

  return sectionWith(refs, refsDir, 0).slice(0, SECTION_LIMIT)
}

/** Die Begründung für Nachfrage bzw. Sperre einer Anweisungsdatei (R8). */
export const instructionGuardText = (path: string): string =>
  `Clean-Code-Regel R8 greift. ${path} wird von Hand gepflegt, nicht von Claude. Änderung nur nach ausdrücklicher Freigabe durch die Person.`

/** Modi, in denen keine Person ein `ask` beantwortet: auto gibt es an den Klassifizierer, bypassPermissions fragt gar nicht. */
const UNATTENDED_MODES: ReadonlySet<string> = new Set(['auto', 'bypassPermissions'])

/** Ob im Rechtemodus `mode` niemand eine Rückfrage sieht. Ein unbekannter Modus zählt nicht dazu. */
export const isUnattendedMode = (mode: string | undefined): boolean => mode !== undefined && UNATTENDED_MODES.has(mode)

/** Die Begründung der Sperre, wenn im Modus niemand rückfragen kann (R8). */
export const unattendedGuardText = (path: string): string =>
  `${instructionGuardText(path)} In diesem Rechtemodus beantwortet niemand die Rückfrage, deshalb gesperrt. Die Person kann den Modus kurz auf Standard stellen oder die Datei selbst ändern.`

/** Die Pfade, die ein Werkzeugaufruf schreibt. Bash wird über die Befehlsanalyse geprüft, Schreibwerkzeuge über `file_path`. Nimmt jeden Wert, weil die Tool-Union des Engines zu weit für einen engen Parameter ist. */
export const writtenPathsOf = (call: unknown): string[] => {
  if (!isRecord(call) || typeof call.tool !== 'string') return []
  if (call.tool === 'Bash') return typeof call.command === 'string' ? bashModifiedPaths(call.command) : []
  if (!WRITE_TOOLS.has(call.tool) || typeof call.file_path !== 'string') return []

  return [call.file_path]
}

const STRICT_HINT = 'tsconfig.json hat kein "strict": true. Für TypeScript strict aktivieren (R2).'

/** Per Regex statt JSON.parse, weil tsconfig Kommentare erlaubt. Bei `extends` kann strict geerbt sein, dann kein Hinweis. */
const isStrictEnabled = (tsconfig: string): boolean =>
  /"extends"\s*:/.test(tsconfig) || /"strict"\s*:\s*true/.test(tsconfig)

/** Der Hinweis, wenn die tsconfig strict nicht auf true setzt. `undefined` heißt: kein Hinweis nötig oder keine tsconfig vorhanden. */
export const strictHintText = (tsconfig: string | undefined): string | undefined => {
  if (tsconfig === undefined) return undefined

  return isStrictEnabled(tsconfig) ? undefined : STRICT_HINT
}

/** Die Namen der Unterordner, alphabetisch sortiert. Dateien fallen weg. */
export const directoryNames = (entries: readonly DirectoryEntry[]): string[] =>
  entries
    .filter(entry => entry.kind === 'dir')
    .map(entry => entry.name)
    .sort((a, b) => a.localeCompare(b))

/** Die Antwort des Befehls `/refs`. `undefined` heißt: der Ordner fehlt. */
export const refsListText = (names: readonly string[] | undefined, refsDir: string): string => {
  if (names === undefined) return `Referenzordner ${refsDir} fehlt. Mit /ref-add <git-url> anlegen.`
  if (names.length === 0) return `Referenzordner ${refsDir} ist leer. Mit /ref-add <git-url> füllen.`

  return `Referenzordner ${refsDir}:\n${names.map(name => `- ${name}`).join('\n')}`
}
