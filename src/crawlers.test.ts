import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CrawlersOptions, NodeRequest, NodeResponse } from './crawlers.js'

const gptBot = 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)'
const chatGPTUser =
  'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot'
const browser =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'
const endpoint = 'https://api.pugs.dev/sdk.events.v1.EventsService/BatchCreate'

let fetchMock: ReturnType<typeof vi.fn>
let warn: ReturnType<typeof vi.spyOn>

// A fresh module per test, since the collector warns once per process.
async function collector(options: Partial<CrawlersOptions> = {}) {
  vi.resetModules()
  const { crawlers } = await import('./crawlers.js')
  return crawlers({ apiKey: 'prv_test', ...options })
}

function request(url: string, ua: string, init: RequestInit & { headers?: Record<string, string> } = {}) {
  return new Request(url, { ...init, headers: { 'user-agent': ua, ...init.headers } })
}

// Runs track and waits for its report, as the platform would through waitUntil.
async function track(c: Awaited<ReturnType<typeof collector>>, req: Request, res?: Response) {
  const pending: Promise<unknown>[] = []
  c.track(req, res, { waitUntil: p => pending.push(p) })
  await Promise.all(pending)
  return pending.length
}

function sent(call = 0) {
  const [url, init] = fetchMock.mock.calls[call] as [string, RequestInit]
  return { url, init, event: JSON.parse(init.body as string).events[0] }
}

function reply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status })
}

