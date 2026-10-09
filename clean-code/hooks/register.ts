import type { EngineInterface, PromptComposeSection, Register } from 'claude-code'

import {
  detectLintCommand,
  directoryNames,
  expandHome,
  instructionGuardText,
  isCodeFile,
  isInstructionFile,
  isUnattendedMode,
  lintHintText,
  refsListText,
  repoNameOf,
  rulesSection,
  strictHintText,
  unattendedGuardText,
  writtenPathsOf,
} from './rules'
import type { DirectoryEntry } from './rules'

const DEFAULT_REFERENCES_DIR = '~/references'
const CLONE_TIMEOUT_MS = 120_000
const STDERR_LIMIT = 500
const RULES_SECTION_ID = 'clean-code:rules'

type GuardMode = 'fragen' | 'sperren' | 'aus'

type Settings = {
  readonly referencesDir: string
  readonly isLintHintOn: boolean
  readonly guardMode: GuardMode
}

type ProjectProbe = {
  readonly command: string | undefined
  readonly tsconfig: string | undefined
}

const asGuardMode = (value: unknown): GuardMode => (value === 'sperren' || value === 'aus' ? value : 'fragen')

const settingsOf = (options: Record<string, unknown>): Settings => {
  const referencesDir = String(options.referencesDir ?? '').trim()

  return {
    referencesDir: referencesDir === '' ? DEFAULT_REFERENCES_DIR : referencesDir,
    isLintHintOn: options.lintHint !== false,
    guardMode: asGuardMode(options.guardInstructionFiles),
  }
}

// Module state starts over on a reload, which suits all three below.
/** Ob der Lint-Hinweis in diesem Turn schon gegeben wurde. */
let isHintGivenThisTurn = false
/** Lint-Befehl und tsconfig der Session, einmal ermittelt. Beide Felder können `undefined` sein. */
let lintCache: ProjectProbe | undefined
/** Der zuletzt gemeldete Rechtemodus. classic.PreToolUse trägt ihn nicht, die übrigen klassischen Hooks schon. */
let permissionMode: string | undefined

/** Rückfrage mit `askText`, oder Sperre mit `denyText`, wenn im Modus niemand rückfragt. */
const guardAnswer = (askText: string, denyText: string): { ask: string } | { deny: string } =>
  isUnattendedMode(permissionMode) ? { deny: denyText } : { ask: askText }

const referencesPath = async ($: EngineInterface, referencesDir: string): Promise<string> => {
  const home = await $.env.get('HOME')

  return home === undefined ? referencesDir : expandHome(referencesDir, home)
}

/** Die Einträge des Referenzordners, `undefined` wenn der Ordner fehlt. */
const listEntries = async ($: EngineInterface, dir: string): Promise<DirectoryEntry[] | undefined> => {
  if (!(await $.fs.exists(dir))) return undefined

  return $.fs.list(dir)
}

/** Die Bibliotheksnamen für den Systemprompt. Fehler ergeben eine leere Liste und werden ins Debug-Log geschrieben. */
const referenceNamesOf = async ($: EngineInterface, referencesDir: string): Promise<string[]> => {
  try {
    const entries = await listEntries($, await referencesPath($, referencesDir))

    return entries === undefined ? [] : directoryNames(entries)
  } catch (error) {
    $.ui.log(`clean-code: Referenzordner nicht gelesen (${String(error)}).`, { to: 'debug' })

    return []
  }
}

const addReference = async ($: EngineInterface, referencesDir: string, args: string): Promise<string> => {
  const url = args.trim()
  if (url === '') return 'Verwendung: /ref-add <git-url>, zum Beispiel https://github.com/owner/repo.'

  const name = repoNameOf(url)
  if (name === undefined) return 'Ungültige Git-URL. Erlaubt sind https://… und git@…:… .'

  const dir = await referencesPath($, referencesDir)
  const target = `${dir}/${name}`
  if (await $.fs.exists(target)) return `Schon vorhanden: ${target}. Zum Aktualisieren dort von Hand git pull ausführen.`

  const result = await $.process.run(['git', 'clone', '--depth', '1', url, target], { timeoutMs: CLONE_TIMEOUT_MS })
  if (result.exitCode !== 0) {
    return `git clone endete mit Code ${result.exitCode}: ${result.stderr.trim().slice(0, STDERR_LIMIT)}`
  }

  return `Geholt: ${target}`
}

const listReferences = async ($: EngineInterface, referencesDir: string): Promise<string> => {
  const dir = await referencesPath($, referencesDir)
  const entries = await listEntries($, dir)

  return refsListText(entries === undefined ? undefined : directoryNames(entries), dir)
}

