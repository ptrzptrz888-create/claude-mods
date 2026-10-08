import { atom, read, update } from 'claude-code'
import type { AgentSpawnInput, EngineInterface, ModelUsage, On, PluginOptions } from 'claude-code'

import type { AgentRewrite, AgentStat, ForkGate } from '../types'
import { CONTRACT_MARK, withContract } from './agent-guide'
import { asNoteKind, LAGEBILD_MARK, renderLagebild, withFile, withNote } from './lagebild'
import {
  briefDenial,
  classify,
  COSTS_COMMAND,
  FORK_DENIAL,
  GENERAL_PURPOSE,
  LAGEBILD_COMMAND,
  LAGEBILD_TOOL_ID,
  leanSettingsOf,
  missingBriefFields,
  ROUND_WARNINGS,
  roundNote,
  variantType,
} from './lean-agents'
import type { LeanSettings } from './lean-agents'
import { acceptAgentRewrite, agentRequest, MAX_INPUT_CHARS } from './optimizer'
import { CLOSED_FORK_GATE, EMPTY_LAGEBILD } from './state'

const AGENT_LOG_SIZE = 20

const last = atom({ plugin: 'prompt-boost', key: 'last' } as const, null)
const agents = atom({ plugin: 'prompt-boost', key: 'agents' } as const, [])
const agentStats = atom({ plugin: 'prompt-boost', key: 'agentStats' } as const, [])
const forkGate = atom({ plugin: 'prompt-boost', key: 'forkGate' } as const, CLOSED_FORK_GATE)
const lagebild = atom({ plugin: 'prompt-boost', key: 'lagebild' } as const, EMPTY_LAGEBILD)
const STATS_SIZE = 20
const MAX_REMEMBERED_DENIALS = 50
const GIT_TIMEOUT_MS = 3000
const COSTS_TIMEOUT_MS = 120_000
const FALLBACK_SINCE = '2026-10-08T12:00:00.000Z'

const TRACKED_READS = new Set(['Read'])
const TRACKED_CHANGES = new Set(['Edit', 'Write', 'NotebookEdit'])

// Starts over on a reload, which at worst lets one thin brief through.
/** Descriptions whose brief the gate refused once; a retry passes. */
let deniedBriefs: readonly string[] = []

const keyOf = (description: string) => description.trim().toLowerCase()

/**
 * The fork lock, the gate and the routing, in that order. Returns the spawn
 * as it should start, or the refusal the main loop reads as the tool's error.
 * Only spawns the main model asked for are judged; a plugin's own spawn, a
 * workflow's agents and teammates pass untouched.
 */
const planSpawn = (
  e: AgentSpawnInput,
  isFromModel: boolean,
  lean: LeanSettings,
  gate: ForkGate,
): AgentSpawnInput | { deny: string } => {
  if (!isFromModel || e.workflow !== undefined || e.isTeammate === true) return e

  if (e.fork) return !lean.isForkGateOn || gate.isApproved ? e : { deny: FORK_DENIAL }

  const missing = missingBriefFields(e.prompt)
  const key = keyOf(e.description)
  if (lean.isBriefGateOn && missing.length > 0 && !deniedBriefs.includes(key)) {
    deniedBriefs = [...deniedBriefs, key].slice(-MAX_REMEMBERED_DENIALS)

    return { deny: briefDenial(missing) }
  }

  if (!lean.isRoutingOn || e.subagentType !== GENERAL_PURPOSE) return e
  const variant = classify(e.prompt)

  return variant === null ? e : { ...e, subagentType: variantType(variant) }
}

const contextOf = (usage: ModelUsage) =>
  usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens

const stringField = (e: object, key: string): string | null => {
  const value: unknown = (e as Record<string, unknown>)[key]

  return typeof value === 'string' ? value : null
}

async function readMode($: EngineInterface): Promise<string> {
  const stored = await $.store.get('mode')

  return typeof stored === 'string' ? stored : 'ergaenzen'
}

/** The session's goal for the Lagebild: the last analysed intent and brief. */
async function sessionGoal($: EngineInterface): Promise<string> {
  const analysis = await read($, last)
  if (analysis === null) return ''
  if (analysis.isSkipped) return analysis.original

  return `${analysis.intent}\n${analysis.brief}`
}

async function gitSummary($: EngineInterface): Promise<string> {
  try {
    const ran = await $.process.run(['git', 'status', '--short', '--branch'], { timeoutMs: GIT_TIMEOUT_MS })

    return ran.exitCode === 0 ? ran.stdout : ''
  } catch {
    // Not a repository, or git is missing: the Lagebild goes without it.
    return ''
  }
}

async function lagebildText($: EngineInterface): Promise<string> {
  const facts = { goal: await sessionGoal($), cwd: await $.session.cwd(), git: await gitSummary($) }

  return renderLagebild(await read($, lagebild), facts)
}

async function recordSpawn($: EngineInterface, entry: AgentRewrite) {
  await update($, agents, list => [...list, entry].slice(-AGENT_LOG_SIZE))
  if (entry.agentId === '') return
  const stat: AgentStat = {
    agentId: entry.agentId,
    label: entry.description,
    type: entry.subagentType,
    model: entry.model,
    routedFrom: entry.routedFrom,
    rounds: 0,
    startContext: 0,
    lastContext: 0,
    totalInput: 0,
    isDone: false,
  }
  await update($, agentStats, list => [...list, stat].slice(-STATS_SIZE))
}