beforeEach(() => {
  fetchMock = vi.fn(async () => reply({ accepted: 1 }))
  vi.stubGlobal('fetch', fetchMock)
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('track', () => {
  it('reports a crawler request as a crawler_request event, without its query string', async () => {
    const c = await collector()
    const req = request('https://example.com/pricing?plan=pro#faq', gptBot, {
      headers: { 'x-real-ip': '20.171.207.5', cookie: 'session=secret' },
    })
    expect(await track(c, req, new Response('missing', { status: 404 }))).toBe(1)

    const { url, init, event } = sent()
    expect(url).toBe(endpoint)
    expect(init).toMatchObject({
      method: 'POST',
      redirect: 'error',
      headers: { 'content-type': 'application/json', 'x-api-key': 'prv_test' },
    })
    expect(event).toEqual({
      eventId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      occurTime: expect.stringMatching(/^\d{4}-\d\d-\d\dT/),
      kind: 'crawler_request',
      client: { userAgent: gptBot, ip: '20.171.207.5' },
      autoProperties: { $url: { stringValue: 'https://example.com/pricing' }, $status_code: { intValue: '404' } },
    })
  })

  it('reads CF-Connecting-IP only on Workers, x-real-ip elsewhere, and getIP over both', async () => {
    const headers = { 'cf-connecting-ip': '20.171.207.5', 'x-real-ip': '2600:1f28::1' }
    const c = await collector()
    await track(c, request('https://example.com/', gptBot, { headers }))
    expect(sent(0).event.client.ip).toBe('2600:1f28::1')
    await track(c, Object.assign(request('https://example.com/', gptBot, { headers }), { cf: {} }))
    expect(sent(1).event.client.ip).toBe('20.171.207.5')

    const custom = await collector({ getIP: () => '20.171.207.9' })
    await track(custom, request('https://example.com/', gptBot, { headers }))
    expect(sent(2).event.client.ip).toBe('20.171.207.9')
  })

  it.each(['1.2.3.4, 5.6.7.8', '20.171.207.5:443', '1.2.3', 'dead', '::1]/x['])(
    'sends no address for %s, and says so',
    async ip => {
      const c = await collector({ getIP: () => ip })
      await track(c, request('https://example.com/', gptBot))
      expect(sent().event.client).toEqual({ userAgent: gptBot })
      expect(sent().event.autoProperties).not.toHaveProperty('$status_code')
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('single IP'))
    },
  )

  it('still reports when getIP throws', async () => {
    const c = await collector({
      getIP: () => {
        throw new Error('boom')
      },
    })
    await track(c, request('https://example.com/', gptBot))
    expect(sent().event.client).toEqual({ userAgent: gptBot })
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('getIP threw'))
  })

  it('sends without a ctx, as on Bun or Deno', async () => {
    const c = await collector()
    c.track(request('https://example.com/', gptBot))
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
  })

  it('hands the report to the waitUntil option when there is no ctx', async () => {
    const pending: Promise<unknown>[] = []
    const c = await collector({ waitUntil: p => pending.push(p) })
    c.track(request('https://example.com/', gptBot))
    expect(pending).toHaveLength(1)
    await Promise.all(pending)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['a browser', request('https://example.com/', browser)],
    ['no user agent', new Request('https://example.com/')],
    ['a POST', request('https://example.com/', gptBot, { method: 'POST', body: 'x' })],
    ['a script', request('https://example.com/app.js', gptBot)],
    ['a script in capitals', request('https://example.com/APP.JS', gptBot)],
    ['a font', request('https://example.com/fonts/inter.woff2', gptBot)],
    ['a Next.js image', request('https://example.com/_next/image?url=%2Fa.png&w=640', 'Googlebot-Image/1.0')],
    ['a URL longer than pug takes', request(`https://example.com/${'a'.repeat(1100)}`, gptBot)],
  ])('ignores %s', async (_, req) => {
    const c = await collector()
    expect(await track(c, req)).toBe(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reports HEAD requests, other files and, with includeAssets, static files', async () => {
    const c = await collector()
    expect(await track(c, request('https://example.com/feed.json', gptBot, { method: 'HEAD' }))).toBe(1)
    const assets = await collector({ includeAssets: true })
    await track(assets, request('https://example.com/app.js', gptBot))
    expect(sent(1).event.autoProperties.$url.stringValue).toBe('https://example.com/app.js')
  })

  it('reports every category by default, and only the chosen ones, less skipped agents', async () => {
    const all = await collector()
    for (const ua of [
      gptBot,
      chatGPTUser,
      'Mozilla/5.0 (compatible; Googlebot/2.1)',
      'Mozilla/5.0 (compatible; AhrefsBot/7.0)',
      'Mozilla/5.0 (compatible; GoogleOther)',
    ]) {
      expect(await track(all, request('https://example.com/', ua)), ua).toBe(1)
    }
    fetchMock.mockClear()

    const answers = await collector({ categories: ['answers'] })
    await track(answers, request('https://example.com/', gptBot))
    expect(fetchMock).not.toHaveBeenCalled()
    await track(answers, request('https://example.com/', chatGPTUser))
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const skipping = await collector({ skip: ['gptbot'] })
    await track(skipping, request('https://example.com/', gptBot))
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('sends to a self-hosted endpoint, or the default for an empty one', async () => {
    const c = await collector({ endpoint: 'https://pug.example.com/' })
    await track(c, request('https://example.com/', gptBot))
    expect(sent(0).url).toBe('https://pug.example.com/sdk.events.v1.EventsService/BatchCreate')
    const empty = await collector({ endpoint: '' })
    await track(empty, request('https://example.com/', gptBot))
    expect(sent(1).url).toBe(endpoint)
  })

  it('cuts a long user agent at a whole character', async () => {
    const c = await collector()
    await track(c, request('https://example.com/', `GPTBot/1.2 ${'é'.repeat(3000)}`))
    const ua: string = sent().event.client.userAgent
    expect(new TextEncoder().encode(ua).length).toBeLessThanOrEqual(2048)
    expect(ua.endsWith('é')).toBe(true)
  })

  it('reports nothing with a public key or none, and says so once', async () => {
    const c = await collector({ apiKey: 'pub_test' })
    await track(c, request('https://example.com/', gptBot))
    await track(c, request('https://example.com/', gptBot))
    const none = await collector({ apiKey: undefined })
    await track(none, request('https://example.com/', gptBot))
    expect(fetchMock).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledTimes(2)
    expect(warn).toHaveBeenLastCalledWith(expect.stringContaining('private key'))
  })

  it.each([
    ['an endpoint without a scheme', { endpoint: 'pug.example.com' }],
    ['an unknown category', { categories: ['answer'] }],
    ['skip as a string', { skip: 'Googlebot' }],
  ])('reports nothing with %s, and says so', async (_, options) => {
    const c = await collector(options as Partial<CrawlersOptions>)
    await track(c, request('https://example.com/', gptBot))
    const next = vi.fn()
    c.express()({ headers: {} }, Object.assign(new EventEmitter(), { statusCode: 200 }), next)
    expect(next).toHaveBeenCalledTimes(1)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('invalid options'))
  })

  it('never throws', async () => {
    const c = await collector()
    const broken = {
      method: 'GET',
      url: 'https://example.com/',
      headers: {
        get: () => {
          throw new Error('boom')
        },
      },
    }
    expect(() => c.track(broken as unknown as Request)).not.toThrow()
    fetchMock.mockImplementation(() => {
      throw new TypeError('fetch failed')
    })
    await track(c, request('https://example.com/', gptBot))
    expect(warn).toHaveBeenCalledTimes(2)
  })

  it('survives a console that throws', async () => {
    warn.mockImplementation(() => {
      throw new Error('console is broken')
    })
    const misconfigured = await collector({ endpoint: 'pug.example.com' })
    expect(() => misconfigured.track(request('https://example.com/', gptBot))).not.toThrow()
    fetchMock.mockRejectedValue(new TypeError('fetch failed'))
    await track(await collector(), request('https://example.com/', gptBot))
  })

  it("survives errors it can't print", async () => {
    const unprintable = Object.create(null)
    const c = await collector({
      getIP: () => {
        throw unprintable
      },
    })
    await track(c, request('https://example.com/', gptBot))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    fetchMock.mockRejectedValue(new TypeError('fetch failed', { cause: unprintable }))
    await track(c, request('https://example.com/', gptBot))
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('survives a response whose status throws', async () => {
    const c = await collector()
    const res = Object.defineProperty(new Response(), 'status', {
      get() {
        throw new Error('boom')
      },
    })
    await track(c, request('https://example.com/', gptBot), res)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('could not report'))
  })
})

describe('delivery', () => {
  it('retries a 5xx once with the same body', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 503 }))
    const c = await collector()
    await track(c, request('https://example.com/', gptBot))
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(sent(1).init.body).toBe(sent(0).init.body)
    expect(warn).not.toHaveBeenCalled()
  })

  it('retries a 409, since the first try may still be in flight', async () => {
    fetchMock.mockResolvedValueOnce(reply({ code: 'aborted', message: 'an identical batch is still in flight' }, 409))
    const c = await collector()
    await track(c, request('https://example.com/', gptBot))
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(warn).not.toHaveBeenCalled()
  })

  it('retries a network error once, then warns once with its cause', async () => {
    fetchMock.mockRejectedValue(
      new TypeError('fetch failed', { cause: new Error('getaddrinfo ENOTFOUND api.pugs.dev') }),
    )
    const c = await collector()
    await track(c, request('https://example.com/', gptBot))
    await track(c, request('https://example.com/', gptBot))
    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('ENOTFOUND'))
  })

  it("doesn't retry a refusal, and says why", async () => {
    fetchMock.mockResolvedValue(reply({ code: 'unauthenticated', message: 'a private API key is required' }, 401))
    const c = await collector()
    await track(c, request('https://example.com/', gptBot))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('a private API key is required'))
  })

  it('warns once for each kind of failure', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed')).mockRejectedValueOnce(new TypeError('fetch failed'))
    const c = await collector()
    await track(c, request('https://example.com/', gptBot))
    fetchMock.mockResolvedValue(reply({ message: 'a private API key is required' }, 401))
    await track(c, request('https://example.com/', gptBot))
    expect(warn).toHaveBeenCalledTimes(2)
  })

  it.each([
    [
      'the rule it broke',
      { dropped: 1, droppedByReason: { invalid_event: 1 }, invalidEvents: [{ violations: ['client.ip: bad'] }] },
      'client.ip: bad',
    ],
    ['the reason', { dropped: 1, droppedByReason: { unknown_agent: 1 } }, 'unknown_agent'],
  ])('says why pug dropped a report: %s', async (_, body, why) => {
    fetchMock.mockResolvedValue(reply(body))
    const c = await collector()
    await track(c, request('https://example.com/', gptBot))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(why))
  })

  it('gives up after two 2-second timeouts', async () => {
    const timeout = vi
      .spyOn(AbortSignal, 'timeout')
      .mockImplementation(() => AbortSignal.abort(new DOMException('timed out', 'TimeoutError')))
    fetchMock.mockImplementation(async (_: string, init: RequestInit) => {
      init.signal?.throwIfAborted()
      return reply({ accepted: 1 })
    })
    const c = await collector()
    await track(c, request('https://example.com/', gptBot))
    expect(timeout.mock.calls).toEqual([[2000], [2000]])
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['not JSON', () => new Response('<html>')],
    ['an odd shape', () => reply({ dropped: 1, invalidEvents: [{ violations: 'odd' }] })],
  ])("doesn't retry a 200 with %s", async (_, response) => {
    fetchMock.mockResolvedValue(response())
    const c = await collector()
    await track(c, request('https://example.com/', gptBot))
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('express', () => {
  function nodeRequest(overrides: Partial<NodeRequest> = {}): NodeRequest {
    return {
      method: 'GET',
      url: '/pricing?plan=pro',
      headers: { host: 'example.com', 'user-agent': gptBot },
      socket: { remoteAddress: '20.171.207.5' },
      ...overrides,
    }
  }
  const response = () => Object.assign(new EventEmitter(), { statusCode: 200, writableFinished: false })
  function finish(res: ReturnType<typeof response>, statusCode = 200) {
    res.statusCode = statusCode
    res.writableFinished = true
    res.emit('close')
  }

  it('reports once the response closes', async () => {
    const c = await collector()
    const res = response()
    const next = vi.fn()
    c.express()(
      nodeRequest({ originalUrl: '/blog/post?ref=x', protocol: 'https', ip: '::ffff:20.171.207.5' }),
      res,
      next,
    )
    expect(next).toHaveBeenCalledTimes(1)
    expect(fetchMock).not.toHaveBeenCalled()

    finish(res, 301)
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(sent().event).toMatchObject({
      client: { ip: '::ffff:20.171.207.5' },
      autoProperties: { $url: { stringValue: 'https://example.com/blog/post' }, $status_code: { intValue: '301' } },
    })
  })

  it('reports a response the crawler abandoned, without a status', async () => {
    const c = await collector()
    const res = response()
    c.express()(nodeRequest(), res)
    res.emit('close')
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(sent().event.autoProperties).toEqual({ $url: { stringValue: 'http://example.com/pricing' } })
  })

  it.each([
    ['node:http, which has no protocol or ip', nodeRequest(), 'http://example.com/pricing'],
    ['a TLS socket', nodeRequest({ socket: { encrypted: true } }), 'https://example.com/pricing'],
    [
      "HTTP/2's :authority",
      nodeRequest({ headers: { ':authority': 'example.com', 'user-agent': gptBot } }),
      'http://example.com/pricing',
    ],
    ['a full URL as the target', nodeRequest({ url: 'http://example.com/pricing?x=1' }), 'http://example.com/pricing'],
  ])('reads %s', async (_, req, url) => {
    const c = await collector()
    const res = response()
    c.express()(req, res)
    finish(res)
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(sent().event.autoProperties.$url.stringValue).toBe(url)
  })

  it('uses getIP and the waitUntil option', async () => {
    const pending: Promise<unknown>[] = []
    const getIP = vi.fn((req: Request | NodeRequest) => (req as NodeRequest).headers['x-client-ip'] as string)
    const c = await collector({ getIP, waitUntil: p => pending.push(p) })
    const req = nodeRequest({ headers: { host: 'example.com', 'user-agent': gptBot, 'x-client-ip': '20.171.207.9' } })
    const res = response()
    c.express()(req, res)
    expect(pending).toHaveLength(1)
    finish(res)
    await Promise.all(pending)
    expect(getIP).toHaveBeenCalledWith(req)
    expect(sent().event.client.ip).toBe('20.171.207.9')
  })

  it.each([
    ['a browser', nodeRequest({ headers: { host: 'example.com', 'user-agent': browser } })],
    ['a request without a Host', nodeRequest({ headers: { 'user-agent': gptBot } })],
  ])('passes %s through untouched', async (_, req) => {
    const c = await collector()
    const res = response()
    const next = vi.fn()
    c.express()(req, res, next)
    finish(res)
    expect(next).toHaveBeenCalledTimes(1)
    expect(res.listenerCount('close')).toBe(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('always calls next', async () => {
    const c = await collector()
    const next = vi.fn()
    const broken = {
      get method(): string {
        throw new Error('boom')
      },
      headers: { host: 'example.com', 'user-agent': gptBot },
    }
    c.express()(broken as unknown as NodeRequest, response(), next)
    expect(next).toHaveBeenCalledTimes(1)
  })

  it('survives a response without once, or whose status throws', async () => {
    const c = await collector()
    const next = vi.fn()
    c.express()(nodeRequest(), { statusCode: 200 } as unknown as NodeResponse, next)
    const res = Object.defineProperty(response(), 'statusCode', {
      get() {
        throw new Error('boom')
      },
    })
    c.express()(nodeRequest(), res, next)
    res.writableFinished = true
    expect(() => res.emit('close')).not.toThrow()
    expect(next).toHaveBeenCalledTimes(2)
    await vi.waitFor(() => expect(warn).toHaveBeenCalledWith(expect.stringContaining('could not report')))
  })
})
