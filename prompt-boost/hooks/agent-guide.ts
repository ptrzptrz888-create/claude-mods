/** Marks a prompt the contract was already appended to. */
export const CONTRACT_MARK = '## Arbeitsvertrag (prompt-boost)'

/** Whether the main loop may start agents on its own or asks first. */
export type AgentPolicy = 'fragen' | 'frei'

const POLICY_TEXT: Record<AgentPolicy, string> = {
  fragen:
    'Starte Subagenten, Workflows oder parallele Agenten nur, wenn die Person es in diesem Gespräch ausdrücklich verlangt hat. ' +
    'Hältst du einen Agenten für nötig, frag vorher kurz nach (Zweck, grobe Kostenschätzung, warum du es nicht selbst erledigst) und warte auf ein Ja. Fragen ist jederzeit erlaubt.',
  frei: 'Du darfst Subagenten selbst starten, wenn die Prüfung unten dafür spricht.',
}

export const asAgentPolicy = (value: unknown): AgentPolicy => (value === 'frei' ? 'frei' : 'fragen')

/**
 * A system-prompt section for the main loop: whether to start an agent at
 * all, how to brief it and how to check its report.
 */
export const agentGuide = (policy: AgentPolicy) => `# Delegation an Subagenten (prompt-boost)

${POLICY_TEXT[policy]}

Bevor du einen Subagenten startest oder vorschlägst, prüfe drei Dinge:
1. Passt die Aufgabe in deinen eigenen Kontext? Dann erledige sie selbst. Agenten lohnen sich für unabhängige, gut abgrenzbare Teilaufgaben oder breite Suchen, deren Rohdaten du nicht brauchst.
2. Welches Modell reicht? haiku für Suchen und Lesen, sonnet für Umsetzung, opus nur für schwierige Abwägungen. Setze \`model\` bewusst.
3. Sind die Teilaufgaben unabhängig? Dann parallel in einer Nachricht starten, sonst nacheinander.

Schreibe den Prompt wie ein Briefing für eine fähige Kollegin, die nichts von diesem Gespräch weiß:
- Ziel und Zweck: was herauskommen soll und wofür es gebraucht wird
- Kontext: konkrete Pfade, Namen, bisherige Befunde, was schon ausgeschlossen ist
- Umfang und Grenzen: was ausdrücklich nicht zu tun ist
- Fertig wenn: ein prüfbares Endkriterium
- Rückgabe: Format und Länge des Berichts

Behandle den Bericht eines Agenten als Hinweis, nicht als Beleg. Prüfe die entscheidenden Aussagen selbst, bevor du darauf handelst.`

const CONTRACT = `${CONTRACT_MARK}
- Du startest ohne den Gesprächsverlauf. Fehlt etwas Entscheidendes, nenne es im Bericht, statt zu raten.
- Bleib im genannten Umfang. Lies gezielt die nötigen Stellen statt ganzer Verzeichnisse.
- Behaupte nichts, was du nicht geprüft hast.
- Schließe mit diesem Bericht ab, knapp:
  1. Ergebnis
  2. Belege (Datei:Zeile, ausgeführte Befehle, Messwerte)
  3. Nicht geprüft oder unsicher
  4. Offene Fragen an den Auftraggeber`

/** Appends the work contract once; a prompt that has it is left alone. */
export const withContract = (prompt: string): string =>
  prompt.includes(CONTRACT_MARK) ? prompt : `${prompt.trimEnd()}\n\n${CONTRACT}`
