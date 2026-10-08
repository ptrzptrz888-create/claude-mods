# prompt-boost

Eine Mod für Claude Code, die jeden Prompt analysiert, passend zum gerade gewählten Modell optimiert und Claude mit der verbesserten Fassung arbeiten lässt. Sie verbessert auch die Aufträge an Subagenten, macht Subagenten sparsam und lernt aus deinen Bewertungen, wie Briefings für dich aussehen sollten.

Ziel ist effizienteres und genaueres Arbeiten mit Claude. Gleichzeitig zeigt dir die Mod nach jedem Prompt, wie du ihn selbst besser hättest schreiben können.

**Version** 0.4.0 · **Autor** Wilhelm Peters · **Lizenz** [MIT](../LICENSE)

---

## Was sie macht

| Schritt | Was passiert |
|---|---|
| 1. Analyse | Ein Optimierer-Modell (Standard Sonnet) liest deinen Prompt. Es prüft Absicht, Lücken, Annahmen und Komplexität und entscheidet, ob sich eine Optimierung lohnt. |
| 2. Optimierung | Das Briefing wird auf das aktive Modell zugeschnitten (siehe [Modellprofile](#modellprofile)). |
| 3. Arbeiten | Dein Originaltext bleibt unverändert. Das Briefing geht als unsichtbarer Zusatzkontext ans Modell mit, und bei Widersprüchen gilt dein Original. |
| 4. Agenten | Jeder Subagent-Auftrag wird vor dem Start geprüft, wenn möglich auf eine schlanke Variante umgeleitet, umgeschrieben und mit Lagebild und Arbeitsvertrag versehen. Ein Abschnitt im Systemprompt regelt, wann und wie Claude Agenten überhaupt anlegt (siehe [Sparsame Agenten](#sparsame-agenten)). |

Dazu kommen diese Funktionen:

- **Verlaufsanalyse.** Bezieht sich dein Prompt auf Früheres („Punkt 2 von oben"), liest ein zweiter Durchlauf den Gesprächsverlauf mit.
- **Rückfragen.** Was sich nicht sinnvoll annehmen lässt, klärt Claude vor der Arbeit gebündelt mit dir, als Auswahl mit Empfehlung.
- **Statusleiste.** Über der Eingabe siehst du, in welcher Phase die Verarbeitung steht.
- **Verbesserter Prompt im Verlauf.** Du siehst dein Original, die verbesserte Fassung und 1 bis 3 konkrete Schreibtipps.
- **Lernschleife.** Nach optimierten Antworten bewertest du mit **Gut** oder **Daneben**. Alle 5 Bewertungen leitet die Mod daraus deinen persönlichen Prompt-Stil ab.
- **Modell-Tipp.** Ein Hinweis kommt, wenn das gewählte Modell klar zu groß oder zu klein für die Aufgabe ist.
- **Berichtsprüfung.** Fehlen im Bericht eines Agenten Belege oder der Abschnitt „Nicht geprüft", bekommst du einen Hinweis, und Claude prüft selbst nach.
- **Skill-Vorschlag.** Passt ein Eintrag aus der Kernliste deines Skill-Routers, schlägt die Mod den Skill vor.

---

## Installation

Die Mod liegt in `~/Documents/Claude Mods/prompt-boost`. Der Ordner `~/Documents/Claude Mods` ist zugleich der lokale Marketplace `willis-mods`.

```bash
claude plugin marketplace add "$HOME/Documents/Claude Mods"
```

```bash
claude plugin install prompt-boost@willis-mods --scope user
```

Danach lädt die Mod in jeder neuen Session, im Terminal wie in der Desktop-App. Die installierte Mod liest direkt aus dem Ordner. Nach Änderungen am Code reicht deshalb `/reload-plugins`, eine Neuinstallation ist nicht nötig.

Prüfen, ob sie aktiv ist:

```bash
claude plugin list
```

```bash
claude -p "/prompt-boost status"
```

---

## Bedienung

### Befehle

| Befehl | Wirkung |
|---|---|
| `/prompt-boost` oder `/prompt-boost status` | Zeigt Modus, aktives Modell, Einstellungen und die letzte Analyse. |
| `/prompt-boost an` | Modus „ergänzen" (Standard). Das Original bleibt, das Briefing geht als Zusatzkontext mit. |
| `/prompt-boost ersetzen` | Das Briefing ersetzt den Prompt, dein Wortlaut hängt darunter. |
| `/prompt-boost aus` | Schaltet Prompt-Optimierung, Agenten-Umschreiben und Agenten-Leitfaden ab. |
| `/prompt-boost zeigen` | Öffnet das Panel mit der letzten Analyse und den letzten Agenten. |
| `/prompt-boost probe <Text>` | Trockenlauf. Zeigt Analyse, Briefing und Schreibtipps, ohne etwas zu senden. |
| `/prompt-boost stil` | Zeigt deinen gelernten Prompt-Stil. |
| `/prompt-boost stil zurücksetzen` | Löscht Stil und alle Bewertungen. |
| `/lagebild` | Zeigt das Lagebild, das der nächste Agent mitbekommt. |
| `/agent-kosten` | Misst die Tokenkosten deiner Subagenten vor und seit „Sparsame Agenten“ und prüft die Ziele. |

Modus und Stil gelten sitzungsübergreifend.

### Einen Prompt unverändert senden

Schreib `roh:` davor:

```
roh: mach einfach weiter
```

Ohne Analyse gehen auch Prompts unter 40 Zeichen raus, Slash-Befehle und alles über 20.000 Zeichen (meist eingefügtes Material).

### Was du siehst

**Statusleiste** über der Eingabe, während die Mod arbeitet:

```
prompt-boost  … Analyse  ○ Verlauf  ○ Briefing  · analysiert deinen Prompt
prompt-boost  ✓ Analyse  – Verlauf  ✓ Briefing  · fertig in 4,8 s · verbesserte Fassung steht im Verlauf  [Details]
```

| Zeichen | Bedeutung |
|---|---|
| `…` | läuft |
| `✓` | erledigt |
| `○` | wartet |
| `–` | übersprungen |
| `✗` | fehlgeschlagen |

**Eintrag im Verlauf** nach jeder Analyse. Den siehst nur du, er geht nicht ans Modell:

```
prompt-boost · optimiert für Opus/Fable · 4,8 s

Dein Prompt:
mach mal die website schneller, die lädt ewig

Verbesserte Fassung:
## Ziel
Die Ladezeit der Website soll messbar verkürzt werden.
…

So schreibst du es nächstes Mal gleich so:
• Nenne das Projekt oder den Ordner und die URL der Website.
• Beschreibe „lädt ewig" mit einer Zahl und nenne einen Zielwert.
• Gib den Stack an, weil davon die Maßnahmen abhängen.
```

**Bewertungsband** nach einer optimierten Antwort, mit **Gut**, **Daneben** und **Ausblenden**. Bei „Daneben" kannst du einen Satz dazu schreiben, was gefehlt hat. Das Band verschwindet mit deinem nächsten Prompt.

---

## Einstellungen

Zu ändern im Terminal mit `/plugin configure prompt-boost@willis-mods` oder beim Installieren mit `--config schluessel=wert`.

| Schlüssel | Typ | Standard | Bedeutung |
|---|---|---|---|
| `optimizerModel` | `haiku` · `sonnet` · `opus` | `sonnet` | Welches Modell analysiert und umschreibt. `haiku` ist am schnellsten. |
| `minChars` | Zahl | `40` | Kürzere Prompts werden nicht analysiert. |
| `optimizeAgents` | ja/nein | ja | Subagent-Aufträge umschreiben und Arbeitsvertrag anhängen. |
| `contextAnalysis` | ja/nein | ja | Zweiter Durchlauf mit Gesprächsverlauf, wenn der Prompt darauf verweist. |
| `askRating` | ja/nein | ja | Bewertungsband nach optimierten Antworten. |
| `agentPolicy` | `fragen` · `frei` | `fragen` | `fragen`: Claude fragt vor jedem Agenten um Erlaubnis. `frei`: Claude entscheidet selbst. |
| `routerPath` | Pfad | `~/.claude/skill-router/ROUTER.md` | Skill-Router mit Abschnitt „Kernliste". Leer schaltet Skill-Vorschläge ab. |
| `showBrief` | ja/nein | ja | Original, verbesserte Fassung und Schreibtipps im Verlauf zeigen. |
| `showProgress` | ja/nein | ja | Statusleiste über der Eingabe. |
| `leanAgents` | ja/nein | ja | Schlanke Varianten registrieren und `general-purpose` passend umleiten. |
| `briefGate` | ja/nein | ja | Briefing ohne Ziel, Fertig wenn oder Rückgabe einmal zurückweisen. |
| `lagebild` | ja/nein | ja | Jedem neuen Agenten das Lagebild mitgeben, Werkzeug `Lagebild` anbieten. |
| `forkGate` | ja/nein | ja | Forks erst nach deiner Zustimmung im Chat. |
| `roundWarning` | ja/nein | ja | Notiz an den Agenten bei Runde 25 und 40. |
| `agentDisplay` | ja/nein | ja | Laufende Agenten in der Statusleiste, Kostenzeile nach dem Ende. |

---

## Modellprofile

Die Mod liest das aktive Modell und schreibt das Briefing passend dazu.

| Profil | Modelle | So wird das Briefing geschrieben |
|---|---|---|
| Opus/Fable | `opus`, `fable` | Ziel, Zweck, Kontext und Qualitätsmaßstab. Keine Mikro-Schritte, dafür Abwägungen und Prüfung gegen das Endkriterium. |
| Sonnet | `sonnet` | Klare Gliederung mit Anforderungen als Liste, Endkriterium und Ausgabeformat. Bei mehreren Schritten eine Reihenfolge. |
| Haiku | `haiku` | Eine eng umrissene Aufgabe, kurze direkte Sätze, explizite Schritte, festes Format, bei Bedarf ein Beispiel. |

Subagenten bekommen das Profil *ihres* Modells, nicht das der Hauptsession.

**Modell-Tipp:** Bei einfachen Aufgaben auf Opus schlägt die Mod Haiku oder Sonnet vor. Bei schweren Aufgaben auf Haiku oder Sonnet schlägt sie das größere Modell vor. Bei normaler Arbeit bleibt sie still.

---

## Agenten

**Leitfaden im Systemprompt.** Mit `agentPolicy: fragen` startet Claude Agenten nur auf deine ausdrückliche Ansage. Hält Claude einen Agenten für nötig, fragt es vorher mit Zweck und grober Kostenschätzung. Außerdem prüft Claude, ob die Aufgabe nicht selbst zu erledigen ist, wählt das kleinste passende Modell und brieft den Agenten wie eine Kollegin ohne Vorwissen.

**Umschreiben.** Jeder Agent-Auftrag wird zu einem eigenständigen Briefing mit Ziel, Kontext, Grenzen, Endkriterium und Rückgabeformat. Ist die Umschreibung kürzer als 60 % des Originals, wird sie verworfen, weil dann vermutlich Details fehlen.

**Arbeitsvertrag.** An jeden Auftrag wird angehängt, dass der Agent im Umfang bleibt, nichts Ungeprüftes behauptet und mit einem Bericht in vier Teilen abschließt:

1. Ergebnis
2. Belege
3. Nicht geprüft oder unsicher
4. Offene Fragen

**Berichtsprüfung.** Fehlt einer der ersten drei Teile, bekommst du einen Hinweis, und Claude liest die Aufforderung, die Aussagen selbst zu prüfen.

Nicht angefasst werden Forks (die den Verlauf ohnehin erben) und Agenten aus Workflows (deren Auftrag sich nicht ändern lässt).

### Sparsame Agenten

Gemessen an 365 Läufen vor dieser Version kostet ein Subagent im Median 68k Tokens beim Start und braucht 54 Runden. Insgesamt verarbeitet er 7,8 Mio. Tokens Input, der Start macht davon nur etwa 1 % aus. Teuer ist also nicht der Start, sondern **Sockel mal Runden**. Der feste Sockel (Systemprompt, Werkzeuge, CLAUDE.md, Regeln) läuft in jeder Runde mit, und ein Agent mit dünnem Briefing braucht viele Runden, um sich zu erarbeiten, was die Hauptsession schon weiß. Diese Version setzt an beiden Faktoren an.

| Baustein | Was passiert |
|---|---|
| **Lagebild** | Jeder Agent außer Forks bekommt einen Abschnitt mit Arbeitsverzeichnis, Ziel der Session, Git-Stand, den in der Hauptsession gelesenen und geänderten Dateien sowie den Notizen aus dem Werkzeug `Lagebild` (Befund, Ausgeschlossen, Entscheidung). Höchstens etwa 1.500 Tokens, die ältesten Notizen fallen zuerst heraus. |
| **Schlanke Varianten** | `prompt-boost:suche` (haiku, Read, Grep, Glob, Bash), `prompt-boost:umsetzung` (sonnet, dazu Edit und Write), `prompt-boost:pruefung` (sonnet, lesend plus Bash). Sie laden weder CLAUDE.md noch Regeln und haben einen eigenen Regelkern von etwa 300 Tokens. |
| **Umleitung** | Ein `general-purpose`-Auftrag geht nach Stichworten im `Ziel:` an die passende Variante. Ist der Auftrag gemischt oder unklar, geht er an `umsetzung`. Braucht er Browser, MCP, Web oder Agenten, bleibt es bei general-purpose. Andere Agententypen bleiben unberührt. |
| **Modell** | Ein ausdrücklich gesetztes Modell bleibt. Sonst gilt das Modell der Variante, opus wird nie automatisch gewählt. |
| **Briefing-Gate** | Pflicht sind `Ziel:`, `Fertig wenn:` und `Rückgabe:`. Fehlt eines, wird der Start einmal mit einer Vorlage abgelehnt, der zweite Versuch mit derselben Beschreibung geht immer durch. |
| **Fork-Sperre** | Ein Fork erbt den ganzen Verlauf (bis zu 180k Tokens Start). Er wird abgelehnt, bis du im nächsten Prompt zustimmst („ja“, „ok“, „fork“). Dann geht genau einer durch. |
| **Rundenwarnung** | Bei Runde 25 und 40 bekommt der Agent eine Notiz, mit dem Bericht abzuschließen, wenn „Fertig wenn“ erreicht ist. |
| **Anzeige** | Laufende Agenten stehen in der Statusleiste (Variante, Runde, Kontext). Nach dem Ende kommt eine Kostenzeile in den Verlauf, die nur du siehst. |

Gate, Sperre und Umleitung gelten nur für Agenten, die das Modell startet. Starts aus dem Code anderer Mods, Workflow-Agenten und Teammates bleiben unberührt. `/agent-kosten` vergleicht ab dem ersten Start dieser Version mit den 28 Tagen davor. Ziel ist ein Start unter 30k und jeweils mindestens 40 % weniger Runden und Gesamtinput.

---

## Kosten und Wartezeit

| Wann | Zusätzlicher Aufruf |
|---|---|
| Jeder analysierte Prompt | 1 Aufruf des Optimierer-Modells (Standard Sonnet, geringer Denkaufwand, höchstens 25 s) |
| Prompt mit Verweis auf den Verlauf | zusätzlich 1 Durchlauf über das Gespräch mit dem Hauptmodell, der größte Teil kommt aus dem Prompt-Cache |
| Jeder Subagent | 1 Aufruf des Optimierer-Modells, dazu ein `git status` für das Lagebild |
| Alle 5 Bewertungen | 1 Aufruf zum Ableiten des Stils |

Die Analyse verzögert den Start jeder Antwort um einige Sekunden. Geht dir das zu langsam, stell `optimizerModel` auf `haiku`. Scheitert der Optimierer (Überlast, Zeitlimit, unlesbare Antwort), geht dein Original unverändert raus. Die Mod blockiert also nie deine Arbeit.

---

## Daten

| Was | Wo | Umfang |
|---|---|---|
| Modus | Plugin-Speicher von Claude Code (`mode`) | ein Wert |
| Bewertungen | Plugin-Speicher (`feedback`) | höchstens 60, je Absicht, Modell, Bewertung, Notiz, Zeitpunkt |
| Gelernter Stil | Plugin-Speicher (`style`) | höchstens 10 Stichpunkte |
| Letzte Analyse, letzte 20 Agenten, Statusleiste | Sitzungszustand | nur für die laufende Session |
| Lagebild, Agentenzähler, Fork-Freigabe | Sitzungszustand | nur für die laufende Session, nichts landet im Projekt |
| Startzeitpunkt für `/agent-kosten` | Plugin-Speicher (`leanSinceAt`) | ein Zeitstempel |

Prompts und Analysen laufen über den API-Zugang deiner Claude-Session, also über denselben Weg wie deine normalen Anfragen an Claude. Ein Drittdienst ist nicht beteiligt. `/prompt-boost stil zurücksetzen` löscht Stil und Bewertungen.

---

## Grenzen

- **Ohne Verlauf.** Der erste Analysedurchlauf sieht den Gesprächsverlauf nicht. Er erkennt Verweise auf den Verlauf und gibt dann an den zweiten Durchlauf ab. Rückfragen, die sich aus dem Verlauf beantworten lassen, soll Claude überspringen.
- **Nur für Getipptes.** Die Mod greift nur bei Prompts, die du selbst tippst, in der Session oder über Remote Control. Prompts aus Skripten (`claude -p`, SDK), Benachrichtigungen und anderen Sessions bleiben unberührt.
- **Kein Notizfeld auf dem Handy.** Die mobile App hat kein Eingabefeld, dort speichert „Daneben" ohne Notiz.
- **Kürzere Anzeige im Terminal.** Das Terminal zeigt vom Verlaufseintrag die ersten 2000 Zeichen, die Desktop-App bis zu 10.000.
- **Faustregel für Berichte.** Die Berichtsprüfung sucht nach Stichworten (Ergebnis, Belege, Nicht geprüft). Sie ist eine Faustregel, keine inhaltliche Prüfung.
- **Faustregel für Umleitung und Gate.** Beide erkennen Feldnamen und Stichworte, sie verstehen den Auftrag nicht. Eine Fehlzuordnung fällt im Zweifel auf `umsetzung`, also auf die Variante mit den meisten Werkzeugen.
- **Varianten ohne CLAUDE.md.** Was nicht im Regelkern oder im Briefing steht, weiß eine Variante nicht. Fachagenten wie `steuerberater` bleiben deshalb unverändert.
- **Lagebild nur aus der Hauptsession.** Dateien, die ein Agent liest, landen nicht im Lagebild, nur die der Hauptsession.

---

## Entwicklung

### Aufbau

```
prompt-boost/
├── .claude-plugin/plugin.json   Manifest und Einstellungen
├── hooks/
│   ├── hooks.json               verweist auf register.tsx
│   ├── register.tsx             Prompt-Hooks, Befehle, Statusleiste, Panel
│   ├── agent-watch.ts           Agentenstart, Rundenzähler, Lagebild-Werkzeug, /lagebild, /agent-kosten
│   ├── lean-agents.ts           Varianten, Umleitung, Gate, Fork-Freigabe, Texte
│   ├── lagebild.ts              Lagebild-Zustand und Darstellung
│   ├── state.ts                 gemeinsame Startwerte des Sitzungszustands
│   ├── optimizer.ts             Anfragen an den Optimierer, Auswertung, Modell-Tipp
│   ├── model-profiles.ts        Modellfamilien und ihre Schreibweise
│   ├── agent-guide.ts           Agenten-Leitfaden und Arbeitsvertrag
│   ├── display.ts               Texte für Statusleiste und Verlaufseintrag
│   ├── feedback.ts              Bewertungen und Stil-Ableitung
│   ├── reports.ts               Prüfung von Agenten-Berichten
│   └── router.ts                Kernliste aus dem Skill-Router
├── types/index.d.ts             Typen und Vertrag für den Sitzungszustand
├── scripts/agent-kosten.py      Kostenmessung aus den Subagent-Transkripten
└── tests/                       prompt-boost.test.ts, lean-agents.test.ts
```

**Vier Regeln der Engine bestimmen den Aufbau.**

1. Das Engine-Objekt `$` darf nur an Funktionen gehen, die in derselben Datei stehen, nie über einen Import.
2. Ein Plugin hat genau ein Hooks-Modul. `register.tsx` reicht `on` an `registerAgentWatch` in `agent-watch.ts` weiter, das ist erlaubt.
3. Ein Ereignis ohne Matcher darf nur einmal registriert sein. `session.start`, `prompt.submit` und `turn.complete` gehören deshalb `register.tsx`.
4. Atome müssen in der Datei deklariert sein, die sie liest. Beide Dateien deklarieren dieselben Schlüssel, und `state.ts` liefert nur die Startwerte.

Alle übrigen Module sind reine Funktionen ohne Zugriff auf `$` und dadurch ohne Engine testbar.

### Benutzte Hooks

| Hook | Zweck |
|---|---|
| `prompt.submit` | Analyse, Optimierung, Kontext, Statusleiste, Verlaufseintrag |
| `session.start` | Befehle, Varianten und Werkzeug `Lagebild` registrieren |
| `agent.spawn` | Fork-Sperre, Gate, Umleitung, Umschreiben, Lagebild, Vertrag |
| `turn.step` | Runden und Kontext je Subagent zählen, Rundenwarnung |
| `turn.complete` | Bewertungsband anbieten, Agenten-Bericht prüfen, Kostenzeile |
| `tool.call` (Agent) | Hinweis zu einem Bericht ans Ergebnis hängen |
| `tool.call` (Read, Edit, Write, `Lagebild`) | Lagebild der Hauptsession führen |
| `prompt.compose` | Agenten-Leitfaden in den Systemprompt |
| `ui.render` (AbovePrompt, Pane) | Statusleiste, Bewertungsband, Panel |
| `command.run` | `/prompt-boost`, `/lagebild`, `/agent-kosten` |

### Prüfen

```bash
claude plugin validate "$HOME/Documents/Claude Mods/prompt-boost"
```

```bash
claude plugin test "$HOME/Documents/Claude Mods/prompt-boost"
```

```bash
claude -p "/prompt-boost probe mach mal die website schneller"
```

Die Tests simulieren die Modellaufrufe. Sie decken Analyse, Modi, Ausnahmen, Verlaufsanalyse, Rückfragen, Modell-Tipp, Skill-Router, Bewertung und Stil-Ableitung ab, außerdem Agenten, Berichtsprüfung, Statusleiste und Verlaufseintrag. Der echte Weg lässt sich mit `probe` prüfen, das ruft das Optimierer-Modell wirklich auf.

### Weitergeben

Die Mod liegt öffentlich unter [github.com/ptrzptrz888-create/claude-mods](https://github.com/ptrzptrz888-create/claude-mods). Jemand anderes installiert sie in einer Claude-Code-Session im Terminal mit:

```
/plugin install prompt-boost --marketplace ptrzptrz888-create/claude-mods
```

Die Frage „Add marketplace?" mit `y` bestätigen und als Scope „user" wählen. Danach zeigt Claude die Einstellungen der Mod, Enter übernimmt jeweils den Standard bis „Save configuration".

Im Code-Tab der Desktop-App und in `claude -p` gibt es den Befehl `/plugin` nicht. Dort, oder ganz ohne laufende Session, installierst du mit diesen zwei Befehlen im Terminal:

```bash
claude plugin marketplace add ptrzptrz888-create/claude-mods
```

```bash
claude plugin install prompt-boost@willis-mods --scope user
```

Der Pfad in `routerPath` zeigt dann ins Leere. Das ist harmlos, es kommen nur keine Skill-Vorschläge.
