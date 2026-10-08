import { atom, read, update } from 'claude-code'
import type { EngineInterface, ModelForkResult, PluginOptions, PromptOrigin, Register } from 'claude-code'

import type { Analysis, Feedback, Mode, Progress, RatingAsk } from '../types'
import { agentGuide, asAgentPolicy } from './agent-guide'
import { briefLog, headlineOf, MARK, skippedLog, stepsOf } from './display'
import type { AgentPolicy } from './agent-guide'
import { addFeedback, asFeedbackList, DISTILL_EVERY, distillRequest } from './feedback'
import { registerAgentWatch } from './agent-watch'
import { agentLine, LAGEBILD_TOOL_SPEC, LEAN_COMMANDS, leanSettingsOf, settleFork, summaryLine, variantSpec, VARIANTS } from './lean-agents'
import type { LeanSettings } from './lean-agents'
import { familyOf, profileOf } from './model-profiles'
import {
  analyseRequest,
  forkPrompt,
  MAX_INPUT_CHARS,
  modelTip,
  parseVerdict,
} from './optimizer'
import type { Extras, Verdict } from './optimizer'
import { missingSections, reportNote } from './reports'
import { coreTable, DEFAULT_ROUTER_PATH, expandHome } from './router'
import { CLOSED_FORK_GATE } from './state'

const PANE = 'prompt-boost'
const COMMAND = 'prompt-boost'
const RAW_PREFIX = /^roh:\s*/i
const BAND_AGENT_LINES = 3

const last = atom({ plugin: 'prompt-boost', key: 'last' } as const, null)
const agents = atom({ plugin: 'prompt-boost', key: 'agents' } as const, [])
const rating = atom({ plugin: 'prompt-boost', key: 'rating' } as const, null)
const progress = atom({ plugin: 'prompt-boost', key: 'progress' } as const, null)
const agentStats = atom({ plugin: 'prompt-boost', key: 'agentStats' } as const, [])
const forkGate = atom({ plugin: 'prompt-boost', key: 'forkGate' } as const, CLOSED_FORK_GATE)

type Settings = {
  optimizerModel: string
  minChars: number
  isAgentBoostOn: boolean
  isContextOn: boolean
  isRatingOn: boolean
  isBriefShown: boolean
  isProgressShown: boolean
  agentPolicy: AgentPolicy
  routerPath: string
}

const settingsOf = (options: PluginOptions): Settings => ({
  optimizerModel: String(options.optimizerModel ?? 'sonnet'),
  minChars: Number(options.minChars ?? 40),
  isAgentBoostOn: options.optimizeAgents !== false,
  isContextOn: options.contextAnalysis !== false,
  isRatingOn: options.askRating !== false,
  isBriefShown: options.showBrief !== false,
  isProgressShown: options.showProgress !== false,
  agentPolicy: asAgentPolicy(options.agentPolicy),
  routerPath: String(options.routerPath ?? DEFAULT_ROUTER_PATH),
})

// The module's own values start over on a reload, which suits all three.
let routerCache: string | null = null
/** Notes on agent reports that broke the contract, for the main loop to read. */
let pendingNotes: readonly string[] = []
/** The boosted prompt whose turn runs now, to ask for a rating after it. */
let awaitingRating: RatingAsk | null = null

const takeNotes = () => {
  const taken = pendingNotes
  pendingNotes = []

  return taken
}

const MODE_WORDS: Record<string, Mode> = {
  an: 'ergaenzen',
  ein: 'ergaenzen',
  ergaenzen: 'ergaenzen',
  'ergänzen': 'ergaenzen',
  ersetzen: 'ersetzen',
  aus: 'aus',
}

const MODE_LABEL: Record<Mode, string> = {
  ergaenzen: 'ergänzen (Original bleibt, Briefing als Zusatzkontext)',
  ersetzen: 'ersetzen (Briefing ersetzt den Prompt, Original hängt an)',
  aus: 'aus',
}

const isFromPerson = (origin: PromptOrigin) => origin.kind === 'composer' || origin.kind === 'bridge'

const bullets = (title: string, items: readonly string[]) =>
  items.length === 0 ? '' : `\n\n${title}\n${items.map(item => `- ${item}`).join('\n')}`

const toVerdict = (result: ModelForkResult): Verdict | { failed: string } =>
  result.isAnswered ? (parseVerdict(result.text) ?? { failed: 'keine lesbare Antwort' }) : { failed: result.reason }

