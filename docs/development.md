# Development

Internal guide for working on `sdk-crawlers`. End-user docs live in the [README](../README.md);
the design is pug's `docs/architecture/ai-crawlers.md`.

## Toolchain

bun (packages and scripts), biome (format), tsc (types and `dist/`), vitest (tests), knip (unused
code), and the [buf CLI](https://buf.build/docs/installation) for `make agents`. The package has no
runtime dependencies, and must keep none: it runs inside customers' edge functions.

## The agent list

`src/agents.generated.ts` is generated; don't edit it. `make agents` rebuilds it from:

- **The crawler table**: pug's `proto/common/crawlers/v1`, vendored under `proto/` from the Buf
  Schema Registry commit the Makefile pins. `buf build` turns it into a descriptor set whose
  options read as plain JSON, so the generator needs no protobuf runtime. Rows marked `deprecated`
  are left out, as the server leaves them out.
- **crawler-user-agents**: its `search-engine` and `seo` entries, at the exact version in
  `package.json`. Keep that version equal to the one pug's `go.mod` pins: the server matches with
  the Go module of the same list, and a version ahead of it sends agents the server drops.

| Command                | What it does                                                                      |
| ---------------------- | --------------------------------------------------------------------------------- |
| `make agents`          | Regenerate `src/agents.generated.ts`. Pass `BUF=` for a buf that isn't on `PATH`. |
| `make sync-protos`     | Re-vendor `proto/` from `PROTO_COMMIT`. Needs BSR network.                        |
| `make proto-latest`    | Print the newest commit of `buf.build/pugsh/pug` on main.                         |
| `make check-proto-pin` | Fail if `proto/` differs from `PROTO_COMMIT`. The release gate.                   |
| `make ci`              | Regenerate, fail on drift, then lint, typecheck, knip, test and build.            |

To take a table change: bump `PROTO_COMMIT` in the `Makefile`, run `make sync-protos agents`, and
commit `proto/` with the generated file.

## Matching

`src/match.ts` mirrors pug's `internal/crawler`, over the first 512 bytes of the user agent less
any word that bound cuts. A table token matches as a whole word, any case, the longest winning.
Otherwise the list entry whose pattern matches earliest in the user agent wins, the first listed
on a tie. The generator drops list entries whose name holds a table token, as the server skips
them, so `NotGooglebot` matches nothing. The server matches again and has the last word; the
package only decides what to send. `src/match.test.ts` holds the server's sample user agent for
every table row.
