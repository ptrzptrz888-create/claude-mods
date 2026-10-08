import { describe, expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { classify, formatTokens, missingBriefFields, settleFork } from '../hooks/lean-agents'
import { MAX_LAGEBILD_CHARS, renderLagebild, withFile, withNote } from '../hooks/lagebild'

const NO_REWRITE = { options: { optimizeAgents: false } } as const
const USAGE = { input_tokens: 2_000, output_tokens: 300, cache_read_input_tokens: 20_000, cache_creation_input_tokens: 0 }
const FULL_BRIEF = 'Ziel: Finde alle Stellen, an denen die Steuer berechnet wird.\nFertig wenn: Liste vollständig.\nRückgabe: Datei:Zeile.'

type Seen = {
  spawned: { prompt: string; subagentType: string }[]
  appended: { agentId?: string; text: string }[]
  logs: string[]
}

/** The engine beneath the plugin: store, clock, cwd, git, spawn, log, append. */
const world = (on: On): Seen => {
  const seen: Seen = { spawned: [], appended: [], logs: [] }
  const store = new Map<string, unknown>()
  on('store.get', ($, e) => ({ value: store.get(e.key) }))
  on('store.set', ($, e) => {
    store.set(e.key, e.value)

    return { value: undefined }
  })
  on('clock.now', () => ({ value: Date.UTC(2026, 9, 8, 9, 30) }))
  on('session.cwd', () => ({ value: '/repo' }))
  on('process.run', () => ({
    value: { exitCode: 0, stdout: '## main\n M src/tax.ts', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  on('ui.log', ($, e) => {
    seen.logs.push(e.text)

    return { value: undefined }
  })
  on('ui.toast', () => ({ value: undefined }))
  on('session.append', ($, e, next) => {
    const block = e.message.content[0]
    seen.appended.push({ agentId: e.agentId, text: block !== undefined && 'text' in block ? String(block.text) : '' })

    return next(e)
  })
  on('agent.spawn', ($, e) => {
    seen.spawned.push({ prompt: e.prompt, subagentType: e.subagentType })

    return { model: 'claude-haiku-5-5', agentId: `a${seen.spawned.length}` }
  })
  on('tool.call', () => ({ result: 'ok' }))
  on('turn.complete', ($, e) => ({ text: e.answer }))

  return seen
}

const spawnOf = (prompt: string, fields: Record<string, unknown> = {}) =>
  ({
    tool_use_id: 't1',
    prompt,
    description: 'Steuerstellen finden',
    subagentType: 'general-purpose',
    provider: { plugin: 'engine', tier: 'core' },
    parentModel: 'claude-opus-5-5',
    background: false,
    fork: false,
    ...fields,
  }) as const

describe('briefing gate', () => {
  test('refuses a brief without Fertig wenn and Rückgabe once, then lets the retry through', NO_REWRITE, async ($, on) => {
    const seen = world(on)
    const thin = spawnOf('Finde alle Stellen, an denen die Steuer berechnet wird.')

    const first = await $.agent.spawn(thin)
    const second = await $.agent.spawn(thin)

    expect(first.deny ?? '').toContain('Fertig wenn, Rückgabe')
    expect(second.agentId).toBe('a1')
    expect(seen.spawned).toHaveLength(1)
  })
})

describe('routing to lean variants', () => {
  test('sends a search brief to prompt-boost:suche and keeps an explicit type', NO_REWRITE, async ($, on) => {
    const seen = world(on)

    await $.agent.spawn(spawnOf(FULL_BRIEF))
    await $.agent.spawn(spawnOf(FULL_BRIEF, { subagentType: 'steuerberater' }))

    expect(seen.spawned.map(item => item.subagentType)).toEqual(['prompt-boost:suche', 'steuerberater'])
  })

  test('keeps general-purpose when the brief needs the browser', NO_REWRITE, async ($, on) => {
    const seen = world(on)

    await $.agent.spawn(spawnOf(`${FULL_BRIEF}\nKontext: Prüfe die Seite im Browser.`))

    expect(seen.spawned[0]?.subagentType).toBe('general-purpose')
  })
})

describe('Lagebild', () => {
  test('hands the agent the files and findings the main loop already has', NO_REWRITE, async ($, on) => {
    const seen = world(on)
    await $.tool.call({ tool: 'Read', file_path: '/repo/src/tax.ts' })
    await $.tool.call({ tool: 'mcp__prompt-boost__Lagebild', art: 'ausgeschlossen', text: 'src/legacy ist tot' })

    await $.agent.spawn(spawnOf(FULL_BRIEF))

    const prompt = seen.spawned[0]?.prompt ?? ''
    expect(prompt).toContain('## Lagebild (prompt-boost)')
    expect(prompt).toContain('/repo/src/tax.ts')
    expect(prompt).toContain('src/legacy ist tot')
    expect(prompt).toContain('M src/tax.ts')
  })

  test('refuses Lagebild notes from inside a subagent', NO_REWRITE, async ($, on) => {
    world(on)

    const ran = await $.tool.call({ tool: 'mcp__prompt-boost__Lagebild', art: 'befund', text: 'x', agentId: 'a9' })

    expect(ran.deny ?? '').toContain('nur die Hauptsession')
  })
})

describe('fork lock', () => {
  test('refuses a fork until the person agrees, then lets exactly one through', NO_REWRITE, async ($, on) => {
    const seen = world(on)
    const fork = spawnOf('weiter', { fork: true, subagentType: 'fork' })
    on('prompt.submit', ($, e) => ({ text: e.text }))

    const refused = await $.agent.spawn(fork)
    await $.prompt.submit({ text: 'ja, mach', wait: false, origin: { kind: 'composer' } })
    const allowed = await $.agent.spawn(fork)
    const again = await $.agent.spawn(fork)

    expect(refused.deny ?? '').toContain('Fork')
    expect(allowed.agentId).toBe('a1')
    expect(again.deny ?? '').toContain('Fork')
    expect(seen.spawned).toHaveLength(1)
  })
})

describe('rounds and costs', () => {
  test('warns the agent at round 25 and logs its cost when it ends', NO_REWRITE, async ($, on) => {
    const seen = world(on)
    on('turn.step', async function* ($, e) {
      return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: { ...USAGE, model: 'claude-haiku-5-5' } }
    })
    await $.agent.spawn(spawnOf(FULL_BRIEF))

    for (let index = 0; index < 25; index += 1) {
      for await (const _chunk of $.turn.step({ turnId: 'x', index, model: 'claude-haiku-5-5', messageCount: 1, agentId: 'a1' })) {
        // the chunks do not matter here
      }
    }
    await $.turn.complete({ durationMs: 1, isAborted: false, turnId: 'x', reason: 'answer', agentId: 'a1', answer: 'fertig' })

    expect(seen.appended).toEqual([{ agentId: 'a1', text: expect.stringContaining('Runde 25') }])
    expect(seen.logs.at(-1) ?? '').toContain('25 Runden · Start 22k · Summe 550k Input')
  })
})

describe('registration', () => {
  test('registers the variants and the Lagebild tool with the first prompt after a reload', async ($, on) => {
    world(on)
    const agentsSeen: string[] = []
    const toolsSeen: string[] = []
    on('agent.register', ($, e) => {
      agentsSeen.push(e.name)

      return { value: { agent: `prompt-boost:${e.name}` } }
    })
    on('tool.register', ($, e) => {
      toolsSeen.push(e.name)

      return { value: { tool: `mcp__prompt-boost__${e.name}` } }
    })
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('prompt.submit', ($, e) => ({ text: e.text }))

    await $.prompt.submit({ text: 'ok', wait: false, origin: { kind: 'composer' } })

    expect(agentsSeen).toEqual(['suche', 'umsetzung', 'pruefung'])
    expect(toolsSeen).toEqual(['Lagebild'])
  })
})

describe('pure helpers', () => {
  test('missingBriefFields reads labels with markdown around them', () => {
    expect(missingBriefFields('**Ziel:** x\n## Fertig wenn\ny\n- Rückgabe: z')).toEqual([])
    expect(missingBriefFields('Mach mal')).toEqual(['Ziel', 'Fertig wenn', 'Rückgabe'])
  })

  test('classify picks by the goal and sends mixed or unclear work to umsetzung', () => {
    expect(classify('Ziel: Finde die Stelle.\nRückgabe: Liste')).toBe('suche')
    expect(classify('Ziel: Führe die Tests aus und miss die Laufzeit.')).toBe('pruefung')
    expect(classify('Ziel: Ändere die Funktion und teste sie.')).toBe('umsetzung')
    expect(classify('Ziel: Kümmer dich um das Thema.')).toBe('umsetzung')
    expect(classify('Ziel: Beschreibe kurz die Struktur, zeig die Module.')).toBe('suche')
    expect(classify('Ziel: Hol die Preise per WebFetch.')).toBeNull()
  })

  test('settleFork approves only an answer to a pending question', () => {
    expect(settleFork({ isAsked: true, isApproved: false }, 'Ja')).toEqual({ isAsked: false, isApproved: true })
    expect(settleFork({ isAsked: true, isApproved: false }, 'Nein, lieber nicht')).toEqual({ isAsked: false, isApproved: false })
    expect(settleFork({ isAsked: false, isApproved: false }, 'ja')).toEqual({ isAsked: false, isApproved: false })
  })

  test('renderLagebild stays within its limit by dropping the oldest notes first', () => {
    const notes = Array.from({ length: 30 }, (_, i) => ({ kind: 'befund' as const, text: `Befund ${i} ${'x'.repeat(300)}`, at: '' }))
    const state = notes.reduce(withNote, withFile({ notes: [], read: [], changed: [] }, 'changed', '/repo/a.ts'))
    const text = renderLagebild(state, { goal: 'Ziel', cwd: '/repo', git: '' })

    expect(text.length).toBeLessThanOrEqual(MAX_LAGEBILD_CHARS)
    expect(text).toContain('Befund 29')
    expect(text).not.toContain('Befund 0 ')
    expect(text).toContain('/repo/a.ts')
  })

  test('formatTokens reads like the cost report', () => {
    expect(formatTokens(67_753)).toBe('68k')
    expect(formatTokens(7_802_540)).toBe('7,8 Mio.')
  })
})