const toAnalysis = (
  verdict: Verdict | { failed: string },
  base: { original: string; model: string; mode: Mode; usedContext: boolean; durationMs: number },
): Analysis => {
  const family = familyOf(base.model)
  if ('failed' in verdict) {
    return {
      ...base,
      family,
      isSkipped: true,
      reason: `Optimierung fehlgeschlagen (${verdict.failed}), Original gesendet.`,
      intent: '',
      gaps: [],
      questions: [],
      assumptions: [],
      complexity: 'mittel',
      skill: '',
      tip: '',
      lessons: [],
      brief: '',
    }
  }
  const { needsContext: _needsContext, ...rest } = verdict

  return { ...base, ...rest, family, tip: modelTip(family, verdict.complexity) }
}

/** Step 3, mode "ergänzen": the brief rides beside the untouched prompt. */
const briefContext = (analysis: Analysis) =>
  `[prompt-boost] Strukturierte Fassung des Auftrags oben, optimiert für ${profileOf(analysis.family).label}. ` +
  `Bei Widersprüchen gilt der Originaltext der Person.\n\n${analysis.brief}` +
  bullets('Offene Punkte (mit Annahme überbrückbar):', analysis.gaps) +
  '\n\nArbeite mit den markierten Annahmen und nenne sie im Ergebnis.'

/** Idea 2: what the analyser could not settle, asked before any work starts. */
const questionContext = (questions: readonly string[]) =>
  '[prompt-boost] Kläre vor Beginn der Arbeit diese Punkte mit der Person, gebündelt in einem einzigen ' +
  'AskUserQuestion-Aufruf mit deiner Empfehlung als erster Option (fehlt das Werkzeug, frag direkt). ' +
  'Was du aus dem Gesprächsverlauf oder dem Code sicher beantworten kannst, frag nicht.' +
  bullets('Fragen:', questions)

const skillContext = (skill: string) =>
  `[prompt-boost] Passender Skill laut Skill-Router: ${skill}. Prüfe kurz, ob er wirklich passt, und nutze ihn dann.`

/** Everything the model reads beside the prompt, from one analysis. */
const contextFor = (analysis: Analysis, mode: Mode): string[] => [
  ...(analysis.isSkipped || mode === 'ersetzen' ? [] : [briefContext(analysis)]),
  ...(analysis.questions.length === 0 ? [] : [questionContext(analysis.questions)]),
  ...(analysis.skill === '' ? [] : [skillContext(analysis.skill)]),
]

/** Step 3, mode "ersetzen": the brief leads, the original stays below it. */
const asReplacement = (analysis: Analysis, original: string) =>
  `${analysis.brief}${bullets('Offene Punkte:', analysis.gaps)}\n\n---\nOriginalwortlaut:\n${original}`

const statusOf = (analysis: Analysis, mode: Mode) => {
  if (analysis.isSkipped) return `prompt-boost: unverändert · ${analysis.reason.slice(0, 60)}`
  const verb = mode === 'ersetzen' ? 'ersetzt' : 'ergänzt'
  const asks = analysis.questions.length === 0 ? '' : ` · ${analysis.questions.length} Rückfragen`

  return `prompt-boost: ${verb} für ${profileOf(analysis.family).label}${analysis.usedContext ? ' (mit Verlauf)' : ''}${asks}`
}

const summaryOf = (analysis: Analysis | null) => {
  if (analysis === null) return 'Noch kein Prompt analysiert.'
  if (analysis.isSkipped) return `Letzter Prompt übersprungen: ${analysis.reason}`

  return `Letzter Prompt: ${analysis.intent} (${analysis.gaps.length} offene Punkte, ${analysis.questions.length} Rückfragen)`
}

const withContext = <E extends { context?: readonly string[] }>(e: E, extra: readonly string[]): E =>
  extra.length === 0 ? e : { ...e, context: [...(e.context ?? []), ...extra] }

const leanLine = (lean: LeanSettings) =>
  `Sparsame Agenten: Varianten ${lean.isRoutingOn ? 'an' : 'aus'} · Gate ${lean.isBriefGateOn ? 'an' : 'aus'}` +
  ` · Lagebild ${lean.isLagebildOn ? 'an' : 'aus'} · Fork-Sperre ${lean.isForkGateOn ? 'an' : 'aus'}` +
  ` · Rundenwarnung ${lean.isRoundWarningOn ? 'an' : 'aus'}`

