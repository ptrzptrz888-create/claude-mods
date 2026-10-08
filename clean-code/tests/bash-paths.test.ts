import { describe, expect, test } from 'claude-code/testing'

import { bashModifiedPaths } from '../hooks/bash-paths'

describe('bashModifiedPaths, Umleitungen', () => {
  test('erkennt > und >> als Schreibziel', () => {
    expect(bashModifiedPaths('echo x > CLAUDE.md')).toEqual(['CLAUDE.md'])
    expect(bashModifiedPaths('echo x >> AGENTS.md')).toEqual(['AGENTS.md'])
  })

  test('erkennt Umleitungen auch ohne Leerzeichen und mit Dateideskriptor', () => {
    expect(bashModifiedPaths('echo x >out.ts')).toEqual(['out.ts'])
    expect(bashModifiedPaths('cmd 1> a.log')).toEqual(['a.log'])
    expect(bashModifiedPaths('cmd 2>err.txt')).toEqual(['err.txt'])
  })

  test('erkennt &> als Schreibziel', () => {
    expect(bashModifiedPaths('cmd &> alles.log')).toEqual(['alles.log'])
  })

  test('ignoriert 2>&1 und Ziele unter /dev/', () => {
    expect(bashModifiedPaths('npm test 2>&1')).toEqual([])
    expect(bashModifiedPaths('cmd > /dev/null 2>&1')).toEqual([])
    expect(bashModifiedPaths('cmd >/dev/null')).toEqual([])
  })

  test('liest Eingabeumleitungen nicht als Schreiben', () => {
    expect(bashModifiedPaths('cat < CLAUDE.md')).toEqual([])
  })
})

describe('bashModifiedPaths, Werkzeuge', () => {
  test('tee schreibt alle Dateiargumente, Optionen fallen weg', () => {
    expect(bashModifiedPaths('echo x | tee -a out.ts other.ts')).toEqual(['out.ts', 'other.ts'])
  })

  test('sed -i nimmt die Dateien am Ende, nicht das Skript', () => {
    expect(bashModifiedPaths("sed -i 's/a/b/' CLAUDE.md")).toEqual(['CLAUDE.md'])
  })

  test('sed -i mit leerem Suffix (macOS) zählt die Datei, nicht das Leerwort', () => {
    expect(bashModifiedPaths("sed -i '' 's/a/b/' AGENTS.md")).toEqual(['AGENTS.md'])
  })

  test('sed -i.bak mit -e liest das Skript aus -e und zählt alle Dateien', () => {
    expect(bashModifiedPaths("sed -i.bak -e 's/a/b/' a.ts b.ts")).toEqual(['a.ts', 'b.ts'])
  })

  test('sed mit -i nach -e erkennt die Datei trotzdem', () => {
    expect(bashModifiedPaths("sed -e 's/a/b/' -i CLAUDE.md")).toEqual(['CLAUDE.md'])
  })

  test('perl -pi -e schreibt die Dateien am Ende', () => {
    expect(bashModifiedPaths("perl -pi -e 's/a/b/' CLAUDE.md")).toEqual(['CLAUDE.md'])
  })

  test('perl -i.bak -pe schreibt die Datei am Ende', () => {
    expect(bashModifiedPaths("perl -i.bak -pe 's/a/b/' x.ts")).toEqual(['x.ts'])
  })

  test('perl ohne -i schreibt nichts', () => {
    expect(bashModifiedPaths("perl -ne 'print' x.ts")).toEqual([])
  })

  test('cp und install zählen das letzte Argument', () => {
    expect(bashModifiedPaths('cp a.ts backup/b.ts')).toEqual(['backup/b.ts'])
    expect(bashModifiedPaths('install -m 644 build/a.js /usr/local/bin/a')).toEqual(['/usr/local/bin/a'])
  })

  test('mv meldet Quelle und Ziel, weil auch die Quelle verschwindet', () => {
    expect(bashModifiedPaths('mv old.ts new.ts')).toEqual(['old.ts', 'new.ts'])
    expect(bashModifiedPaths('mv CLAUDE.md /tmp/x.md')).toEqual(['CLAUDE.md', '/tmp/x.md'])
  })

  test('rm und touch zählen alle Nicht-Options-Argumente', () => {
    expect(bashModifiedPaths('rm -rf dist old.ts')).toEqual(['dist', 'old.ts'])
    expect(bashModifiedPaths('touch a.ts b.ts')).toEqual(['a.ts', 'b.ts'])
  })

  test('überspringt ein führendes sudo', () => {
    expect(bashModifiedPaths('sudo touch CLAUDE.md')).toEqual(['CLAUDE.md'])
  })

  test('überspringt Variablenzuweisungen vor dem Befehl', () => {
    expect(bashModifiedPaths('FOO=1 touch a.ts')).toEqual(['a.ts'])
    expect(bashModifiedPaths("LANG=C sed -i 's/a/b/' AGENTS.md")).toEqual(['AGENTS.md'])
  })
})