async function recordStep($: EngineInterface, agentId: string, usage: ModelUsage, lean: LeanSettings) {
  const context = contextOf(usage)
  const advanced = await update($, agentStats, list =>
    list.map(stat =>
      stat.agentId !== agentId
        ? stat
        : {
            ...stat,
            rounds: stat.rounds + 1,
            startContext: stat.rounds === 0 ? context : stat.startContext,
            lastContext: context,
            totalInput: stat.totalInput + context,
          },
    ),
  )
  const stat = advanced.find(item => item.agentId === agentId)
  if (stat === undefined || !lean.isRoundWarningOn || !ROUND_WARNINGS.includes(stat.rounds)) return

  await $.session.append({ message: { type: 'user', content: [{ type: 'text', text: roundNote(stat.rounds) }] }, agentId })
}

/**
 * The agent half of the plugin: spawn, rounds, Lagebild tool and commands.
 * session.start, prompt.submit and turn.complete stay in register.tsx, which
 * owns those events.
 */
export function registerAgentWatch(on: On, options: PluginOptions) {
  const lean = leanSettingsOf(options)
  const isAgentBoostOn = options.optimizeAgents !== false
  const optimizerModel = String(options.optimizerModel ?? 'sonnet')

  // Step 4a: fork lock, brief gate, routing, rewrite, Lagebild and contract.
  on('agent.spawn', async ($, e, next) => {
    const planned = planSpawn(e, next.origin.plugin === 'engine', lean, await read($, forkGate))
    if ('deny' in planned) {
      if (planned.deny === FORK_DENIAL) await update($, forkGate, gate => ({ ...gate, isAsked: true }))

      return planned
    }
    if (planned.fork) {
      await update($, forkGate, gate => ({ ...gate, isApproved: false }))

      return next(planned)
    }
    if (planned.workflow !== undefined) return next(planned)

    const isBoosted = isAgentBoostOn && !planned.prompt.includes(CONTRACT_MARK) && (await readMode($)) !== 'aus'
    const targetModel = planned.model ?? e.parentModel
    const result =
      isBoosted && planned.prompt.length <= MAX_INPUT_CHARS
        ? await $.model.complete(agentRequest({ prompt: planned.prompt, targetModel, optimizerModel }))
        : null
    const rewritten = result?.isAnswered ? acceptAgentRewrite(planned.prompt, result.text) : null
    const body = rewritten ?? planned.prompt
    const section = lean.isLagebildOn && !body.includes(LAGEBILD_MARK) ? await lagebildText($) : ''
    const withSection = section === '' ? body : `${body.trimEnd()}\n\n${section}`
    const prompt = isBoosted ? withContract(withSection) : withSection
    const spawned = await next({ ...planned, prompt })
    if (spawned.deny !== undefined) return spawned

    await recordSpawn($, {
      agentId: spawned.agentId ?? '',
      description: e.description,
      subagentType: planned.subagentType,
      model: spawned.model,
      isOptimized: rewritten !== null,
      before: e.prompt.length,
      after: prompt.length,
      missing: null,
      routedFrom: planned.subagentType === e.subagentType ? null : e.subagentType,
    })

    return spawned
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: LAGEBILD_TOOL_ID }, async ($, e) => {
    if (e.agentId !== undefined) return { deny: 'prompt-boost: Das Lagebild pflegt nur die Hauptsession.' }
    const kind = asNoteKind(stringField(e, 'art'))
    const text = stringField(e, 'text')?.trim() ?? ''
    if (kind === null || text === '') {
      return { deny: 'prompt-boost: Lagebild braucht art (befund, ausgeschlossen, entscheidung) und text.' }
    }

    const at = new Date(await $.clock.now()).toISOString()
    await update($, lagebild, state => withNote(state, { kind, text, at }))

    return { result: `Im Lagebild notiert (${kind}).` }
  })

  // The main loop's reads and edits, so agents know what is already known.
  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    const isTracked = TRACKED_READS.has(e.tool) || TRACKED_CHANGES.has(e.tool)
    if (!lean.isLagebildOn || !isTracked || e.agentId !== undefined || ran.deny !== undefined || ran.isError) return ran

    const path = stringField(e, 'file_path') ?? stringField(e, 'notebook_path')
    const kind = TRACKED_READS.has(e.tool) ? 'read' : 'changed'
    if (path !== null) await update($, lagebild, state => withFile(state, kind, path))

    return ran
  }).catch(($, e, next) => next(e))

  // One model request of a subagent is one round.
  on('turn.step', async function* ($, e, next) {
    const response = yield* next(e)
    if (e.agentId === undefined || response.usage === null) return response
    try {
      await recordStep($, e.agentId, response.usage, lean)
    } catch {
      // The agent may have ended between the step and the note.
    }

    return response
  })

  on('command.run', { command: LAGEBILD_COMMAND }, async $ => ({ text: await lagebildText($) }))

  on('command.run', { command: COSTS_COMMAND }, async $ => {
    const since = await $.store.get('leanSinceAt')
    const script = `${$.plugin.root}/scripts/agent-kosten.py`
    const argv = ['python3', '-I', script, '--since', typeof since === 'string' ? since : FALLBACK_SINCE]
    const ran = await $.process.run(argv, { timeoutMs: COSTS_TIMEOUT_MS })

    return { text: ran.exitCode === 0 ? ran.stdout : `agent-kosten fehlgeschlagen:\n${ran.stderr.slice(0, 800)}` }
  })
}
