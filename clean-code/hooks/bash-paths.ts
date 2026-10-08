/**
 * Erkennt, welche Pfade ein Bash-Befehl schreibt, anlegt, verschiebt oder löscht.
 *
 * Kein vollständiger Shell-Parser. Bekannte Grenzen:
 * - Erkannt werden tee, sed -i, perl -i, cp, install, mv, rm, touch sowie die Umleitungen
 *   `>`, `>>`, `&>` und `>|`. Alles andere (python -c, node, dd of=, git apply, Editoren) bleibt unerkannt.
 * - Befehlsersetzungen `$(...)` und Backticks gelten als Trennung. Verschachtelte Ersetzungen
 *   innerhalb doppelter Anführungszeichen werden nicht ausgewertet.
 * - Keine Auflösung von Variablen, Glob-Mustern oder `~`: `rm *.ts` liefert `*.ts`.
 * - cp -t und mv -t (Zielordner vorab) liefern das falsche Ziel. install -d meldet nur das letzte Argument.
 * - mv meldet Quelle und Ziel, weil auch die Quelle verschwindet.
 * - Die Heredoc-Erkennung kennt keinen Anführungskontext: `echo "<<EOF"` startet einen Heredoc.
 * - Umleitungen auf /dev/... und Eingabeumleitungen zählen nicht.
 */

/** Ein Wort mit seiner Position im Befehl, damit Ziele in Textreihenfolge erscheinen. */
type Word = { readonly value: string; readonly pos: number }

/** Ein einfacher Befehl: seine Argumente und die Ziele seiner Umleitungen. */
type Command = { readonly words: readonly Word[]; readonly writes: readonly Word[] }

type Token =
  | { readonly kind: 'word'; readonly value: string }
  | { readonly kind: 'redirect'; readonly mode: 'write' | 'skip' }
  | { readonly kind: 'sep' }

