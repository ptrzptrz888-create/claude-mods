import { describe, expect, test } from 'claude-code/testing'

import {
  CODE_EXTENSIONS,
  SECTION_LIMIT,
  detectLintCommand,
  directoryNames,
  expandHome,
  instructionGuardText,
  isCodeFile,
  isInstructionFile,
  lintHintText,
  refsListText,
  repoNameOf,
  rulesSection,
  strictHintText,
  writtenPathsOf,
} from '../hooks/rules'

const HOME = '/Users/test'
const LONG_DIR = `~/${'x'.repeat(1500)}`
const HUNDRED_REFS = Array.from({ length: 100 }, (_, index) => `framework-bibliothek-mit-langem-namen-${String(index).padStart(3, '0')}`)

describe('isCodeFile', () => {
  test('erkennt Code unabhängig von Groß- und Kleinschreibung', () => {
    expect(isCodeFile('src/tax.ts')).toBe(true)
    expect(isCodeFile('App.TSX')).toBe(true)
    expect(isCodeFile('main.rs')).toBe(true)
  })

  test('nimmt jede Endung der Liste an', () => {
    expect(CODE_EXTENSIONS.every(extension => isCodeFile(`datei.${extension}`))).toBe(true)
  })

  test('lässt Dokumentation, Konfiguration und Dateien ohne Endung aus', () => {
    expect(isCodeFile('README.md')).toBe(false)
    expect(isCodeFile('package.json')).toBe(false)
    expect(isCodeFile('Makefile')).toBe(false)
    expect(isCodeFile('notizen.ts.bak')).toBe(false)
  })
})

describe('isInstructionFile', () => {
  test('erkennt CLAUDE.md, AGENTS.md, SKILL.md und die lokale CLAUDE-Datei an jedem Ort', () => {
    expect(isInstructionFile('/repo/CLAUDE.md')).toBe(true)
    expect(isInstructionFile('/repo/sub/AGENTS.md')).toBe(true)
    expect(isInstructionFile('/repo/CLAUDE.local.md')).toBe(true)
    expect(isInstructionFile('/repo/tools/SKILL.md')).toBe(true)
  })

  test('erkennt Dateien in .claude/skills, .claude/agents und .claude/rules, auch mit relativem Pfad', () => {
    expect(isInstructionFile('/Users/test/.claude/skills/helfer/tool.ts')).toBe(true)
    expect(isInstructionFile('.claude/agents/prüfer.md')).toBe(true)
    expect(isInstructionFile('/Users/test/.claude/rules/stil.md')).toBe(true)
    expect(isInstructionFile('.claude/rules/stil.md')).toBe(true)
  })

  test('lässt gewöhnliche Dateien durch, auch wenn ihr Name ähnlich klingt', () => {
    expect(isInstructionFile('/repo/README.md')).toBe(false)
    expect(isInstructionFile('/repo/docs/claude-notizen.md')).toBe(false)
    expect(isInstructionFile('/repo/src/skills/x.ts')).toBe(false)
    expect(isInstructionFile('/repo/src/rules/x.ts')).toBe(false)
  })
})

describe('expandHome', () => {
  test('ersetzt ein führendes ~ durch das Home-Verzeichnis', () => {
    expect(expandHome('~/references', HOME)).toBe('/Users/test/references')
    expect(expandHome('~', HOME)).toBe('/Users/test')
  })

  test('lässt andere Pfade unverändert, auch ~user', () => {
    expect(expandHome('/opt/refs', HOME)).toBe('/opt/refs')
    expect(expandHome('~otheruser/refs', HOME)).toBe('~otheruser/refs')
  })
})

describe('repoNameOf', () => {
  test('liest den Namen aus https- und git@-URLs, ohne .git', () => {
    expect(repoNameOf('https://github.com/owner/repo.git')).toBe('repo')
    expect(repoNameOf('https://github.com/owner/repo')).toBe('repo')
    expect(repoNameOf('https://github.com/owner/repo/')).toBe('repo')
    expect(repoNameOf('git@github.com:owner/repo.git')).toBe('repo')
  })

  test('lehnt ungültige URLs ab', () => {
    expect(repoNameOf('nicht eine url')).toBeUndefined()
    expect(repoNameOf('http://github.com/owner/repo.git')).toBeUndefined()
    expect(repoNameOf('ext::sh -c touch')).toBeUndefined()
    expect(repoNameOf('--upload-pack=evil')).toBeUndefined()
  })

  test('lehnt .. und .git als Name ab', () => {
    expect(repoNameOf('git@github.com:owner/..')).toBeUndefined()
    expect(repoNameOf('https://github.com/owner/..')).toBeUndefined()
    expect(repoNameOf('https://github.com/owner/.git')).toBeUndefined()
  })

  test('lehnt Namen mit Leerzeichen oder Sonderzeichen ab', () => {
    expect(repoNameOf('https://github.com/owner/re po')).toBeUndefined()
    expect(repoNameOf('git@github.com:owner/repo;rm.git')).toBeUndefined()
  })
})

