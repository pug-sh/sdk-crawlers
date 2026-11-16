import { type Category, categories, matchAgent, truncate } from './match.js'

const defaultEndpoint = 'https://api.pugs.dev'
const procedure = '/sdk.events.v1.EventsService/BatchCreate'
const timeoutMs = 2000
// The server's limits: $url in characters, a user agent in bytes.
const maxURLLength = 1024
const maxUserAgentBytes = 2048
// Framework internals, scripts, styles, images and fonts: crawlers fetch them too, which adds volume and no insight.
const asset = /^\/_next\/|\.(?:js|mjs|cjs|css|map|png|jpe?g|gif|svg|ico|webp|avif|bmp|tiff?|woff2?|ttf|otf|eot)$/i
const ipv4 = /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/

/** A request as Express or node:http hands it over. */
export interface NodeRequest {
  method?: string | undefined
  url?: string | undefined
  originalUrl?: string | undefined
  protocol?: string | undefined
  ip?: string | undefined
  headers: Record<string, string | string[] | undefined>
  socket?: { remoteAddress?: string | undefined; encrypted?: boolean | undefined } | undefined
}

/** A response as Express or node:http hands it over: the report goes once it closes. */
export interface NodeResponse {
  statusCode: number
  writableFinished?: boolean | undefined
  once(event: 'close', listener: () => void): unknown
}

/** What keeps a platform running until the report is sent: Workers' ctx, Next.js' event. */
export interface WaitUntil {
  waitUntil(promise: Promise<unknown>): void
}

export interface CrawlersOptions {
  /** A private (prv_) key; without one nothing is reported. A public key won't do: it ships inside web pages. */
  apiKey: string | undefined
  /** Where pug runs. Defaults to https://api.pugs.dev; a self-hosted install sets its own. */
  endpoint?: string | undefined
  /** The categories to report. Defaults to all five; SEO tools are among the busiest crawlers. */
  categories?: readonly Category[] | undefined
  /** Agents to leave out, by the name pug shows, in any case, such as 'Googlebot'. */
  skip?: readonly string[] | undefined
  /** Report requests for scripts, styles, images, fonts and /_next/ too. */
  includeAssets?: boolean | undefined
  /** Replaces the platform's client address, such as with a CDN's client-IP header. Return a single IP. */
  getIP?(request: Request | NodeRequest): string | null | undefined
  /** Keeps a serverless function alive until a report is sent, such as Vercel's waitUntil. A ctx wins. */
  waitUntil?(promise: Promise<unknown>): void
}

export interface Crawlers {
  /**
   * Fetch-style servers: Cloudflare Workers, Hono, Bun, Deno. Pass the response to report its
   * status, and the platform's ctx so it waits for the report. A Next.js proxy has no response yet.
   */
  track(request: Request, response?: Response, ctx?: WaitUntil): void
  /** Express or node:http middleware. It reports once the response closes. */
  express(): (req: NodeRequest, res: NodeResponse, next?: (err?: unknown) => void) => void
}

interface Report {
  eventId: string
  occurTime: string
  url: string
  userAgent: string
}

interface BatchResult {
  dropped?: number
  droppedByReason?: Record<string, number>
  invalidEvents?: { violations?: string[] }[]
}

const warned = new Set<string>()

function warnOnce(kind: string, message: string, detail?: unknown): void {
  if (warned.has(kind)) return
  warned.add(kind)
  // A detail that can't be printed, or a console that throws, mustn't break the site.
  try {
    console.warn(`@pug-sh/crawlers: ${message}${detail === undefined ? '' : ` (${String(detail)})`}`)
  } catch {}
}

/**
 * Reports requests from known crawlers to pug: one POST per request, without delaying the response.
 * People's requests never leave the site, and neither do query strings, cookies or other headers. It
 * never throws, so it can't break the site it runs in.
 */
export function crawlers(options: CrawlersOptions): Crawlers {
  try {
    return collector(options)
  } catch (err) {
    warnOnce('options', 'invalid options, so nothing is reported', err)
    return { track() {}, express: () => (_req, _res, next) => next?.() }
  }
}