async function readMode($: EngineInterface): Promise<Mode> {
  const stored = await $.store.get('mode')

  return stored === 'ergaenzen' || stored === 'ersetzen' || stored === 'aus' ? stored : 'ergaenzen'
}

async function readRouter($: EngineInterface, path: string): Promise<string> {
  if (routerCache !== null) return routerCache
  let table = ''
  try {
    table = coreTable(await $.fs.read(expandHome(path, await $.env.get('HOME'))))
  } catch {
    // No router file: the analyser simply suggests no skill.
  }
  routerCache = table

  return table
}

async function readExtras($: EngineInterface, settings: Settings): Promise<Extras> {
  const style = await $.store.get('style')

  return {
    personalStyle: typeof style === 'string' ? style : '',
    router: settings.routerPath === '' ? '' : await readRouter($, settings.routerPath),
  }
}

/**
 * Steps 1 and 2. A quick analysis without the conversation first; only when
 * it finds the prompt leans on earlier turns (idea 1) does a fork read the
 * whole conversation, served from the main thread's prompt cache.
 */
async function analyse($: EngineInterface, text: string, mode: Mode, settings: Settings): Promise<Analysis> {
  const startedAt = await $.clock.now()
  await setProgress($, { phase: 'analyse', isReadingContext: false, startedAt, durationMs: 0, detail: '' })
  const model = await $.session.model()
  const extras = await readExtras($, settings)
  const quick = toVerdict(
    await $.model.complete(analyseRequest({ text, model, optimizerModel: settings.optimizerModel, extras })),
  )
  const isContextNeeded = settings.isContextOn && 'needsContext' in quick && quick.needsContext
  if (!isContextNeeded) {
    const durationMs = (await $.clock.now()) - startedAt

    return toAnalysis(quick, { original: text, model, mode, usedContext: false, durationMs })
  }

  $.ui.status('prompt-boost: liest den Gesprächsverlauf …')
  await setProgress($, { phase: 'verlauf', isReadingContext: true, startedAt, durationMs: 0, detail: '' })
  const deep = toVerdict(await $.model.fork({ prompt: forkPrompt({ text, model, extras }) }))
  const isDeepUsable = !('failed' in deep)
  const durationMs = (await $.clock.now()) - startedAt

  return toAnalysis(isDeepUsable ? deep : quick, { original: text, model, mode, usedContext: isDeepUsable, durationMs })
}

async function setProgress($: EngineInterface, value: Progress | null) {
  await update($, progress, () => value)
}

/** The status band's last word on one prompt, and its transcript entry. */
async function finish($: EngineInterface, analysis: Analysis, settings: Settings) {
  const isFailed = analysis.reason.startsWith('Optimierung fehlgeschlagen')
  const phase: Progress['phase'] = isFailed ? 'fehler' : analysis.isSkipped ? 'unveraendert' : 'fertig'
  const startedAt = (await $.clock.now()) - analysis.durationMs
  await setProgress($, {
    phase,
    isReadingContext: analysis.usedContext,
    startedAt,
    durationMs: analysis.durationMs,
    detail: analysis.reason.slice(0, 80),
  })
  if (!settings.isBriefShown || isFailed) return

  $.ui.log(analysis.isSkipped ? skippedLog(analysis) : briefLog(analysis))
}

/** Idea 3: stores one rating and distills the style every few ratings. */
async function saveRating(
  $: EngineInterface,
  ask: RatingAsk,
  value: Feedback['rating'],
  note: string,
  optimizerModel: string,
) {
  await update($, rating, () => null)
  const entry: Feedback = {
    at: new Date(await $.clock.now()).toISOString(),
    intent: ask.intent,
    model: ask.model,
    rating: value,
    note: note.trim(),
  }
  const list = addFeedback(asFeedbackList(await $.store.get('feedback')), entry)
  await $.store.set('feedback', list)

  const since = Number((await $.store.get('ratingsSinceDistill')) ?? 0) + 1
  if (since < DISTILL_EVERY) {
    await $.store.set('ratingsSinceDistill', since)
    $.ui.toast('prompt-boost: Bewertung gespeichert.')

    return
  }

  await $.store.set('ratingsSinceDistill', 0)
  const result = await $.model.complete(distillRequest(list, optimizerModel))
  if (!result.isAnswered) return

  await $.store.set('style', result.text.trim())
  $.ui.toast('prompt-boost: Persönlicher Prompt-Stil aktualisiert (/prompt-boost stil).')
}

