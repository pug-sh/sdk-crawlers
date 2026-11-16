# @pug-sh/crawlers developer tasks. The agent list ships inside the package as
# src/agents.generated.ts, built from two sources at release:
#   - the crawler table in pug's protos (proto/common/crawlers/v1), vendored under proto/ from a
#     pinned BSR commit, the way sdk-node vendors its protos;
#   - the search-engine and seo entries of crawler-user-agents, at the exact version pinned in
#     package.json, which must match the one pug's go.mod pins, so the package sends what the
#     server classifies.
# Builds and CI never touch the BSR, only the release gate does: proto/ and the generated file are
# committed.

.PHONY: sync-protos agents check-codegen check-proto-pin proto-latest build lint typecheck knip test check ci

# Recipes share files (`agents` rewrites what `build` reads), so keep them serial under make -jN.
.NOTPARALLEL:

BUF          ?= buf
PROTO_MODULE := buf.build/pugsh/pug
# Empty until pug's proto/common/crawlers/v1 is on the BSR: set it from `make proto-latest`, then
# `make sync-protos agents`. Until then proto/ is a copy of ../pug/proto, and check-proto-pin, the
# release gate, fails.
PROTO_COMMIT :=
PROTO_PATHS  := --path common/crawlers/v1

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
	  || { rm -rf .proto-pin-check; echo "proto/ diverges from $(PROTO_COMMIT): bump PROTO_COMMIT, then 'make sync-protos agents'."; exit 1; }

# The table's options come out of a descriptor set as plain JSON, so the generator needs no
# protobuf runtime.
agents:
	@command -v $(BUF) >/dev/null || { echo "buf CLI required: https://buf.build/docs/installation"; exit 1; }
	@mkdir -p .codegen-tmp
	$(BUF) build proto --as-file-descriptor-set -o .codegen-tmp/crawlers.json
	node scripts/gen-agents.mjs
	rm -rf .codegen-tmp

check-codegen: agents
	@git diff --exit-code -- src/agents.generated.ts \
	  || { echo "codegen drift: run 'make agents' and commit"; exit 1; }

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