function collector(options: CrawlersOptions): Crawlers {
  const apiKey = typeof options.apiKey === 'string' ? options.apiKey : ''
  const usable = apiKey.startsWith('prv_')
  if (!usable) warnOnce('apiKey', 'apiKey must be a private key (prv_...), so nothing is reported')
  const base = String(options.endpoint || defaultEndpoint).replace(/\/+$/, '')
  if (!/^https?:\/\/[^/]/.test(base)) throw new TypeError(`endpoint must be an http(s) URL, not '${base}'`)
  const endpoint = base + procedure
  const wanted = new Set<Category>(options.categories ?? categories)
  for (const category of wanted) {
    if (!categories.includes(category)) throw new TypeError(`unknown category '${category}'`)
  }
  const skip = new Set((options.skip ?? []).map(name => name.toLowerCase()))

  const describe = (method: string, href: string, userAgent: string | null | undefined): Report | undefined => {
    if (!usable || !userAgent) return undefined
    method = method.toUpperCase()
    if (method !== 'GET' && method !== 'HEAD') return undefined
    let page: URL
    try {
      page = new URL(href)
    } catch {
      return undefined
    }
    if (page.protocol !== 'http:' && page.protocol !== 'https:') return undefined
    if (!options.includeAssets && asset.test(page.pathname)) return undefined
    const url = page.origin + page.pathname
    if (url.length > maxURLLength) return undefined
    const agent = matchAgent(userAgent)
    if (!agent || !wanted.has(agent.category) || skip.has(agent.name.toLowerCase())) return undefined
    return {
      eventId: crypto.randomUUID(),
      occurTime: new Date().toISOString(),
      url,
      userAgent: truncate(userAgent, maxUserAgentBytes),
    }
  }

  const clientIP = (request: Request | NodeRequest, platform: string | null | undefined): string | undefined => {
    let ip: unknown = platform
    if (options.getIP) {
      try {
        ip = options.getIP(request)
      } catch (err) {
        warnOnce('getIP', 'getIP threw, so reports go without an address', err)
        return undefined
      }
    }
    if (ip == null || ip === '') return undefined
    if (typeof ip === 'string' && isIP(ip)) return ip
    warnOnce('ip', "the client's address isn't a single IP, so reports go without one")
    return undefined
  }

  return {
    track(request, response, ctx) {
      try {
        const report = describe(request.method, request.url, request.headers.get('user-agent'))
        if (!report) return
        // Only Workers' requests have cf, and there CF-Connecting-IP can't be forged; Vercel sets x-real-ip.
        const platform = 'cf' in request ? request.headers.get('cf-connecting-ip') : request.headers.get('x-real-ip')
        const sending = send(endpoint, apiKey, report, clientIP(request, platform), () => response?.status)
        if (ctx) ctx.waitUntil(sending)
        else options.waitUntil?.(sending)
      } catch (err) {
        warnOnce('error', 'could not report a request', err)
      }
    },

    express() {
      return (req, res, next) => {
        try {
          const path = req.originalUrl ?? req.url ?? '/'
          const host = first(req.headers.host) ?? first(req.headers[':authority'])
          const protocol = req.protocol ?? (req.socket?.encrypted ? 'https' : 'http')
          // A target that isn't a path is already a full URL, as a request through a proxy sends it.
          const href = path.startsWith('/') ? host && `${protocol}://${host}${path}` : path
          const report = href && describe(req.method ?? 'GET', href, first(req.headers['user-agent']))
          if (report) {
            const ip = clientIP(req, req.ip ?? req.socket?.remoteAddress)
            const status = () => (res.writableFinished ? res.statusCode : undefined)
            const sending = new Promise<void>(resolve =>
              res.once('close', () => resolve(send(endpoint, apiKey, report, ip, status))),
            ).catch(err => warnOnce('error', 'could not report a request', err))
            options.waitUntil?.(sending)
          }
        } catch (err) {
          warnOnce('error', 'could not report a request', err)
        }
        next?.()
      }
    },
  }
}

// One POST, with one retry on a network error, the timeout, a 409 or a 5xx. The retry resends the same
// body, so pug stores the request once. It never rejects: nothing awaits it on Bun or Node.
async function send(
  endpoint: string,
  apiKey: string,
  report: Report,
  ip: string | undefined,
  status: () => number | undefined,
): Promise<void> {
  try {
    const statusCode = status()
    const body = JSON.stringify({
      events: [
        {
          eventId: report.eventId,
          occurTime: report.occurTime,
          kind: 'crawler_request',
          client: { userAgent: report.userAgent, ...(ip ? { ip } : {}) },
          autoProperties: {
            $url: { stringValue: report.url },
            ...(statusCode ? { $status_code: { intValue: statusCode } } : {}),
          },
        },
      ],
    })
    let failure: unknown
    for (let attempt = 0; attempt < 2; attempt++) {
      let res: Response
      try {
        res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-api-key': apiKey },
          body,
          redirect: 'error',
          signal: AbortSignal.timeout(timeoutMs),
        })
      } catch (err) {
        failure = err instanceof Error && err.cause ? err.cause : err
        continue
      }
      if (res.ok) {
        warnDropped((await res.json().catch(() => null)) as BatchResult | null)
        return
      }
      failure = `${res.status}: ${await reason(res)}`
      if (res.status < 500 && res.status !== 409) {
        warnOnce('refused', 'pug refused a report', failure)
        return
      }
    }
    warnOnce('undelivered', `could not deliver reports to ${endpoint}`, failure)
  } catch (err) {
    warnOnce('error', 'could not report a request', err)
  }
}

// A 200 can still drop the event, as when it breaks a rule or names no crawler the server knows.
function warnDropped(result: BatchResult | null): void {
  if (!result?.dropped) return
  warnOnce(
    'dropped',
    'pug dropped a report',
    result.invalidEvents?.[0]?.violations ?? Object.keys(result.droppedByReason ?? {}),
  )
}

async function reason(res: Response): Promise<string> {
  try {
    return (JSON.parse(await res.text()) as { message?: string }).message ?? res.statusText
  } catch {
    return res.statusText
  }
}

function isIP(value: string): boolean {
  if (ipv4.test(value)) return true
  if (!value.includes(':') || !/^[\da-f:.]+$/i.test(value)) return false
  // URL's IPv6 parser, since edge runtimes have no node:net.
  try {
    new URL(`http://[${value}]`)
    return true
  } catch {
    return false
  }
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}