const HEREDOC = /(?<!<)<<(?!<)(-?)\s*(['"]?)([A-Za-z_]\w*)\2/g
const ASSIGNMENT = /^[A-Za-z_]\w*=/
const DIGITS = /^\d+$/
const SED_IN_PLACE = /^-[nErsuz]*i/
const PERL_IN_PLACE = /^-[pnlaFs0-9]*i/
const SCRIPT_FLAGS: ReadonlySet<string> = new Set(['-e', '-f'])
const SEPARATOR_CHARS: ReadonlySet<string> = new Set([';', '\n', '(', ')', '`'])
const DEVICE_PREFIX = '/dev/'

const isOption = (value: string): boolean => value.startsWith('-') && value !== '-'

const basenameOf = (value: string): string => value.split('/').pop() ?? value

/** Entfernt Heredoc-Inhalte, behält aber die Kopfzeile samt Umleitungen. */
const stripHeredocBodies = (command: string): string => {
  const pending: { readonly delimiter: string; readonly stripTabs: boolean }[] = []
  const kept: string[] = []

  for (const line of command.split('\n')) {
    const open = pending[0]
    if (open !== undefined) {
      const candidate = open.stripTabs ? line.replace(/^\t+/, '') : line
      if (candidate === open.delimiter) pending.shift()
      continue
    }
    for (const match of line.matchAll(HEREDOC)) {
      pending.push({ delimiter: match[3] ?? '', stripTabs: match[1] === '-' })
    }
    kept.push(line.replace(HEREDOC, ' '))
  }

  return kept.join('\n')
}

/** Liest einen Anführungsblock ab `start`. `end` zeigt auf das schließende Zeichen. */
const scanQuoted = (text: string, start: number): { readonly content: string; readonly end: number } => {
  const isSingle = text.charAt(start) === "'"
  const closing = isSingle ? "'" : '"'
  let content = ''
  let index = start + 1

  while (index < text.length && text.charAt(index) !== closing) {
    const char = text.charAt(index)
    if (!isSingle && char === '\\' && index + 1 < text.length) {
      const escaped = text.charAt(index + 1)
      content += '"\\$`\n'.includes(escaped) ? escaped : `\\${escaped}`
      index += 2
    } else {
      content += char
      index += 1
    }
  }

  return { content, end: index }
}

/** Zerlegt den Text in Wörter, Umleitungen und Trenner. Anführungszeichen und Kommentare werden beachtet. */
const tokenize = (text: string): Token[] => {
  const tokens: Token[] = []
  let buffer = ''
  let hasBuffer = false

  const flush = (): void => {
    if (hasBuffer) tokens.push({ kind: 'word', value: buffer })
    buffer = ''
    hasBuffer = false
  }
  const add = (token: Token): void => {
    flush()
    tokens.push(token)
  }

  for (let index = 0; index < text.length; index += 1) {
    const char = text.charAt(index)
    const next = text.charAt(index + 1)

    if (char === ' ' || char === '\t' || char === '\r') {
      flush()
    } else if (char === '#' && !hasBuffer) {
      const lineEnd = text.indexOf('\n', index)
      if (lineEnd === -1) break
      index = lineEnd - 1
    } else if (char === '\\') {
      if (next !== '\n' && next !== '') {
        buffer += next
        hasBuffer = true
      }
      index += 1
    } else if (char === "'" || char === '"') {
      const quoted = scanQuoted(text, index)
      buffer += quoted.content
      hasBuffer = true
      index = quoted.end
    } else if (char === '>') {
      if (hasBuffer && DIGITS.test(buffer)) {
        buffer = ''
        hasBuffer = false
      } else {
        flush()
      }
      const writeEnd = next === '>' ? index + 1 : index
      const marker = text.charAt(writeEnd + 1)
      tokens.push({ kind: 'redirect', mode: marker === '&' ? 'skip' : 'write' })
      index = writeEnd + (marker === '&' || marker === '|' ? 1 : 0)
    } else if (char === '&' && next === '>') {
      add({ kind: 'redirect', mode: 'write' })
      index += text.charAt(index + 2) === '>' ? 2 : 1
    } else if (char === '&' || char === '|') {
      add({ kind: 'sep' })
      if (next === char) index += 1
    } else if (char === '<') {
      add({ kind: 'redirect', mode: 'skip' })
      while (text.charAt(index + 1) === '<') index += 1
      if (text.charAt(index + 1) === '&') index += 1
    } else if (SEPARATOR_CHARS.has(char)) {
      add({ kind: 'sep' })
    } else {
      buffer += char
      hasBuffer = true
    }
  }

  flush()

  return tokens
}

/** Gruppiert die Tokens in einfache Befehle. Die Position eines Wortes ist seine Stelle im Token-Strom. */
const toCommands = (tokens: readonly Token[]): Command[] => {
  const commands: Command[] = []
  let words: Word[] = []
  let writes: Word[] = []
  let pending = undefined as 'write' | 'skip' | undefined

  const endCommand = (): void => {
    if (words.length > 0 || writes.length > 0) commands.push({ words, writes })
    words = []
    writes = []
    pending = undefined
  }

  for (const [pos, token] of tokens.entries()) {
    if (token.kind === 'sep') {
      endCommand()
    } else if (token.kind === 'redirect') {
      pending = token.mode
    } else {
      if (pending === undefined) words.push({ value: token.value, pos })
      else if (pending === 'write') writes.push({ value: token.value, pos })
      pending = undefined
    }
  }
  endCommand()

  return commands
}

/** Überspringt Variablenzuweisungen und ein führendes sudo samt Optionen. */
const skipPrefix = (words: readonly Word[]): readonly Word[] => {
  let index = 0
  let afterSudo = false

  while (index < words.length) {
    const value = words[index]?.value ?? ''
    const isPrefix = ASSIGNMENT.test(value) || value === 'sudo' || (afterSudo && isOption(value))
    if (!isPrefix) break
    afterSudo = afterSudo || value === 'sudo'
    index += 1
  }

  return words.slice(index)
}

const positionalOf = (args: readonly Word[]): Word[] => args.filter(word => !isOption(word.value))

/** Das letzte von mindestens zwei Argumenten, sonst nichts. */
const lastOf = (words: readonly Word[]): Word[] => {
  const last = words[words.length - 1]

  return words.length >= 2 && last !== undefined ? [last] : []
}

/**
 * Zielt sed und perl mit In-place-Schalter. Ohne -e/-f ist das erste Argument das Skript,
 * mit -e/-f sind alle Argumente Dateien. Das leere Suffix von macOS (`-i ''`) wird übersprungen.
 */
const inPlaceTargets = (args: readonly Word[], inPlace: RegExp): Word[] => {
  const positional: Word[] = []
  let enabled = false
  let hasScript = false
  let index = 0

  while (index < args.length) {
    const word = args[index]
    const value = word?.value ?? ''
    index += 1

    if (SCRIPT_FLAGS.has(value)) {
      hasScript = true
      index += 1
    } else if (inPlace.test(value) || value.startsWith('--in-place')) {
      enabled = true
      if (value === '-i' && args[index]?.value === '') index += 1
    } else if (word !== undefined && !isOption(value)) {
      positional.push(word)
    }
  }

  if (!enabled) return []

  return hasScript ? positional : positional.slice(1)
}

/** Die Ziele, die ein einzelner Befehl über seinen Namen und seine Argumente verändert. */
const toolWrites = (words: readonly Word[]): Word[] => {
  const [head, ...args] = skipPrefix(words)
  if (head === undefined) return []

  switch (basenameOf(head.value)) {
    case 'tee':
    case 'rm':
    case 'touch':
    case 'mv':
      return positionalOf(args)
    case 'cp':
    case 'install':
      return lastOf(positionalOf(args))
    case 'sed':
      return inPlaceTargets(args, SED_IN_PLACE)
    case 'perl':
      return inPlaceTargets(args, PERL_IN_PLACE)
    default:
      return []
  }
}

const isNonFileTarget = (value: string): boolean => value === '' || value.startsWith(DEVICE_PREFIX)

/** Alle Ziele eines Befehls in Textreihenfolge, ohne Gerätedateien. */
const writesOf = (command: Command): Word[] =>
  [...toolWrites(command.words), ...command.writes]
    .filter(word => !isNonFileTarget(word.value))
    .sort((a, b) => a.pos - b.pos)

/** Die Pfade, die der Bash-Befehl schreibt, anlegt, verschiebt oder löscht. Ohne Duplikate, in Reihenfolge des Auftretens. */
export const bashModifiedPaths = (command: string): string[] => {
  const commands = toCommands(tokenize(stripHeredocBodies(command)))
  const paths = commands.flatMap(writesOf).map(word => word.value)

  return [...new Set(paths)]
}