describe('bashModifiedPaths, Lesebefehle ergeben nichts', () => {
  test('cat, grep, ls und git status lesen nur', () => {
    expect(bashModifiedPaths('cat CLAUDE.md')).toEqual([])
    expect(bashModifiedPaths('grep x AGENTS.md')).toEqual([])
    expect(bashModifiedPaths('ls -la')).toEqual([])
    expect(bashModifiedPaths('git status')).toEqual([])
  })

  test('sed -n und sed ohne -i lesen nur', () => {
    expect(bashModifiedPaths('sed -n 1,5p CLAUDE.md')).toEqual([])
    expect(bashModifiedPaths("sed 's/a/b/' CLAUDE.md")).toEqual([])
  })

  test('ein Schreibzeichen im Text in Anführungszeichen zählt nicht', () => {
    expect(bashModifiedPaths('echo "a > CLAUDE.md"')).toEqual([])
    expect(bashModifiedPaths("echo 'a > CLAUDE.md'")).toEqual([])
  })

  test('ein Kommentar zählt nicht', () => {
    expect(bashModifiedPaths('# rm a.ts')).toEqual([])
  })
})

describe('bashModifiedPaths, Trennung und Reihenfolge', () => {
  test('trennt an &&, ||, ; und | und liest jeden Teil', () => {
    expect(bashModifiedPaths('cd repo && rm a.ts; cp b.ts c.ts || true')).toEqual(['a.ts', 'c.ts'])
  })

  test('trennt an Zeilenumbrüchen', () => {
    expect(bashModifiedPaths('touch a.ts\nrm b.ts')).toEqual(['a.ts', 'b.ts'])
  })

  test('ignoriert Semikolons und Operatoren in Anführungszeichen', () => {
    expect(bashModifiedPaths('echo "x; rm a.ts"')).toEqual([])
  })

  test('entfernt Duplikate und behält die Reihenfolge des Auftretens', () => {
    expect(bashModifiedPaths('touch b.ts && touch a.ts && touch b.ts')).toEqual(['b.ts', 'a.ts'])
  })
})

describe('bashModifiedPaths, Heredocs', () => {
  test('entfernt den Inhalt und nimmt nur das Kopfziel', () => {
    const command = "cat > CLAUDE.md <<'EOF'\n# Regeln\necho x > AGENTS.md\nEOF"

    expect(bashModifiedPaths(command)).toEqual(['CLAUDE.md'])
  })

  test('erkennt <<- mit eingerückter Endzeile', () => {
    const command = 'cat > a.md <<-EOF\n\tfoo > B.md\n\tEOF'

    expect(bashModifiedPaths(command)).toEqual(['a.md'])
  })

  test('analysiert die Zeile nach dem Heredoc weiter', () => {
    const command = 'cat > a.ts <<EOF\nx\nEOF\nrm b.ts'

    expect(bashModifiedPaths(command)).toEqual(['a.ts', 'b.ts'])
  })

  test('erkennt eine Umleitung hinter der Heredoc-Kopfzeile', () => {
    const command = 'cat <<"EOF" > a.ts\nfoo\nEOF'

    expect(bashModifiedPaths(command)).toEqual(['a.ts'])
  })
})

describe('bashModifiedPaths, kaputte Eingaben', () => {
  test('wirft nicht bei ungeschlossenem Anführungszeichen', () => {
    expect(bashModifiedPaths('echo "abc')).toEqual([])
  })

  test('liefert für leere Eingabe und fehlende Argumente nichts', () => {
    expect(bashModifiedPaths('')).toEqual([])
    expect(bashModifiedPaths('touch')).toEqual([])
    expect(bashModifiedPaths('cp')).toEqual([])
  })

  test('unbekannte Befehle ergeben nichts', () => {
    expect(bashModifiedPaths('python -c "open(\'x\',\'w\')"')).toEqual([])
  })
})
