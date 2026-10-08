import type { ForkGate, LagebildState } from '../types'

// Atoms must be declared in the file that reads them (the mod scan follows
// them only there), so register.tsx and agent-watch.ts each declare their own
// with the same plugin and key. They share these starting values.

export const EMPTY_LAGEBILD: LagebildState = { notes: [], read: [], changed: [] }
export const CLOSED_FORK_GATE: ForkGate = { isAsked: false, isApproved: false }