/** Lint-Befehl und tsconfig, einmal pro Session ermittelt. Fehler ergeben leere Werte und den allgemeinen Hinweis. */
const projectProbeOf = async ($: EngineInterface): Promise<ProjectProbe> => {
  if (lintCache === undefined) {
    lintCache = await detectProject($)
  }

  return lintCache
}

/** Der Text einer Datei im Projekt, `undefined` wenn sie nicht in der Liste steht. */
const readIfListed = async ($: EngineInterface, files: readonly string[], name: string): Promise<string | undefined> =>
  files.includes(name) ? $.fs.read(name) : undefined

const detectProject = async ($: EngineInterface): Promise<ProjectProbe> => {
  try {
    const files = (await $.fs.list()).map(entry => entry.name)
    const packageJson = await readIfListed($, files, 'package.json')
    const tsconfig = await readIfListed($, files, 'tsconfig.json')

    return { command: detectLintCommand({ packageJson, files }), tsconfig }
  } catch (error) {
    $.ui.log(`clean-code: Lint-Befehl nicht ermittelt (${String(error)}).`, { to: 'debug' })

    return { command: undefined, tsconfig: undefined }
  }
}

/** Lint-Hinweis, bei fehlendem strict um den Typhinweis ergänzt. */
const lintContextOf = async ($: EngineInterface): Promise<string> => {
  const { command, tsconfig } = await projectProbeOf($)
  const strictHint = strictHintText(tsconfig)

  return strictHint === undefined ? lintHintText(command) : `${lintHintText(command)} ${strictHint}`
}

export const register: Register = (on, options) => {
  const settings = settingsOf(options)

  on('session.start', async ($, e, next) => {
    lintCache = undefined
    await $.command.register({
      name: 'ref-add',
      description: 'Bibliothek als flachen Checkout in den Referenzordner holen',
      argumentHint: '<git-url>',
    })
    await $.command.register({ name: 'refs', description: 'Referenzordner auflisten' })

    return next(e)
  })

  on('turn.start', ($, e, next) => {
    isHintGivenThisTurn = false

    return next(e)
  })

  on('command.run', { command: 'ref-add' }, async ($, e) => ({
    text: await addReference($, settings.referencesDir, e.args),
  }))

  on('command.run', { command: 'refs' }, async $ => ({
    text: await listReferences($, settings.referencesDir),
  }))

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    const section: PromptComposeSection = {
      id: RULES_SECTION_ID,
      text: rulesSection(await referenceNamesOf($, settings.referencesDir), settings.referencesDir),
      scope: 'session',
    }

    return { sections: [...composed.sections, section] }
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    const paths = writtenPathsOf(e)
    if (paths.length === 0) return next(e)
    const guarded = paths.find(isInstructionFile)
    if (settings.guardMode === 'sperren' && guarded !== undefined) return { deny: instructionGuardText(guarded) }

    const ran = await next(e)
    const isHintDue = settings.isLintHintOn && paths.some(isCodeFile) && !isHintGivenThisTurn
    if (!isHintDue || ran.deny !== undefined || ran.isError === true) return ran

    isHintGivenThisTurn = true

    return { ...ran, context: [...(ran.context ?? []), await lintContextOf($)] }
  }).catch(($, e, next) => (next.called ? next(e) : { deny: 'clean-code: Prüfung fehlgeschlagen.' }))

  // Ein ask geht an den Entscheider des Modus, im Modus auto an den Klassifizierer. Deshalb den Modus mitlesen.
  on('classic.UserPromptSubmit', ($, e, next) => {
    permissionMode = e.permission_mode ?? permissionMode

    return next(e)
  }).catch(($, e, next) => next(e))

  on('classic.PostToolUse', ($, e, next) => {
    permissionMode = e.permission_mode ?? permissionMode

    return next(e)
  }).catch(($, e, next) => next(e))

  // classic.PreToolUse trägt denselben ToolCallEnvelope wie tool.call, also auch tool und command bei Bash.
  on('classic.PreToolUse', async ($, e, next) => {
    const guarded = writtenPathsOf(e).find(isInstructionFile)
    if (settings.guardMode !== 'fragen' || guarded === undefined) return next(e)

    return guardAnswer(instructionGuardText(guarded), unattendedGuardText(guarded))
  }).catch(($, e, next) =>
    next.called
      ? next(e)
      : guardAnswer('clean-code: Prüfung fehlgeschlagen. Bitte die Änderung selbst bestätigen.', 'clean-code: Prüfung fehlgeschlagen.'),
  )
}
