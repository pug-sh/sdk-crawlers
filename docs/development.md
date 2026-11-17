# Development

Internal guide for working on `sdk-crawlers`. End-user docs live in the [README](../README.md);
the design is pug's `docs/architecture/ai-crawlers.md`.

## Toolchain

bun (packages and scripts), biome (format), tsc (types and `dist/`), vitest (tests), knip (unused
code), and the [buf CLI](https://buf.build/docs/installation) for `make codegen`, which also runs
protoc-gen-es from `node_modules`, so `bun install` first. The package has no runtime dependencies,
and must keep none: it runs inside customers' edge functions.

## Generated code

The protos are vendored under `proto/` from the Buf Schema Registry commit the Makefile pins, and
`make codegen` rebuilds three things from them; don't edit those.

**The agent list**, `src/agents.generated.ts`, from:

- **The crawler table**: pug's `proto/common/crawlers/v1`. `buf build` turns it into a descriptor
  set whose options read as plain JSON, so the generator needs no protobuf runtime. Rows marked
  `deprecated` are left out, as the server leaves them out.
- **crawler-user-agents**: its `search-engine` and `seo` entries, at the exact version in
  `package.json`. Keep that version equal to the one pug's `go.mod` pins: the server matches with
  the Go module of the same list, and a version ahead of it sends agents the server drops.

**The procedure and limits**, `src/events.generated.ts`: the path of `BatchCreate`, and the
`buf.validate` limits on the two fields a report fills from a site's request, an auto property's
`string_value` and the client's `user_agent`, found through `BatchCreate`'s types in the same
descriptor set. A renamed rpc, or any change to those fields' rules but the limits' values, fails
the generator: the package can't tell whether its reports still keep them.

**The JSON types**, `src/gen`: protobuf-es declarations for `sdk/events/v1` and
`common/v1/property_value.proto`. `src/crawlers.ts` checks the report it sends against them, and
reads the response through them, unchecked. It imports them as types only, so they never reach
`dist/`, and a field renamed upstream fails `tsc`. `tsconfig.json` keeps `skipLibCheck` off: with it
on, a file `src/gen` imports but `buf.gen.yaml` doesn't generate would turn its types into `any`
without an error. They type an `int64` as a string, its canonical JSON form, so `$status_code` goes
as `"404"`.

| Command                | What it does                                                           |
| ---------------------- | ---------------------------------------------------------------------- |
| `make codegen`         | Regenerate all three. Pass `BUF=` for a buf that isn't on `PATH`.      |
| `make sync-protos`     | Re-vendor `proto/` from `PROTO_COMMIT`. Needs BSR network.             |
| `make proto-latest`    | Print the newest commit of `buf.build/pugsh/pug` on main.              |
| `make check-proto-pin` | Fail if `proto/` differs from `PROTO_COMMIT`. The release gate.        |
| `make ci`              | Regenerate, fail on drift, then lint, typecheck, knip, test and build. |

To take a proto change: bump `PROTO_COMMIT` in the `Makefile`, run `make sync-protos codegen`, and
commit `proto/` with the generated files. Codegen doesn't cover what `IncomingEvent`'s rules ask of
a `crawler_request`, its `kind`, `client` and `$url`, which `src/crawlers.ts` writes by hand, so
check them in the `proto/` diff.

## Matching

`src/match.ts` mirrors pug's `internal/crawler`, over the first 512 bytes of the user agent less
any word that bound cuts. A table token matches as a whole word, any case, the longest winning.
Otherwise the list entry whose pattern matches earliest in the user agent wins, the first listed
on a tie. The generator drops list entries whose name holds a table token, as the server skips
them, so `NotGooglebot` matches nothing. The server matches again and has the last word; the
package only decides what to send. `src/match.test.ts` holds the server's sample user agent for
every table row.

## Releasing

Bump `version` in `package.json`, commit as `Release vX.Y.Z`, then tag `vX.Y.Z` and push the commit
and the tag. The tag runs `.github/workflows/release.yml`: it checks that the tag names
`package.json`'s version, runs `make check-proto-pin ci`, packs, and publishes that tarball to npm
through trusted publishing, with provenance.

One-time setup: npmjs.com → `@pug-sh/crawlers` → Settings → **Trusted publishing** → GitHub Actions,
organization `pug-sh`, repository `sdk-crawlers`, workflow `release.yml`, with `npm publish`
allowed: a new configuration allows only `npm stage publish` by default, which rejects the
workflow's `npm publish`. It must make its first publish within 2 days of being added.