/** Registers the lean variants, the Lagebild tool and the agent commands. */
async function setupLean($: EngineInterface, lean: LeanSettings) {
  if (lean.isRoutingOn) {
    for (const name of VARIANTS) await $.agent.register(variantSpec(name))
  }
  if (lean.isLagebildOn) await $.tool.register(LAGEBILD_TOOL_SPEC)
  for (const command of LEAN_COMMANDS) await $.command.register(command)
  // To the second: agents from earlier the same day must not count as "since".
  if (typeof (await $.store.get('leanSinceAt')) !== 'string') {
    await $.store.set('leanSinceAt', new Date(await $.clock.now()).toISOString())
  }
}

/** Marks a subagent done and writes its cost line for the person. */
async function finishAgentStat($: EngineInterface, agentId: string, lean: LeanSettings) {
  const stat = (await read($, agentStats)).find(item => item.agentId === agentId)
  if (stat === undefined || stat.isDone) return
  await update($, agentStats, list => list.map(item => (item.agentId === agentId ? { ...item, isDone: true } : item)))
  if (lean.isAgentDisplayOn) $.ui.log(summaryLine(stat))
}

/** Idea 5: checks a finished subagent's report against the work contract. */
async function checkReport($: EngineInterface, agentId: string, answer: string) {
  const entry = (await read($, agents)).find(item => item.agentId === agentId)
  if (entry === undefined) return

  const missing = missingSections(answer)
  await update($, agents, list => list.map(item => (item.agentId === agentId ? { ...item, missing } : item)))
  if (missing.length === 0) return

  pendingNotes = [...pendingNotes, reportNote(entry.description, missing)]
  $.ui.toast(`prompt-boost: Bericht „${entry.description}" ohne ${missing.join(', ')}`)
}

