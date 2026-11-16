import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { table } from './agents.generated.js'
import { matchAgent } from './match.js'

interface ListEntry {
  pattern: string
  tags?: string[]
  instances?: string[]
}

const list: ListEntry[] = JSON.parse(
  readFileSync(new URL('../node_modules/crawler-user-agents/crawler-user-agents.json', import.meta.url), 'utf8'),
)

// The sample user agent pug's server tests hold for each row of the crawler table
// (internal/crawler/crawler_test.go), so both sides read them alike.
const samples: [string, string][] = [
  [
    'ChatGPT-User',
    'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot',
  ],
  [
    'Claude-User',
    'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Claude-User/1.0; +Claude-User@anthropic.com)',
  ],
  [
    'Perplexity-User',
    'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Perplexity-User/1.0; +https://perplexity.ai/perplexity-user)',
  ],
  [
    'MistralAI-User',
    'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; MistralAI-User/1.0; +https://docs.mistral.ai/robots)',
  ],
  [
    'Kimi-User',
    'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Kimi-User/1.0; +https://www.kimi.com/policies/kimi-crawlers)',
  ],
  ['DuckAssistBot', 'DuckAssistBot/1.2; (+http://duckduckgo.com/duckassistbot.html)'],
  [
    'Amzn-User',
    'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Amzn-User/0.1) Chrome/119.0.6045.214 Safari/537.36',
  ],
  [
    'meta-externalfetcher',
    'meta-externalfetcher/1.1 (+https://developers.facebook.com/docs/sharing/webmasters/crawler)',
  ],
  [
    'Google-Agent',
    'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.7390.122 Mobile Safari/537.36 (compatible; Google-Agent)',
  ],
  ['Google-GeminiNotebook', 'Google-GeminiNotebook'],
  [
    'Google-Read-Aloud',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.7390.122 Safari/537.36 (compatible; Google-Read-Aloud; +https://support.google.com/webmasters/answer/1061943)',
  ],
  [
    'OAI-SearchBot',
    'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot',
  ],
  [
    'Claude-SearchBot',
    'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Claude-SearchBot/1.0; +Claude-SearchBot@anthropic.com)',
  ],
  [
    'PerplexityBot',
    'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)',
  ],
  [
    'MistralAI-Index',
    'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; MistralAI-Index/1.0; +https://docs.mistral.ai/robots)',
  ],
  [
    'Kimi-SearchBot',
    'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Kimi-SearchBot/1.0; +https://www.kimi.com/policies/kimi-crawlers)',
  ],
  [
    'Amzn-SearchBot',
    'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Amzn-SearchBot/0.1) Chrome/119.0.6045.214 Safari/537.36',
  ],
  ['meta-webindexer', 'meta-webindexer/1.1 (+https://developers.facebook.com/docs/sharing/webmasters/crawler)'],
  ['Googlebot', 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'],
  ['bingbot', 'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)'],
  [
    'Applebot',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15 (Applebot/0.1; +http://www.apple.com/go/applebot)',
  ],
  ['Baiduspider', 'Mozilla/5.0 (compatible; Baiduspider/2.0; +http://www.baidu.com/search/spider.html)'],
  ['YouBot', 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; YouBot (+http://about.you.com/youbot))'],
  ['GPTBot', 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)'],
  [
    'ClaudeBot',
    'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)',
  ],
  ['meta-externalagent', 'meta-externalagent/1.1 (+https://developers.facebook.com/docs/sharing/webmasters/crawler)'],
  [
    'Amazonbot',
    'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Amazonbot/0.1; +https://developer.amazon.com/support/amazonbot) Chrome/119.0.6045.214 Safari/537.36',
  ],
  [
    'KimiBot',
    'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; KimiBot/1.0; +https://www.kimi.com/policies/kimi-crawlers)',
  ],
  ['CCBot', 'CCBot/2.0 (https://commoncrawl.org/faq/)'],
  [
    'Bytespider',
    'Mozilla/5.0 (Linux; Android 5.0) AppleWebKit/537.36 (KHTML, like Gecko) Mobile Safari/537.36 (compatible; Bytespider; spider-feedback@bytedance.com)',
  ],
  ['AI2Bot', 'Mozilla/5.0 (compatible) AI2Bot (+https://www.allenai.org/crawler)'],
  [
    'OAI-AdsBot',
    'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; OAI-AdsBot/1.0; +https://openai.com/adsbot',
  ],
  ['meta-externalads', 'meta-externalads/1.1 (+https://developers.facebook.com/docs/sharing/webmasters/crawler)'],
  [
    'GoogleOther',
    'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.7390.122 Mobile Safari/537.36 (compatible; GoogleOther)',
  ],
  [
    'Google-CloudVertexBot',
    'Mozilla/5.0 (compatible; Google-CloudVertexBot; +https://cloud.google.com/enterprise-search)',
  ],
]

describe('matchAgent', () => {
  it('names every row from its sample', () => {
    expect(samples.map(([name]) => name).sort()).toEqual(table.map(([name]) => name).sort())
    for (const [name, ua] of samples) {
      const row = table.find(([n]) => n === name)
      expect(matchAgent(ua), name).toEqual({ name, category: row?.[1] })
    }
  })

  it.each([
    ['a token inside a longer name', 'Googlebot-Image/1.0', 'Googlebot', 'search'],
    ['any case', 'mozilla/5.0 (compatible; gptbot/1.2)', 'GPTBot', 'training'],
    ["a row's second token", 'Mozilla/5.0 (compatible; Google-NotebookLM)', 'Google-GeminiNotebook', 'answers'],
    [
      'the longest token',
      'Mozilla/5.0 (compatible; Googlebot; Google-CloudVertexBot)',
      'Google-CloudVertexBot',
      'other',
    ],
    ['a table row over the list', 'Mozilla/5.0 (compatible; Amazonbot/0.1)', 'Amazonbot', 'training'],
    ['seo from the list', 'Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)', 'AhrefsBot', 'seo'],
    ['search from the list', 'Mozilla/5.0 (compatible; Google-InspectionTool/1.0;)', 'Google-InspectionTool', 'search'],
    ['a token within the first 512 bytes', `${'x'.repeat(500)} GPTBot/1.2`, 'GPTBot', 'training'],
    // When several list entries match, the server takes the earliest in the user agent, not the first listed.
    [
      'the list entry earliest in the user agent',
      'linkdexbot/Nutch-1.0-dev (http://www.linkdex.com/; crawl at linkdex dot com)',
      'linkdex',
      'seo',
    ],
    ['OICrawler over Nutch', 'OICrawler/Nutch https://openindex.ai', 'OICrawler', 'search'],
    [
      'YandexRenderResourcesBot over its bot page',
      'Mozilla/5.0 (compatible; YandexRenderResourcesBot/1.0; +http://yandex.com/bots) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0',
      'YandexRenderResourcesBot',
      'search',
    ],
    [
      's4a over its site',
      'Mozilla/5.0 AppleWebKit (compatible; s4a/1.0; +https://www.seo4ajax.com/webscraper)',
      's4a',
      'seo',
    ],
  ])('matches %s', (_, ua, name, category) => {
    expect(matchAgent(ua)).toEqual({ name, category })
  })

  it('matches every search-engine and seo entry of the list by its first example, as the server tests', () => {
    const missed = list
      .filter(e => e.instances?.length && (e.tags?.includes('search-engine') || e.tags?.includes('seo')))
      .filter(e => !matchAgent(e.instances?.[0] ?? ''))
      .map(e => e.pattern)
    expect(missed).toEqual([])
  })

  it.each([
    ['part of a word', 'NotGooglebot/1.0'],
    ["a list entry for a table agent's variant", 'Mozilla/5.0 (compatible; XGooglebot-Image/1.0)'],
    [
      'a browser',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
    ],
    ['an HTTP library', 'curl/8.4.0'],
    ['a monitor', 'Mozilla/5.0+(compatible; UptimeRobot/2.0; http://www.uptimerobot.com/)'],
    ['a link preview', 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)'],
    ['a token past the first 512 bytes', `${'x'.repeat(512)} GPTBot/1.2`],
    ['a token past the first 512 bytes of multibyte text', `${'é'.repeat(300)} GPTBot/1.2`],
    ['a word the 512-byte bound cuts', `${'x'.repeat(505)} GPTBotX`],
    ['nothing', ''],
  ])('ignores %s', (_, ua) => {
    expect(matchAgent(ua)).toBeUndefined()
  })
})