describe('detectLintCommand', () => {
  test('nimmt scripts.lint aus der package.json zuerst', () => {
    const command = detectLintCommand({ packageJson: '{"scripts":{"lint":"oxlint"}}', files: ['.oxlintrc.json'] })

    expect(command).toBe('npm run lint')
  })

  test('wirft nicht bei kaputtem package.json und fällt auf die nächste Regel zurück', () => {
    const command = detectLintCommand({ packageJson: '{ kaputt', files: ['.oxlintrc.json'] })

    expect(command).toBe('npx oxlint')
  })

  test('ignoriert ein lint-Feld, das kein Text ist', () => {
    expect(detectLintCommand({ packageJson: '{"scripts":{"lint":1}}', files: [] })).toBeUndefined()
  })

  test('erkennt Biome, Ruff, Clippy und go vet an den Projektdateien', () => {
    expect(detectLintCommand({ files: ['biome.jsonc'] })).toBe('npx biome check')
    expect(detectLintCommand({ files: ['pyproject.toml'] })).toBe('ruff check')
    expect(detectLintCommand({ files: ['Cargo.toml'] })).toBe('cargo clippy')
    expect(detectLintCommand({ files: ['go.mod'] })).toBe('go vet ./...')
  })

  test('erkennt oxlint an jeder Konfigurationsdatei', () => {
    for (const file of ['.oxlintrc.json', 'oxlint.config.ts', 'oxlint.config.mts', 'oxlint.config.js', 'oxlint.config.mjs']) {
      expect(detectLintCommand({ files: [file] })).toBe('npx oxlint')
    }
  })

  test('gibt nichts zurück, wenn kein Projekt-Signal da ist', () => {
    expect(detectLintCommand({ files: ['README.md'] })).toBeUndefined()
  })
})

describe('lintHintText', () => {
  test('nennt mit Befehl den Befehl und die Regel R1', () => {
    const text = lintHintText('npm run lint')

    expect(text).toContain('npm run lint')
    expect(text).toContain('Vor dem Abschluss')
  })

  test('ohne Befehl schlägt er eine Typprüfung und einen strengen Linter vor', () => {
    expect(lintHintText()).toContain('Kein Linter erkannt')
  })

  test('ohne Befehl nennt er oxlint mit dem Preset Ultracite und strict', () => {
    expect(lintHintText()).toContain('oxlint mit dem Preset Ultracite und strict')
  })

  test('verwendet keine Gedankenstriche', () => {
    expect(lintHintText('npm run lint').includes('—')).toBe(false)
    expect(lintHintText().includes('—')).toBe(false)
  })
})

describe('rulesSection', () => {
  test('enthält die Überschrift und die Regeln R1 bis R8', () => {
    const section = rulesSection(['zod'], '~/references')

    expect(section.startsWith('# Clean Code (Mod clean-code)')).toBe(true)
    for (const rule of ['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8']) {
      expect(section).toContain(`- ${rule} `)
    }
  })

  test('R4 nennt Referenzordner und node_modules', () => {
    expect(rulesSection(['zod'], '~/references')).toContain(
      '- R4 Bei Fragen zu einer Bibliothek zuerst den Quellcode im Referenzordner oder in node_modules lesen.',
    )
  })

  test('nennt die Referenzen mit dem Ordner', () => {
    expect(rulesSection(['effect', 'zod'], '~/references')).toContain('Referenzordner ~/references: effect, zod.')
  })

  test('bei leerem Referenzordner gibt er den Hinweis auf /ref-add', () => {
    expect(rulesSection([], '~/references')).toContain('Referenzordner leer, mit /ref-add <git-url> füllen.')
  })

  test('bleibt bei 100 Referenzen unter 1.200 Zeichen und kürzt mit „… und N weitere“', () => {
    const section = rulesSection(HUNDRED_REFS, '~/references')

    expect(section.length <= SECTION_LIMIT).toBe(true)
    expect(section).toContain('… und ')
    expect(section).toContain('weitere')
  })

  test('hält auch einen sehr langen Ordnernamen unter 1.200 Zeichen', () => {
    const section = rulesSection(['zod'], LONG_DIR)

    expect(section.length <= SECTION_LIMIT).toBe(true)
  })
})

