# @pug-sh/crawlers

See which AI products, search engines and SEO tools read your site, and why: to
answer someone's question, to build a search index, or to train a model.

Crawlers fetch HTML and don't run JavaScript, so a browser analytics script never
sees them. This package runs in your site's own request handling instead. When a
request comes from a known crawler, it sends one small report to
[Pug](https://pug.sh) without delaying the response. Pug checks the request's IP
against the ranges the crawler's operator publishes, so a scraper borrowing
GPTBot's name reads as `failed` rather than `verified`.

It has no dependencies and runs on Cloudflare Workers, Vercel, Next.js, Hono,
Bun, Deno, Express and plain Node.

## Install

```sh
npm install @pug-sh/crawlers
```

You need a private key (`prv_...`) from your project's settings in Pug. Keep it
on the server, in an environment variable: it can also read your analytics.

## Cloudflare Workers

```ts
import { crawlers } from '@pug-sh/crawlers'

export default {
  async fetch(request, env, ctx) {
    const response = await env.ASSETS.fetch(request)
    crawlers({ apiKey: env.PUG_PRIVATE_KEY }).track(request, response, ctx)
    return response
  },
} satisfies ExportedHandler<Env>
```

Passing `ctx` lets the Worker finish the report after the response is sent.
Cloudflare serves a static asset without running the Worker, so turn on
`run_worker_first`, or crawlers' page fetches never reach `track`:

```jsonc
// wrangler.jsonc
{
  "assets": { "directory": "./dist", "binding": "ASSETS", "run_worker_first": true }
}
```

On Pages, track from `functions/_middleware.ts`: take the response from
`await context.next()` and pass `context` as the third argument.

## Hono, Bun and Deno

```ts
import { crawlers } from '@pug-sh/crawlers'

const pug = crawlers({ apiKey: process.env.PUG_PRIVATE_KEY })

app.use(async (c, next) => {
  await next()
  pug.track(c.req.raw, c.res)
})
```

On Cloudflare, create it inside the middleware from `c.env.PUG_PRIVATE_KEY`, and
pass `c.executionCtx` as the third argument. On Vercel, pass the `waitUntil` of
`@vercel/functions` as an option. Elsewhere, see
[the client's address](#the-clients-address).

## Next.js and Vercel

```ts
// proxy.ts
import { crawlers } from '@pug-sh/crawlers'
import { type NextFetchEvent, type NextRequest, NextResponse } from 'next/server'

const pug = crawlers({ apiKey: process.env.PUG_PRIVATE_KEY })

export function proxy(request: NextRequest, event: NextFetchEvent) {
  pug.track(request, undefined, event)
  return NextResponse.next()
}

export const config = {
  matcher: '/((?!_next/static|_next/image|favicon.ico).*)',
}
```

The proxy runs before the page, so these reports carry no status code. The
matcher keeps it off Next.js' own files.

## Express and node:http

```ts
import { crawlers } from '@pug-sh/crawlers'

app.use(crawlers({ apiKey: process.env.PUG_PRIVATE_KEY }).express())
```

The middleware reports once the response closes. With plain `node:http`, call
it at the start of your handler: `middleware(req, res)`. Behind a reverse proxy,
forward the public host (nginx: `proxy_set_header Host $host`), or reports name
the upstream. On serverless functions, pass your platform's `waitUntil` as an
option, such as the one from `@vercel/functions`, so the function lives until
the report is sent.

## Any other server

Report a request yourself with one POST, from any language:

```sh
curl https://api.pugs.dev/sdk.events.v1.EventsService/BatchCreate \
  -H 'x-api-key: prv_...' \
  -H 'content-type: application/json' \
  -d '{"events": [{"eventId": "0193b2c4-8f1e-7a2b-9c3d-4e5f6a7b8c9d", "occurTime": "2026-11-14T09:30:00Z",
       "kind": "crawler_request",
       "client": {"userAgent": "... GPTBot/1.2 ...", "ip": "20.171.207.5"},
       "autoProperties": {"$url": {"stringValue": "https://example.com/pricing"},
                          "$status_code": {"intValue": 200}}}]}'
```

One call takes up to 1000 events. Make `eventId` and `occurTime` once and resend
both unchanged on a retry, so Pug stores the request once. A 200 can still drop
an event: the response's `dropped`, `droppedByReason` and `invalidEvents` say
which and why.

## Options

| Option          | Default                | What it does                                                                       |
| --------------- | ---------------------- | ---------------------------------------------------------------------------------- |
| `apiKey`        | required               | A private key, `prv_...`. Without one, nothing is reported.                        |
| `endpoint`      | `https://api.pugs.dev` | Where Pug runs. A self-hosted install sets its own.                                |
| `categories`    | all five               | Which kinds of crawler to report: `answers`, `search`, `training`, `seo`, `other`. |
| `skip`          | none                   | Agents to leave out, by the name Pug shows, in any case, such as `['Googlebot']`.  |
| `includeAssets` | `false`                | Also report requests for scripts, styles, images, fonts and `/_next/` files.       |
| `getIP`         | the platform's         | Returns the crawler's address for a request, in place of the platform's.           |
| `waitUntil`     | none                   | Keeps a serverless function alive until a report is sent, when there's no `ctx`.   |

## The categories

| Category   | Meaning                                                   | Examples                                   |
| ---------- | --------------------------------------------------------- | ------------------------------------------ |
| `answers`  | Fetched live because a person asked an AI product         | ChatGPT-User, Claude-User, Perplexity-User |
| `search`   | Builds a search index that results and AI answers draw on | OAI-SearchBot, Googlebot, bingbot          |
| `training` | Collects pages to train models                            | GPTBot, ClaudeBot, CCBot                   |
| `seo`      | Crawls for an SEO tool                                    | AhrefsBot, SemrushBot, MJ12bot             |
| `other`    | AI-related, but none of the above                         | OAI-AdsBot, GoogleOther                    |

The AI agents and the major search engines come from Pug's own table, where
each has its company and, where the operator publishes them, its IP ranges.
Other search engines and SEO tools come from the
[crawler-user-agents](https://github.com/monperrus/crawler-user-agents) list and
get no IP check. The package bundles both, so a new crawler is reported once you
upgrade to a release that includes it.

## What it sends

Only requests whose user agent names a known crawler, so your visitors' requests
never leave your server. For each one it sends:

| Field              | Value                                                        |
| ------------------ | ------------------------------------------------------------ |
| `$url`             | The full URL, without its query string or fragment           |
| `client.userAgent` | The User-Agent header                                        |
| `client.ip`        | The client's address, for the IP check. Pug never stores it. |
| `$status_code`     | The response's status, when the adapter sees it              |

It never sends query strings, cookies, other headers, bodies, requests other
than GET and HEAD, or (unless `includeAssets` is on) scripts, styles, images,
fonts and Next.js' `/_next/` files.

## Delivery

One POST per crawler request, without delaying the response, with a 2-second
timeout and one retry on a network error, a 409 or a server error. It never
throws, so it can't break your site. It logs each kind of failure once per
process, including reports Pug drops, with the reason.

## The client's address

The package reads `CF-Connecting-IP` on Cloudflare Workers, `x-real-ip` on other
fetch-style servers (Vercel sets it), `req.ip` on Express (which follows its
`trust proxy` setting) and the socket on plain Node. It sends an address only
when it is a single IP. Pass `getIP` when that's wrong:

- **Behind a CDN**, your server sees the CDN's address, so every request reads
  `failed`. Read the CDN's client-IP header in `getIP`.
- **A fetch-style server that Vercel doesn't front** can't trust `x-real-ip`
  unless your own proxy sets it, since anyone can send it. Return the socket's
  address, such as `getIP: (req: Request) => server.requestIP(req)?.address` on
  Bun.

Running at the edge (Vercel, or Workers with `run_worker_first`) sees every
request, including those a CDN would answer from its cache.

## Volume

Crawler requests count toward your Pug usage like any event, and a busy site
can get more of them than page views. SEO tools are among the busiest crawlers,
so `seo` is the first category to leave out.

## License

MIT. The bundled crawler-user-agents entries are MIT too, © 2017 Martin
Monperrus.
