# claude-mods

Eigene Mods für [Claude Code](https://claude.ai/code), gebündelt als Plugin-Marketplace `willis-mods`.

| Mod | Was sie macht |
|---|---|
| [prompt-boost](prompt-boost/README.md) | Analysiert und optimiert jeden Prompt passend zum aktiven Modell, verbessert Agenten-Aufträge, zeigt dir die verbesserte Fassung samt Schreibtipps und lernt aus deinen Bewertungen. |

## Installation

In einer Claude-Code-Session im Terminal:

```
/plugin install prompt-boost --marketplace ptrzptrz888-create/claude-mods
```

Die Frage „Add marketplace?" mit `y` bestätigen und als Scope „user" wählen. Danach läuft die Mod in jeder neuen Session, auch in der Desktop-App.

Alternativ ohne laufende Session:

```bash
claude plugin marketplace add ptrzptrz888-create/claude-mods
```

```bash
claude plugin install prompt-boost@willis-mods --scope user
```

## Hinweis

Die Mods sind auf Deutsch geschrieben und richten sich an deutschsprachige Nutzer. Sie nutzen die Plugin-Schnittstelle für Funktions-Hooks von Claude Code, die sich als Early Access zwischen Versionen ändern kann.

## Lizenz

[MIT](LICENSE). Frei nutzbar, veränderbar und weitergebbar, solange der Lizenzhinweis erhalten bleibt. Ohne Gewähr.