export const register: Register = (on, options) => {
  const settings = settingsOf(options)
  const lean = leanSettingsOf(options)
  registerAgentWatch(on, options)

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: COMMAND,
      description: 'Prompt-Optimierung: status, an, ersetzen, aus, zeigen, probe <text>, stil',
      argumentHint: '[status|an|ersetzen|aus|zeigen|probe <text>|stil [zurücksetzen]]',
    })
    await setupLean($, lean)

    return next(e)
  })

  // Steps 1 to 3: analyse, optimize for the selected model, hand it on.
  on('prompt.submit', async ($, e, next) => {
    const base = withContext(e, takeNotes())
    if (!isFromPerson(e.origin)) return next(base)

    await update($, forkGate, gate => settleFork(gate, e.text))
    awaitingRating = null
    await update($, rating, () => null)
    if (RAW_PREFIX.test(e.text)) return next({ ...base, text: e.text.replace(RAW_PREFIX, '') })

    const mode = await readMode($)
    const text = e.text.trim()
    const isOutOfRange = text.length < settings.minChars || text.length > MAX_INPUT_CHARS
    if (mode === 'aus' || isOutOfRange || text.startsWith('/')) return next(base)

    $.ui.status('prompt-boost: analysiert …')
    const analysis = await analyse($, e.text, mode, settings)
    await update($, last, () => analysis)
    await finish($, analysis, settings)
    $.ui.status(statusOf(analysis, mode))
    if (analysis.tip !== '') $.ui.toast(analysis.tip)
    if (!analysis.isSkipped && settings.isRatingOn) {
      awaitingRating = { intent: analysis.intent, model: analysis.model, stage: 'frage' }
    }

    const isReplaced = mode === 'ersetzen' && !analysis.isSkipped
    const submitted = isReplaced ? { ...base, text: asReplacement(analysis, e.text) } : base

    return next(withContext(submitted, contextFor(analysis, mode)))
  }).catch(($, e, next) => next(e))

  // Idea 3 (asking) and idea 5 (checking), both when a turn ends.
  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined) {
      await checkReport($, e.agentId, e.answer)
      await finishAgentStat($, e.agentId, lean)

      return next(e)
    }

    await setProgress($, null)
    const ask = awaitingRating
    awaitingRating = null
    if (ask !== null && e.reason === 'answer') await update($, rating, () => ask)

    return next(e)
  })

  // Step 4a (gate, routing, rewrite, Lagebild) lives in agent-watch.ts.

  // Idea 5: a foreground agent's result carries the note straight back.
  on('tool.call', { tool: 'Agent' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny !== undefined || pendingNotes.length === 0) return ran

    return withContext(ran, takeNotes())
  }).catch(($, e, next) => next(e))

  // Step 4b: whether to start an agent at all, and how to brief it.
  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    if (!e.tools.includes('Agent') || (await readMode($)) === 'aus') return composed
    const guide = { id: 'prompt-boost:agent-guide', text: agentGuide(settings.agentPolicy), scope: 'session' as const }

    return { sections: [...composed.sections, guide] }
  }).catch(($, e, next) => next(e))

  // Idea 3: the rating band above the prompt after a boosted turn.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const ask = await read($, rating)
    const elements = $.ui.resolve(e)
    const { Box, Button, Text } = elements

    if (ask === null || e.props.isWorking) {
      const current = settings.isProgressShown ? await read($, progress) : null
      const running = lean.isAgentDisplayOn
        ? (await read($, agentStats)).filter(stat => !stat.isDone).slice(-BAND_AGENT_LINES)
        : []
      if (current === null && running.length === 0) return next(e)
      if (current === null) {
        return (
          <Box flexDirection="column">
            {running.map(stat => (
              <Text dimColor>prompt-boost Agent: {agentLine(stat)}</Text>
            ))}
          </Box>
        )
      }
      const isRunning = current.phase === 'analyse' || current.phase === 'verlauf'

      return (
        <Box flexDirection="column">
          <Box>
          <Text bold>prompt-boost </Text>
          {stepsOf(current).map(step => (
            <Text bold={step.state === 'running'} dimColor={step.state === 'waiting' || step.state === 'skipped'}>
              {MARK[step.state]} {step.label}{'  '}
            </Text>
          ))}
          <Text dimColor>· {headlineOf(current)} </Text>
          {!isRunning && current.phase !== 'fehler' && (
            <Button key="details" label="Details" onPress={() => $.ui.open({ id: PANE, title: 'prompt-boost' })} />
          )}
          </Box>
          {running.map(stat => (
            <Text dimColor>prompt-boost Agent: {agentLine(stat)}</Text>
          ))}
        </Box>
      )
    }

    const save = (value: Feedback['rating'], note: string) => saveRating($, ask, value, note, settings.optimizerModel)

    if (ask.stage === 'notiz' && 'Input' in elements) {
      const { Input } = elements

      return (
        <Box flexDirection="column">
          <Text dimColor>prompt-boost: Was hat gefehlt oder gestört? Ein Satz reicht.</Text>
          <Input
            key="note"
            placeholder="z. B. zu ausführlich, falscher Fokus, Rückfrage unnötig"
            submitLabel="Speichern"
            autoFocus
            onSubmit={value => save('daneben', value)}
          />
          <Button key="skip" label="Ohne Notiz speichern" onPress={() => save('daneben', '')} />
        </Box>
      )
    }

    const toNote = () =>
      'Input' in elements ? update($, rating, () => ({ ...ask, stage: 'notiz' as const })) : save('daneben', '')

    return (
      <Box>
        <Text dimColor>prompt-boost: Hat das optimierte Briefing geholfen? </Text>
        <Button key="gut" label="Gut" onPress={() => save('gut', '')} />
        <Button key="daneben" label="Daneben" onPress={toNote} />
        <Button key="weg" label="Ausblenden" role="dismiss" onPress={() => update($, rating, () => null)} />
      </Box>
    )
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    const [word = 'status', ...rest] = e.args.trim().split(/\s+/)
    const verb = word.toLowerCase()
    const mode = MODE_WORDS[verb]

    if (mode !== undefined) {
      await $.store.set('mode', mode)

      return { text: `prompt-boost: Modus ${MODE_LABEL[mode]}` }
    }

    if (verb === 'zeigen') {
      await $.ui.open({ id: PANE, title: 'prompt-boost' })

      return { text: 'prompt-boost: Analyse-Panel geöffnet.' }
    }

    if (verb === 'stil') {
      if (rest[0]?.toLowerCase().startsWith('zur') === true) {
        await $.store.delete('style')
        await $.store.delete('feedback')
        await $.store.set('ratingsSinceDistill', 0)

        return { text: 'prompt-boost: Prompt-Stil und Bewertungen zurückgesetzt.' }
      }
      const style = await $.store.get('style')
      const count = asFeedbackList(await $.store.get('feedback')).length

      return {
        text:
          typeof style === 'string' && style !== ''
            ? `Dein gelernter Prompt-Stil (aus ${count} Bewertungen):\n${style}`
            : `Noch kein Stil gelernt. ${count} von ${DISTILL_EVERY} Bewertungen bis zur ersten Auswertung.`,
      }
    }

    if (verb === 'probe') {
      const text = rest.join(' ')
      if (text === '') return { text: 'Aufruf: /prompt-boost probe <dein Prompt>' }

      const analysis = await analyse($, text, await readMode($), settings)
      await update($, last, () => analysis)
      await setProgress($, null)
      if (analysis.isSkipped) return { text: `Würde unverändert gesendet: ${analysis.reason}` }

      return {
        text:
          `Absicht: ${analysis.intent} · Komplexität ${analysis.complexity}` +
          (analysis.skill === '' ? '' : ` · Skill ${analysis.skill}`) +
          bullets('Rückfragen:', analysis.questions) +
          bullets('Offene Punkte:', analysis.gaps) +
          bullets('Annahmen:', analysis.assumptions) +
          `\n\nBriefing:\n${analysis.brief}` +
          bullets('So schreibst du es nächstes Mal:', analysis.lessons) +
          (analysis.tip === '' ? '' : `\n\n${analysis.tip}`),
      }
    }

    const model = await $.session.model()
    const ratings = asFeedbackList(await $.store.get('feedback')).length
    const lines = [
      `Modus: ${MODE_LABEL[await readMode($)]}`,
      `Aktives Modell: ${model} (Profil ${profileOf(familyOf(model)).label})`,
      `Optimierer: ${settings.optimizerModel} · Verlaufsanalyse ${settings.isContextOn ? 'an' : 'aus'} · Mindestlänge ${settings.minChars} Zeichen`,
      `Agenten: Umschreiben ${settings.isAgentBoostOn ? 'an' : 'aus'} · Regel ${settings.agentPolicy === 'fragen' ? 'vorher fragen' : 'frei'}`,
      leanLine(lean),
      `Bewertungen: ${ratings} gespeichert · Band ${settings.isRatingOn ? 'an' : 'aus'}`,
      summaryOf(await read($, last)),
      'Tipp: „roh:“ vor einem Prompt sendet ihn unverändert.',
    ]

    return { text: lines.join('\n') }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const analysis = await read($, last)
    const rewrites = await read($, agents)

    return (
      <Box flexDirection="column">
        <Text bold>Letzter Prompt</Text>
        {analysis === null && <Text dimColor>Noch kein Prompt analysiert.</Text>}
        {analysis !== null && (
          <Box flexDirection="column">
            <Text dimColor>
              {analysis.model} · Profil {profileOf(analysis.family).label} · Modus {analysis.mode} · Komplexität{' '}
              {analysis.complexity}
              {analysis.usedContext ? ' · mit Verlauf' : ''}
            </Text>
            {analysis.tip !== '' && <Text>{analysis.tip}</Text>}
            {analysis.skill !== '' && <Text>Skill: {analysis.skill}</Text>}
            {analysis.isSkipped ? (
              <Text>Unverändert: {analysis.reason}</Text>
            ) : (
              <Box flexDirection="column">
                <Text>Absicht: {analysis.intent}</Text>
                {analysis.questions.map(question => (
                  <Text>· Rückfrage: {question}</Text>
                ))}
                {analysis.gaps.map(gap => (
                  <Text>· offen: {gap}</Text>
                ))}
                {analysis.assumptions.map(item => (
                  <Text dimColor>· {item}</Text>
                ))}
                <Text bold>Verbesserte Fassung</Text>
                <Text>{analysis.brief}</Text>
                {analysis.lessons.length > 0 && <Text bold>So schreibst du es nächstes Mal</Text>}
                {analysis.lessons.map(lesson => (
                  <Text>• {lesson}</Text>
                ))}
              </Box>
            )}
          </Box>
        )}
        <Text bold>Agenten</Text>
        {rewrites.length === 0 && <Text dimColor>Noch kein Agent gestartet.</Text>}
        {rewrites
          .slice(-5)
          .reverse()
          .map(item => (
            <Text dimColor={!item.isOptimized}>
              {item.subagentType} ({item.model}): {item.description} · {item.before} → {item.after} Zeichen
              {item.isOptimized ? '' : ' · nur Vertrag'}
              {item.missing === null ? ' · läuft' : item.missing.length === 0 ? ' · Bericht vollständig' : ` · fehlt: ${item.missing.join(', ')}`}
            </Text>
          ))}
      </Box>
    )
  })
}
