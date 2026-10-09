import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { FsEntry, On, ToolCallResult } from 'claude-code'

const PACKAGE_JSON = '{"scripts":{"lint":"oxlint"}}'

type Seen = { toolRuns: number }

type ToolCall = (input: Record<string, string>) => Promise<ToolCallResult>

/**
 * Ein Edit-Aufruf über $.tool.call. Der Aufruf läuft über einen lockeren Typ,
 * weil die sehr große MCP-Werkzeugliste dieser Umgebung die genaue
 * Typprüfung sprengt (TS2589, dasselbe Problem hat prompt-boost).
 */
const editFile = ($: Engine, filePath: string): Promise<ToolCallResult> =>
  ($.tool.call as unknown as ToolCall)({ tool: 'Edit', file_path: filePath, old_string: 'a', new_string: 'b' })

/** Ein Bash-Aufruf über $.tool.call, mit demselben lockeren Typ. */
const runBash = ($: Engine, command: string): Promise<ToolCallResult> =>
  ($.tool.call as unknown as ToolCall)({ tool: 'Bash', command })

/** Der Motor unter dem Plugin: Umgebung, Dateisystem der Session und der Werkzeuglauf. */
const world = (on: On, files: readonly string[], tsconfig?: string): Seen => {
  const seen: Seen = { toolRuns: 0 }
  const entries: FsEntry[] = files.map(name => ({
    name,
    kind: 'file',
    size: 0,
    mtimeMs: 0,
    isLink: false,
  }))

  on('env.get', ($, e) => ({ value: e.name === 'HOME' ? '/Users/test' : undefined }))
  on('fs.list', () => ({ value: entries }))
  on('fs.read', ($, e) => {
    if (e.path.endsWith('package.json')) return { value: PACKAGE_JSON }
    if (e.path.endsWith('tsconfig.json') && tsconfig !== undefined) return { value: tsconfig }

    return { deny: 'nicht gefunden' }
  })
  on('ui.log', () => ({ value: undefined }))
  on('classic.UserPromptSubmit', () => ({}))
  on('classic.PostToolUse', () => ({}))
  on('tool.call', () => {
    seen.toolRuns += 1

    return { result: 'ok' }
  })

  return seen
}

describe('lint hint', () => {
  test('Edit auf eine .ts-Datei liefert den Lint-Hinweis im context', async ($, on) => {
    world(on, ['package.json', 'src'])

    const ran = await editFile($, '/repo/src/tax.ts')

    expect(ran.context?.join('\n') ?? '').toContain('npm run lint')
  })

  test('Edit auf README.md liefert keinen Hinweis', async ($, on) => {
    world(on, ['package.json', 'src'])

    const ran = await editFile($, '/repo/README.md')

    expect(ran.context).toBeUndefined()
  })

  test('Bash mit Umleitung auf eine .ts-Datei liefert den Lint-Hinweis genau einmal', async ($, on) => {
    world(on, ['package.json', 'src'])

    const first = await runBash($, 'echo x > src/a.ts')
    const second = await runBash($, 'echo y > src/b.ts')

    expect(first.context?.join('\n') ?? '').toContain('npm run lint')
    expect(second.context).toBeUndefined()
  })

  test('der Lint-Hinweis enthält den strict-Satz, wenn die tsconfig strict nicht setzt', async ($, on) => {
    world(on, ['package.json', 'tsconfig.json'], '{ "compilerOptions": { "target": "es2022" } }')

    const ran = await editFile($, '/repo/src/tax.ts')

    expect(ran.context?.join('\n') ?? '').toContain('strict')
  })

  test('der Lint-Hinweis enthält keinen strict-Satz, wenn strict gesetzt ist', async ($, on) => {
    world(on, ['package.json', 'tsconfig.json'], '{ "compilerOptions": { "strict": true } }')

    const ran = await editFile($, '/repo/src/tax.ts')

    expect(ran.context?.join('\n') ?? '').not.toContain('tsconfig.json hat kein')
  })
})

describe('instruction guard', () => {
  test('mit sperren wird Edit auf CLAUDE.md verweigert, bevor das Werkzeug läuft', { options: { guardInstructionFiles: 'sperren' } }, async ($, on) => {
    const seen = world(on, ['package.json'])

    const ran = await editFile($, '/repo/CLAUDE.md')

    expect(ran.deny ?? '').toContain('R8')
    expect(seen.toolRuns).toBe(0)
  })

  test('mit sperren wird Bash sed -i auf CLAUDE.md verweigert, bevor das Werkzeug läuft', { options: { guardInstructionFiles: 'sperren' } }, async ($, on) => {
    const seen = world(on, ['package.json'])

    const ran = await runBash($, "sed -i '' s/a/b/ CLAUDE.md")

    expect(ran.deny ?? '').toContain('R8')
    expect(seen.toolRuns).toBe(0)
  })

  test('mit sperren bleibt Bash cat CLAUDE.md erlaubt', { options: { guardInstructionFiles: 'sperren' } }, async ($, on) => {
    const seen = world(on, ['package.json'])

    const ran = await runBash($, 'cat CLAUDE.md')

    expect(ran.deny).toBeUndefined()
    expect(seen.toolRuns).toBe(1)
  })

  test('mit sperren wird ein Pfad unter .claude/rules/ verweigert', { options: { guardInstructionFiles: 'sperren' } }, async ($, on) => {
    world(on, ['package.json'])

    const ran = await editFile($, '/repo/.claude/rules/stil.md')

    expect(ran.deny ?? '').toContain('R8')
  })

  test('mit fragen wird Edit auf CLAUDE.md im Modus auto verweigert, weil niemand die Rückfrage beantwortet', async ($, on) => {
    const seen = world(on, ['package.json'])
    await $.classic.UserPromptSubmit({ prompt: 'los', permission_mode: 'auto' })

    const ran = await editFile($, '/repo/CLAUDE.md')

    expect(ran.isError).toBe(true)
    expect(ran.text ?? '').toContain('R8')
    expect(seen.toolRuns).toBe(0)
  })

  test('mit fragen wird Bash sed -i auf CLAUDE.md im Modus bypassPermissions verweigert', async ($, on) => {
    const seen = world(on, ['package.json'])
    await $.classic.UserPromptSubmit({ prompt: 'los', permission_mode: 'bypassPermissions' })

    const ran = await runBash($, "sed -i '' s/a/b/ CLAUDE.md")

    expect(ran.isError).toBe(true)
    expect(seen.toolRuns).toBe(0)
  })

  test('ein späterer Wechsel auf default hebt die Sperre wieder auf', async ($, on) => {
    world(on, ['package.json'])
    await $.classic.UserPromptSubmit({ prompt: 'los', permission_mode: 'auto' })
    await $.classic.UserPromptSubmit({ prompt: 'weiter', permission_mode: 'default' })

    const ran = await editFile($, '/repo/CLAUDE.md')

    expect(ran.text ?? '').not.toContain('niemand')
  })
})
