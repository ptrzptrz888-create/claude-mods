/** The sections the work contract asks every subagent report to have. */
const SECTIONS: readonly { label: string; pattern: RegExp }[] = [
  { label: 'Ergebnis', pattern: /ergebnis/i },
  { label: 'Belege', pattern: /belege?|nachweis/i },
  { label: 'Nicht geprüft', pattern: /nicht\s+gepr(ü|ue)ft|ungepr(ü|ue)ft|unsicher/i },
]

/** Idea 5: which contract sections a subagent's final answer leaves out. */
export const missingSections = (answer: string): string[] =>
  SECTIONS.filter(section => !section.pattern.test(answer)).map(section => section.label)

/** What the main loop reads about a report that broke the contract. */
export const reportNote = (description: string, missing: readonly string[]) =>
  `[prompt-boost] Der Bericht des Agenten „${description}" enthält keinen Abschnitt ${missing.join(', ')}. ` +
  'Behandle seine Aussagen als ungeprüft und prüfe die entscheidenden selbst, bevor du darauf handelst.'
