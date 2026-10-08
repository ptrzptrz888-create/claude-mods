# clean-code

Eine Mod für Claude Code, die Claude bei sauberem Code an den Regeln aus dem Video [Sauberer Code mit Claude Code](https://youtu.be/3gmpWRVeTI8) von Moritz Brandes ausrichtet. Sie erzwingt, was sich erzwingen lässt, und sagt Claude den Rest in jeder Session.

**Version** 0.1.0 · **Autor** Wilhelm Peters · **Lizenz** [MIT](../LICENSE)

---

## Was sie macht

- **Prüfhinweis.** Nach einer Code-Änderung erinnert die Mod Claude daran, den Linter des Projekts laufen zu lassen und alle Befunde zu beheben. Den Befehl erkennt sie an den Konfigurationsdateien im Projekt, etwa an `package.json` mit einem `lint`-Skript, `.oxlintrc.json`, `oxlint.config.ts` (so schreibt es Ultracite), `biome.json`, `pyproject.toml` oder `Cargo.toml`.
- **Regeln im Systemprompt.** Ein kurzer Abschnitt mit den Regeln R1 bis R9 wirkt in jeder Session. Er bleibt unter 1.200 Zeichen.
- **Referenzordner.** Bibliotheken holst du als flache Checkouts ohne Historie in einen Ordner. Bei Fragen zu diesen Bibliotheken liest Claude dort zuerst den Quellcode.
- **Schutz für Anweisungsdateien.** Die Mod kann CLAUDE.md, CLAUDE.local.md, AGENTS.md, SKILL.md und Dateien unter `.claude/skills/`, `.claude/agents/` und `.claude/rules/` davor schützen, dass Claude sie ohne Nachfrage ändert.

Nur R1, R4 und R8 haben zusätzlich einen Hook. Die übrigen Regeln wirken über den Systemprompt und sind damit Bitten an Claude, keine Prüfung.

---

## Regeln aus dem Video

| Regel aus dem Video | Was die Mod tut |
|---|---|
| R1 Nach Code-Änderung Linter laufen lassen und Befunde beheben | Hinweis nach Code-Änderungen mit dem erkannten Lint-Befehl, auch wenn Claude die Datei per Bash schreibt (siehe Grenzen). Ohne Linter folgt der Hinweis auf Typprüfung oder Tests und den Vorschlag, einen strengen Linter einzurichten. |
| R2 Streng typisieren (TypeScript statt JavaScript, `strict` an) | Regel im Systemprompt. Dazu hängt die Mod an den Lint-Hinweis einen strict-Satz, wenn die `tsconfig.json` des Projekts `"strict": true` nicht setzt. Erbt die Datei per `extends`, kommt kein Hinweis, weil strict dort herkommen kann. |
| R3 Wiederkehrende Fehler als Lint-Regel, nicht als Prosa | Regel im Systemprompt |
| R4 Referenzordner mit flachen Checkouts zuerst lesen | Befehle `/ref-add` und `/refs`, Liste der Bibliotheken im Systemprompt |
| R5 Idiomatischer Code im Stil des Frameworks | Regel im Systemprompt |
| R6 Agentenfreundliche, explizite Technik wählen und das Ökosystem prüfen | Regel im Systemprompt |
| R7 Die eleganteste, kompakteste und lesbarste Lösung wählen | Regel im Systemprompt |
| R8 CLAUDE.md, AGENTS.md und Skills nicht automatisch von Claude pflegen lassen | Nachfrage vor jeder Änderung, auch bei Bash-Befehlen, die die Datei schreiben. Einstellbar als Sperre oder ganz aus. |
| R9 Kontext sauber halten, kurze Anweisungen | Der Regelabschnitt im Systemprompt bleibt unter 1.200 Zeichen. |

---

## Befehle

| Befehl | Wirkung |
|---|---|
| `/ref-add <git-url>` | Holt das Repository als flachen Checkout (`git clone --depth 1`) in den Referenzordner. Gibt es das Ziel schon, meldet die Mod das und klont nicht erneut. Erlaubt sind `https://`- und `git@`-Adressen. |
| `/refs` | Listet die Ordner im Referenzordner auf. |

---

## Einstellungen

| Einstellung | Standard | Bedeutung |
|---|---|---|
| `referencesDir` | `~/references` | Ordner für die flachen Checkouts |
| `lintHint` | `true` | Prüfhinweis nach Code-Änderungen |
| `guardInstructionFiles` | `fragen` | Schutz für CLAUDE.md, AGENTS.md und Skills. `fragen` bedeutet, Claude fragt vor jeder Änderung. `sperren` verbietet die Änderung. `aus` schaltet den Schutz ab. |

Die Einstellungen fragt Claude bei der Installation ab. Enter übernimmt jeweils den Standard.

---

## Installation

Die Mod steckt im Marketplace `willis-mods`.

In einer Claude-Code-Session im Terminal:

```
/plugin install clean-code --marketplace ptrzptrz888-create/claude-mods
```

Die Frage „Add marketplace?" mit `y` bestätigen und als Scope „user" wählen. Danach zeigt Claude die Einstellungen der Mod, Enter übernimmt jeweils den Standard bis „Save configuration". Anschließend läuft die Mod in jeder neuen Session, auch in der Desktop-App.

Im Code-Tab der Desktop-App und in `claude -p` gibt es den Befehl `/plugin` nicht. Dort, oder ganz ohne laufende Session, installierst du mit diesen zwei Befehlen im Terminal:

```bash
claude plugin marketplace add ptrzptrz888-create/claude-mods
```

```bash
claude plugin install clean-code@willis-mods --scope user
```

---

## Ergänzend von Hand

Die Mod übernimmt nicht alles. Vier Punkte musst du selbst erledigen.

- **Referenzordner füllen.** Die Mod legt keine Bibliotheken an. Hole die Quellen selbst mit `/ref-add <git-url>` in den Ordner aus `referencesDir`.
- **Strengen Linter einrichten.** Im Video ist von oxlint mit einem Preset die Rede. Gemeint ist [Ultracite](https://www.ultracite.ai), ein Zero-Config-Preset für oxlint und Biome mit Antislop-Regeln. Die Untertitelspur schreibt es als „Ultraside“, die deutsche Originalspur bestätigt „Ultracite“. Dazu gehören TypeScript statt JavaScript und `strict` in der Konfiguration. Die Mod richtet das nicht ein.
- **1-Mio.-Kontextfenster abschalten.** Der Sprecher schaltet es per Umgebungsvariable ab und lässt Claude bei einer empfohlenen Grenze kompaktieren. Die Variable ist `CLAUDE_CODE_DISABLE_1M_CONTEXT=1` (Quelle: code.claude.com/docs/en/env-vars) und begrenzt den Kontext auf 200K. Die Mod setzt sie nicht.
- **Beispiele des Sprechers.** Ponytail (ein Skill gegen Overengineering) sowie Effect und Foldkit nennt der Sprecher als persönliche Wahl, laut deutscher Originalspur bestätigt. Effect empfiehlt er als Standardbibliothek für TypeScript, Foldkit als React-Alternative für Agenten. Das sind Beispiele des Sprechers, die Mod schreibt kein Framework vor.

---

## Grenzen

- Der Hinweis nach einer Code-Änderung ist nur eine Erinnerung. Der Linter läuft nicht automatisch, Claude muss ihn ausführen.
- Der Schutz der Anweisungsdateien und der Lint-Hinweis greifen bei Edit, Write und MultiEdit und bei Bash-Befehlen, die erkennbar Dateien schreiben, etwa Umleitungen (`>`, `>>`), `sed -i`, `tee`, `mv` oder `rm`. Das ist eine Textanalyse des Befehls, keine Ausführung.
- Nicht erkannt werden Schreibzugriffe, die erst zur Laufzeit entstehen, etwa `python -c`, `node -e`, Skripte, die selbst Dateien schreiben, und Befehlssubstitution wie `$(…)`. Wer die Sperre umgehen will, kann das also weiterhin.

---

## Tests

```bash
claude plugin test .
```

`bun test` allein reicht hier nicht, weil die Tests das Modul `claude-code/testing` brauchen, das nur `claude plugin test` bereitstellt.
