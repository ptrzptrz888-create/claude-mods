import { describe, expect, mock, test } from 'claude-code/testing'
import type { ModelCompleteResult, ModelForkResult, On, RenderElement } from 'claude-code'

import { missingSections } from '../hooks/reports'
import { coreTable } from '../hooks/router'
import { modelTip, parseVerdict } from '../hooks/optimizer'

const USAGE = { input_tokens: 10, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const PROMPT = 'Bau mir eine Funktion, die Rechnungen aus dem Ordner liest und die Summe pro Monat ausgibt.'
const BRIEF = 'Ziel: Monatssummen aus Rechnungen.\nFertig wenn: Für jeden Monat steht eine Summe.'
const LESSON = 'Nenne den Ordner, in dem die Rechnungen liegen.'
const ROUTER = '# Router\n\n## Kernliste\n\n| Rechnung schreiben | `anthropic-skills:rechnungen` |\n\n## Pflege\n- intern'

const verdict = (fields: Record<string, unknown> = {}) =>
  JSON.stringify({
    skip: false,
    needsContext: false,
    reason: 'unklar, welcher Ordner',
    intent: 'Monatssummen berechnen',
    gaps: ['Welcher Ordner?'],
    questions: [],
    assumptions: ['Annahme: PDF-Rechnungen'],
    complexity: 'mittel',
    skill: '',
    lessons: [LESSON],
    brief: BRIEF,
    ...fields,
  })

type World = {
  completes: { system: string; prompt: string }[]
  forks: string[]
  statuses: (string | undefined)[]
  toasts: string[]
  logs: string[]
  store: Map<string, unknown>
}

const answered = (text: string): ModelCompleteResult => ({ isAnswered: true, text, usage: USAGE })

/** The engine beneath the plugin: model, fork, session, files, UI and store. */
const world = (
  on: On,
  reply: ModelCompleteResult,
  initial: Record<string, unknown> = {},
  forkReply: ModelForkResult = answered(verdict()),
  hold?: { reached: () => void; gate: Promise<void> },
): World => {
  const store = new Map(Object.entries(initial))
  const seen: World = { completes: [], forks: [], statuses: [], toasts: [], logs: [], store }
  on('store.get', ($, e) => ({ value: store.get(e.key) }))
  on('store.set', ($, e) => {
    store.set(e.key, e.value)

    return { value: undefined }
  })
  on('store.delete', ($, e) => {
    store.delete(e.key)

    return { value: undefined }
  })
  mock.env(on, { HOME: '/home/w' })
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.cwd', () => ({ value: '/repo' }))
  on('process.run', () => ({
    value: { exitCode: 0, stdout: '## main', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  on('clock.now', () => ({ value: Date.UTC(2026, 9, 8, 9, 30) }))
  on('fs.read', ($, e) => ({ value: e.path === '/home/w/.claude/skill-router/ROUTER.md' ? ROUTER : '' }))
  on('ui.status', ($, e) => {
    seen.statuses.push(e.text)

    return { value: undefined }
  })
  on('ui.log', ($, e) => {
    seen.logs.push(e.text)

    return { value: undefined }
  })
  on('ui.toast', ($, e) => {
    seen.toasts.push(e.text)

    return { value: undefined }
  })
  on('model.complete', async ($, e) => {
    seen.completes.push({ system: String(e.system ?? ''), prompt: String(e.prompt) })
    hold?.reached()
    await hold?.gate

    return { value: reply }
  })
  on('model.fork', ($, e) => {
    seen.forks.push(e.prompt)

    return { value: forkReply }
  })
  on('prompt.submit', ($, e) => ({ text: e.text, context: e.context }))
  on('turn.complete', ($, e) => ({ text: e.answer }))

  return seen
}

const submit = { wait: false, origin: { kind: 'composer' } } as const
const turnEnd = { durationMs: 1000, isAborted: false, turnId: 't1', reason: 'answer' } as const
const BAND = {
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 100, scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

const feedbackOf = (seen: World): unknown[] => {
  const stored = seen.store.get('feedback')

  return Array.isArray(stored) ? stored : []
}

describe('prompt.submit', () => {
  test('keeps the prompt and adds the brief for the selected model as context', async ($, on) => {
    const seen = world(on, answered(verdict()))

    const result = await $.prompt.submit({ ...submit, text: PROMPT })

    expect(result.text).toBe(PROMPT)
    expect(result.context?.[0]).toContain('Fertig wenn')
    expect(result.context?.[0]).toContain('Welcher Ordner?')
    expect(seen.completes[0]?.system).toContain('Spitzenmodell')
    expect(seen.forks.length).toBe(0)
  })

  test('replaces the prompt in mode ersetzen and keeps the original below', async ($, on) => {
    world(on, answered(verdict()), { mode: 'ersetzen' })

    const result = await $.prompt.submit({ ...submit, text: PROMPT })

    expect(result.text?.startsWith('Ziel:')).toBe(true)
    expect(result.text).toContain(`Originalwortlaut:\n${PROMPT}`)
  })

  test('sends short prompts untouched without a model call', async ($, on) => {
    const seen = world(on, answered(verdict()))

    const result = await $.prompt.submit({ ...submit, text: 'ja, weiter' })

    expect(result.text).toBe('ja, weiter')
    expect(seen.completes.length).toBe(0)
  })

  test('strips the roh: prefix and skips the optimizer', async ($, on) => {
    const seen = world(on, answered(verdict()))

    const result = await $.prompt.submit({ ...submit, text: `roh: ${PROMPT}` })

    expect(result.text).toBe(PROMPT)
    expect(seen.completes.length).toBe(0)
  })

  test('falls back to the original prompt when the optimizer fails', async ($, on) => {
    const seen = world(on, { isAnswered: false, reason: 'api-error', status: 529, error: 'overloaded', usage: USAGE })

    const result = await $.prompt.submit({ ...submit, text: PROMPT })

    expect(result.text).toBe(PROMPT)
    expect(result.context).toBeUndefined()
    expect(seen.statuses.at(-1)).toContain('fehlgeschlagen')
  })

  test('leaves the plugin name to the engine in every status line', async ($, on) => {
    const seen = world(on, answered(verdict()))

    await $.prompt.submit({ ...submit, text: PROMPT })

    expect(seen.statuses.length).toBeGreaterThan(0)
    expect(seen.statuses.filter(text => text?.startsWith('prompt-boost')).length).toBe(0)
  })

  test('leaves prompts from other sessions alone', async ($, on) => {
    const seen = world(on, answered(verdict()))

    await $.prompt.submit({ text: PROMPT, wait: false, origin: { kind: 'peer' } })

    expect(seen.completes.length).toBe(0)
  })
})

describe('idea 1: context analysis', () => {
  test('reads the conversation through a fork when the prompt leans on it', async ($, on) => {
    const quick = answered(verdict({ skip: true, needsContext: true, brief: '' }))
    const deep = answered(verdict({ brief: 'Ziel: Punkt 2 aus der Liste umsetzen.' }))
    const seen = world(on, quick, {}, deep)

    const result = await $.prompt.submit({ ...submit, text: 'Setz bitte Punkt 2 von oben genau so um wie besprochen.' })

    expect(seen.forks.length).toBe(1)
    expect(result.context?.[0]).toContain('Punkt 2 aus der Liste')
    expect(seen.statuses.at(-1)).toContain('mit Verlauf')
  })

  test('sends the prompt untouched when there is nothing to fork yet', async ($, on) => {
    const quick = answered(verdict({ skip: true, needsContext: true, brief: '' }))
    world(on, quick, {}, { isAnswered: false, reason: 'nothing-to-fork' })

    const result = await $.prompt.submit({ ...submit, text: 'Setz bitte Punkt 2 von oben genau so um wie besprochen.' })

    expect(result.context).toBeUndefined()
  })
})

describe('ideas 2, 4 and 6: questions, model tip, skill', () => {
  test('asks the main model to clarify open questions first', async ($, on) => {
    world(on, answered(verdict({ questions: ['Welcher Ordner genau?'] })))

    const result = await $.prompt.submit({ ...submit, text: PROMPT })

    const joined = (result.context ?? []).join('\n')
    expect(joined).toContain('AskUserQuestion')
    expect(joined).toContain('Welcher Ordner genau?')
  })

  test('suggests a cheaper model for a simple task on Opus', async ($, on) => {
    const seen = world(on, answered(verdict({ complexity: 'einfach' })))

    await $.prompt.submit({ ...submit, text: PROMPT })

    expect(seen.toasts.some(text => text.includes('Haiku oder Sonnet'))).toBe(true)
  })

  test('gives the analyser the router table and passes its skill on', async ($, on) => {
    const seen = world(on, answered(verdict({ skill: 'anthropic-skills:rechnungen' })))

    const result = await $.prompt.submit({ ...submit, text: PROMPT })

    expect(seen.completes[0]?.system).toContain('anthropic-skills:rechnungen')
    expect(seen.completes[0]?.system).not.toContain('Pflege')
    expect((result.context ?? []).join('\n')).toContain('Passender Skill laut Skill-Router: anthropic-skills:rechnungen')
  })
})

describe('idea 3: rating band and learning', () => {
  test('asks for a rating after a boosted turn and stores a good one', async ($, on) => {
    const seen = world(on, answered(verdict()))
    await $.prompt.submit({ ...submit, text: PROMPT })
    await $.turn.complete({ ...turnEnd, answer: 'Fertig.' })

    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: 'prompt-boost', surface, ...BAND })
      expect(await ui.find({ key: 'gut' })).toBeDefined()
      await ui.unmount()
    }
    const ui = await $.ui.mount({ plugin: 'prompt-boost', surface: 'terminal', ...BAND })
    await ui.press({ key: 'gut' })

    const stored = feedbackOf(seen)
    expect(stored.length).toBe(1)
    expect(stored[0]).toEqual(expect.objectContaining({ rating: 'gut', at: '2026-10-08T09:30:00.000Z' }))
  })

  test('takes a note after a bad rating', async ($, on) => {
    const seen = world(on, answered(verdict()))
    await $.prompt.submit({ ...submit, text: PROMPT })
    await $.turn.complete({ ...turnEnd, answer: 'Fertig.' })

    const ui = await $.ui.mount({ plugin: 'prompt-boost', surface: 'desktop', ...BAND })
    await ui.press({ key: 'daneben' })
    await ui.input({ key: 'note', text: 'zu ausführlich' })

    expect(feedbackOf(seen)[0]).toEqual(expect.objectContaining({ rating: 'daneben', note: 'zu ausführlich' }))
  })

  test('distills the personal style every fifth rating and uses it next time', async ($, on) => {
    const seen = world(on, answered(verdict()), { ratingsSinceDistill: 4 })
    await $.prompt.submit({ ...submit, text: PROMPT })
    await $.turn.complete({ ...turnEnd, answer: 'Fertig.' })

    const ui = await $.ui.mount({ plugin: 'prompt-boost', surface: 'terminal', ...BAND })
    await ui.press({ key: 'gut' })
    await $.prompt.submit({ ...submit, text: PROMPT })

    expect(seen.completes.some(call => call.system.includes('Bewertungen'))).toBe(true)
    expect(seen.completes.at(-1)?.system).toContain('Vorlieben dieser Person')
  })

  test('shows no band after a prompt that was not boosted', async ($, on) => {
    world(on, answered(verdict()))
    on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
      const { Box, Text } = $.ui.resolve(e)

      return h(Box, { key: 'engine' }, h(Text, {}, 'engine')) as RenderElement
    })
    await $.prompt.submit({ ...submit, text: 'ja' })
    await $.turn.complete({ ...turnEnd, answer: 'Ok.' })

    const ui = await $.ui.mount({ plugin: 'prompt-boost', surface: 'terminal', ...BAND })
    expect(await ui.find({ key: 'engine' })).toBeDefined()
    expect(await ui.find({ key: 'gut' })).toBeUndefined()
  })
})

describe('step 4 and idea 5: agents', () => {
  const spawnInput = {
    tool_use_id: 't1',
    prompt: 'Ziel: Finde alle Stellen, an denen die Steuer berechnet wird.\nFertig wenn: Liste vollständig.\nRückgabe: Datei:Zeile.',
    description: 'Steuerstellen finden',
    subagentType: 'Explore',
    provider: { plugin: 'engine', tier: 'core' },
    model: 'haiku',
    parentModel: 'claude-opus-5-5',
    background: false,
    fork: false,
  } as const

  test('rewrites the task for the agent model and appends the work contract', async ($, on) => {
    const rewrite = `Ziel: ${spawnInput.prompt}\nFertig wenn: Liste mit Datei:Zeile.`
    const seen = world(on, answered(rewrite))
    let spawned = ''
    on('agent.spawn', ($, e) => {
      spawned = e.prompt

      return { model: 'haiku', agentId: 'a1' }
    })

    await $.agent.spawn(spawnInput)

    expect(spawned.startsWith(rewrite)).toBe(true)
    expect(spawned).toContain('## Arbeitsvertrag (prompt-boost)')
    expect(seen.completes[0]?.system).toContain('schnell und klein')
  })

  test('flags a report without evidence and tells the main loop', async ($, on) => {
    const seen = world(on, answered(`Ziel: ${spawnInput.prompt} und mehr Kontext für den Agenten.`))
    on('agent.spawn', () => ({ model: 'haiku', agentId: 'a1' }))

    await $.agent.spawn(spawnInput)
    await $.turn.complete({ ...turnEnd, agentId: 'a1', answer: 'Ergebnis: steuer.ts' })
    const next = await $.prompt.submit({ text: 'Agent fertig', wait: false, origin: { kind: 'task-notification' } })

    expect(seen.toasts.some(text => text.includes('Belege'))).toBe(true)
    expect((next.context ?? []).join('\n')).toContain('als ungeprüft')
  })

  test('tells the main loop to ask before starting agents', async ($, on) => {
    world(on, answered(verdict()))
    on('prompt.compose', () => ({ sections: [] }))

    const composed = await $.prompt.compose({
      model: 'claude-opus-5-5',
      promptModel: 'claude-opus-5-5',
      surfaces: ['desktop'],
      tools: ['Agent', 'Read'],
      outputStyle: null,
      traits: [],
    })

    expect(composed.sections.at(-1)?.text).toContain('frag vorher kurz nach')
  })
})

describe('status band and transcript entry', () => {
  test('shows each processing phase above the prompt', async ($, on) => {
    let release = () => {}
    let reached = () => {}
    const gate = new Promise<void>(resolve => {
      release = resolve
    })
    const isWaiting = new Promise<void>(resolve => {
      reached = resolve
    })
    world(on, answered(verdict()), {}, answered(verdict()), { reached: () => reached(), gate })

    const pending = $.prompt.submit({ ...submit, text: PROMPT })
    await isWaiting
    const ui = await $.ui.mount({ plugin: 'prompt-boost', surface: 'desktop', ...BAND })
    expect(await ui.find({ text: /analysiert deinen Prompt/ })).toBeDefined()

    release()
    await pending
    expect(await ui.find({ text: /fertig in/ })).toBeDefined()
    expect(await ui.find({ key: 'details' })).toBeDefined()

    await $.turn.complete({ ...turnEnd, answer: 'Fertig.' })
    expect(await ui.find({ text: /fertig in/ })).toBeUndefined()
    expect(await ui.find({ key: 'gut' })).toBeDefined()
  })

  test('writes original, improved version and writing tips to the transcript', async ($, on) => {
    const seen = world(on, answered(verdict()))

    await $.prompt.submit({ ...submit, text: PROMPT })

    const entry = seen.logs.at(-1) ?? ''
    expect(entry).toContain(`Dein Prompt:\n${PROMPT}`)
    expect(entry).toContain(`Verbesserte Fassung:\n${BRIEF}`)
    expect(entry).toContain(`• ${LESSON}`)
  })

  test('says so when the prompt went out unchanged', async ($, on) => {
    const seen = world(on, answered(verdict({ skip: true, brief: '', reason: 'schon klar formuliert', lessons: [] })))

    await $.prompt.submit({ ...submit, text: PROMPT })

    expect(seen.logs.at(-1)).toContain('unverändert gesendet')
  })

  test('keeps the transcript quiet when showBrief is off', { options: { showBrief: false } }, async ($, on) => {
    const seen = world(on, answered(verdict()))

    await $.prompt.submit({ ...submit, text: PROMPT })

    expect(seen.logs.length).toBe(0)
  })
})

describe('pure helpers', () => {
  test('parseVerdict reads JSON with text around it', () => {
    expect(parseVerdict(`Hier: ${verdict()} fertig`)?.brief).toBe(BRIEF)
  })

  test('parseVerdict treats an empty brief as skipped and garbage as unreadable', () => {
    expect(parseVerdict('{"skip": false, "brief": ""}')?.isSkipped).toBe(true)
    expect(parseVerdict('kein json')).toBeNull()
  })

  test('modelTip stays quiet for normal work on a big model', () => {
    expect(modelTip('frontier', 'mittel')).toBe('')
    expect(modelTip('fast', 'schwer')).toContain('Opus')
  })

  test('missingSections finds what a report leaves out', () => {
    expect(missingSections('Ergebnis: x\nBelege: a.ts:3\nNicht geprüft: nichts')).toEqual([])
    expect(missingSections('Ergebnis: x')).toEqual(['Belege', 'Nicht geprüft'])
  })

  test('coreTable keeps only the core list', () => {
    expect(coreTable(ROUTER)).toContain('rechnungen')
    expect(coreTable(ROUTER)).not.toContain('Pflege')
  })
})
