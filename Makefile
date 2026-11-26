# @pug-sh/crawlers developer tasks. `make codegen` builds three things from proto/, pug's protos,
# vendored from a pinned BSR commit the way sdk-node vendors its protos:
#   - src/agents.generated.ts, the agent list: the crawler table (proto/common/crawlers/v1), and the
#     search-engine and seo entries of crawler-user-agents, at the exact version pinned in
#     package.json, which must match the one pug's go.mod pins, so the package sends what the
#     server classifies;
#   - src/events.generated.ts, the BatchCreate procedure and the limits on the fields a report fills
#     from a site's request (proto/sdk/events/v1, proto/common/v1);
#   - src/gen, the protobuf-es JSON types the report is checked against. They're declarations only,
#     imported as types, so the package still ships no protobuf runtime.
# Builds and CI never touch the BSR, only the release gate does: proto/ and the generated files are
# committed.

.PHONY: sync-protos codegen check-codegen check-proto-pin proto-latest build lint typecheck knip test check ci

# Recipes share files (`codegen` rewrites what `build` reads), so keep them serial under make -jN.
.NOTPARALLEL:

BUF          ?= buf
PROTO_MODULE := buf.build/pugsh/pug
PROTO_COMMIT := 4b577f9e36044955bed2bb8cf15ec0c3
PROTO_PATHS  := --path common/crawlers/v1 --path sdk/events/v1

sync-protos:
	@command -v $(BUF) >/dev/null || { echo "buf CLI required: https://buf.build/docs/installation"; exit 1; }
	@test -n "$(PROTO_COMMIT)" || { echo "PROTO_COMMIT is not set"; exit 1; }
	rm -rf proto
	$(BUF) export $(PROTO_MODULE):$(PROTO_COMMIT) --output proto $(PROTO_PATHS)

check-proto-pin:
	@command -v $(BUF) >/dev/null || { echo "buf CLI required: https://buf.build/docs/installation"; exit 1; }
	@test -n "$(PROTO_COMMIT)" || { echo "PROTO_COMMIT is not set: pin the BSR commit before a release"; exit 1; }
	@rm -rf .proto-pin-check
	@$(BUF) export $(PROTO_MODULE):$(PROTO_COMMIT) --output .proto-pin-check $(PROTO_PATHS)
	@diff -r proto .proto-pin-check \
	  && { rm -rf .proto-pin-check; echo "proto/ matches $(PROTO_MODULE):$(PROTO_COMMIT)."; } \
	  || { rm -rf .proto-pin-check; echo "proto/ diverges from $(PROTO_COMMIT): bump PROTO_COMMIT, then 'make sync-protos codegen'."; exit 1; }

# Options and validation rules come out of a descriptor set as plain JSON, so the generators need no
# protobuf runtime. buf.gen.yaml runs protoc-gen-es from node_modules, so `bun install` first.
codegen:
	@command -v $(BUF) >/dev/null || { echo "buf CLI required: https://buf.build/docs/installation"; exit 1; }
	@mkdir -p .codegen-tmp
	$(BUF) build proto --as-file-descriptor-set -o .codegen-tmp/protos.json
	node scripts/gen-agents.mjs
	node scripts/gen-events.mjs
	rm -rf .codegen-tmp
	$(BUF) generate

# `git diff` skips untracked files, so a newly generated file nobody committed is caught separately.
check-codegen: codegen
	@git diff --exit-code -- src/agents.generated.ts src/events.generated.ts src/gen \
	  && test -z "$$(git ls-files --others --exclude-standard -- src/events.generated.ts src/gen)" \
	  || { git ls-files --others --exclude-standard -- src/events.generated.ts src/gen; echo "codegen drift: run 'make codegen' and commit"; exit 1; }

proto-latest:
	@$(BUF) registry module commit resolve $(PROTO_MODULE):main

build:
	bun run build
lint:
	bun run lint
typecheck:
	bun run typecheck
knip:
	bun run knip
test:
	bun run test

check: lint typecheck knip test build
ci: check-codegen check
