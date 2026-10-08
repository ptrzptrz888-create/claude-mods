/** Default location of the skill router; `~` is the home directory. */
export const DEFAULT_ROUTER_PATH = '~/.claude/skill-router/ROUTER.md'
const MAX_TABLE_CHARS = 6000

export const expandHome = (path: string, home: string | undefined) =>
  path.startsWith('~/') && home !== undefined ? `${home}${path.slice(1)}` : path

/**
 * Idea 6: the router's core list (the section headed "Kernliste") as the
 * analyser reads it; the whole file when it has no such section.
 */
export const coreTable = (markdown: string): string => {
  const start = markdown.search(/^##\s+Kernliste/m)
  if (start === -1) return markdown.slice(0, MAX_TABLE_CHARS)

  const rest = markdown.slice(start)
  const end = rest.slice(2).search(/^##\s/m)

  return (end === -1 ? rest : rest.slice(0, end + 2)).trim().slice(0, MAX_TABLE_CHARS)
}