describe('instructionGuardText', () => {
  test('nennt den Pfad und verweist auf R8', () => {
    const text = instructionGuardText('/repo/CLAUDE.md')

    expect(text).toContain('/repo/CLAUDE.md')
    expect(text).toContain('R8')
  })
})

describe('writtenPathsOf', () => {
  test('gibt den Pfad für Edit, Write und MultiEdit als Liste zurück', () => {
    expect(writtenPathsOf({ tool: 'Edit', file_path: '/repo/a.ts' })).toEqual(['/repo/a.ts'])
    expect(writtenPathsOf({ tool: 'Write', file_path: '/repo/b.md' })).toEqual(['/repo/b.md'])
    expect(writtenPathsOf({ tool: 'MultiEdit', file_path: '/repo/c.ts' })).toEqual(['/repo/c.ts'])
  })

  test('gibt eine leere Liste für andere Werkzeuge oder fehlenden Pfad', () => {
    expect(writtenPathsOf({ tool: 'Read', file_path: '/repo/a.ts' })).toEqual([])
    expect(writtenPathsOf({ tool: 'Edit', file_path: 42 })).toEqual([])
    expect(writtenPathsOf({ tool: 'Edit' })).toEqual([])
  })

  test('liest die Schreibziele eines Bash-Befehls', () => {
    expect(writtenPathsOf({ tool: 'Bash', command: 'echo x > CLAUDE.md && touch a.ts' })).toEqual(['CLAUDE.md', 'a.ts'])
    expect(writtenPathsOf({ tool: 'Bash', command: 'ls -la' })).toEqual([])
  })

  test('wirft nicht bei Bash ohne Befehlstext oder bei unbrauchbarer Eingabe', () => {
    expect(writtenPathsOf({ tool: 'Bash' })).toEqual([])
    expect(writtenPathsOf(null)).toEqual([])
  })
})

describe('strictHintText', () => {
  test('gibt nichts zurück, wenn keine tsconfig da ist', () => {
    expect(strictHintText(undefined)).toBeUndefined()
  })

  test('gibt nichts zurück, wenn strict aktiv ist', () => {
    expect(strictHintText('{"compilerOptions":{"strict":true}}')).toBeUndefined()
  })

  test('meldet strict auf false', () => {
    expect(strictHintText('{"compilerOptions":{"strict":false}}')).toContain('strict')
  })

  test('meldet eine tsconfig ohne strict-Eintrag', () => {
    expect(strictHintText('{"compilerOptions":{"target":"es2022"}}')).toContain('strict')
  })

  test('gibt nichts zurück, wenn strict über extends geerbt sein kann', () => {
    expect(strictHintText('{ "extends": "@tsconfig/strictest" }')).toBeUndefined()
  })

  test('erkennt strict auch in einer tsconfig mit Kommentaren', () => {
    expect(strictHintText('{\n  // streng\n  "compilerOptions": { "strict": true }\n}')).toBeUndefined()
  })
})

describe('directoryNames', () => {
  test('nimmt nur Ordner, sortiert und ohne die Eingabe zu verändern', () => {
    const entries = [
      { name: 'zod', kind: 'dir' as const },
      { name: 'README.md', kind: 'file' as const },
      { name: 'effect', kind: 'dir' as const },
    ]

    expect(directoryNames(entries)).toEqual(['effect', 'zod'])
    expect(entries[0]?.name).toBe('zod')
  })
})

describe('refsListText', () => {
  test('meldet einen fehlenden Ordner freundlich', () => {
    expect(refsListText(undefined, '~/references')).toContain('fehlt')
  })

  test('meldet einen leeren Ordner', () => {
    expect(refsListText([], '~/references')).toContain('ist leer')
  })

  test('listet die Namen als Liste', () => {
    expect(refsListText(['effect', 'zod'], '~/references')).toBe('Referenzordner ~/references:\n- effect\n- zod')
  })
})
