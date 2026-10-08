import type { ModelFamily } from '../types'

type Profile = {
  label: string
  /** How a prompt for this kind of model should be written. */
  style: string
}

const PROFILES: Record<ModelFamily, Profile> = {
  frontier: {
    label: 'Opus/Fable',
    style: [
      'Das Zielmodell ist ein Spitzenmodell mit starkem eigenem Urteil.',
      'Beschreibe Ziel, Zweck, Kontext und Qualitätsmaßstab klar, aber schreibe keine Mikro-Schritte vor.',
      'Nenne Randbedingungen und echte Abwägungen. Verlange Prüfung gegen das Endkriterium statt bloßer Behauptung.',
      'Keine Großbuchstaben-Dringlichkeit, keine Drohungen, kein Rollenspiel-Füllwerk: das verschlechtert die Antwort.',
    ].join(' '),
  },
  balanced: {
    label: 'Sonnet',
    style: [
      'Das Zielmodell ist ein starkes Allround-Modell.',
      'Gliedere klar: Ziel, Kontext, Anforderungen als Liste, Randbedingungen, Endkriterium, Ausgabeformat.',
      'Gib eine sinnvolle Reihenfolge vor, wenn die Aufgabe mehrere Schritte hat.',
    ].join(' '),
  },
  fast: {
    label: 'Haiku',
    style: [
      'Das Zielmodell ist schnell und klein.',
      'Eine eng umrissene Aufgabe, kurze direkte Sätze, explizite Schritte, ein festes Ausgabeformat.',
      'Wenn das Format wichtig ist, gib ein kurzes Beispiel. Lass nichts implizit.',
    ].join(' '),
  },
  unknown: {
    label: 'unbekanntes Modell',
    style:
      'Gliedere klar in Ziel, Kontext, Anforderungen, Randbedingungen, Endkriterium und Ausgabeformat.',
  },
}

/** Maps a model id or alias (`claude-opus-5-5`, `sonnet`) to its family. */
export const familyOf = (model: string): ModelFamily => {
  const id = model.toLowerCase()
  if (/opus|fable/.test(id)) return 'frontier'
  if (/sonnet/.test(id)) return 'balanced'
  if (/haiku/.test(id)) return 'fast'

  return 'unknown'
}

export const profileOf = (family: ModelFamily): Profile => PROFILES[family]
