import { listed, table } from './agents.generated.js'

export const categories = ['answers', 'search', 'training', 'seo', 'other'] as const

/** Why a crawler fetches a page. */
export type Category = (typeof categories)[number]

// The server reads only this much of a user agent.
const maxUserAgentBytes = 512

const encoder = new TextEncoder()

let compiled: (readonly [string, Category, RegExp])[] | undefined

const isWord = (c: number) => (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95

function containsWord(s: string, token: string): boolean {
  for (let from = 0; ; ) {
    const i = s.indexOf(token, from)
    if (i < 0) return false
    const end = i + token.length
    if ((i === 0 || !isWord(s.charCodeAt(i - 1))) && (end === s.length || !isWord(s.charCodeAt(end)))) return true
    from = i + 1
  }
}

// Cut at a whole character, so the server never sees a partial one.
export function truncate(s: string, bytes: number): string {
  const { read } = encoder.encodeInto(s, new Uint8Array(bytes))
  return read === s.length ? s : s.slice(0, read)
}

/**
 * The crawler a user agent belongs to, as the server picks it: the table row whose token it holds as
 * a whole word, any case, the longest token winning, or else the crawler-user-agents search-engine or
 * seo entry that matches earliest in it, the first listed winning a tie. The server has the last word.
 */
export function matchAgent(userAgent: string): { name: string; category: Category } | undefined {
  let cut = truncate(userAgent, maxUserAgentBytes).length
  // Drop the word the bound cuts, as the server does, or "GPTBotX" cut after its T reads as GPTBot.
  if (cut < userAgent.length) while (cut > 0 && isWord(userAgent.charCodeAt(cut))) cut--
  const head = userAgent.slice(0, cut)
  const lower = head.toLowerCase()
  let best: { name: string; category: Category } | undefined
  let bestLength = 0
  for (const [name, category, ...tokens] of table) {
    for (const token of tokens) {
      if (token.length > bestLength && containsWord(lower, token)) {
        best = { name, category }
        bestLength = token.length
      }
    }
  }
  if (best) return best
  compiled ??= listed.map(([name, category, pattern]) => [name, category, new RegExp(pattern)] as const)
  let at = Number.POSITIVE_INFINITY
  for (const [name, category, re] of compiled) {
    const i = head.search(re)
    if (i >= 0 && i < at) {
      best = { name, category }
      at = i
    }
  }
  return best
}
