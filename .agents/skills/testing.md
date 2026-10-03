# testing

Binding for every card.

- Pure logic (balance, schema parsing, recipes, assembly math) is tested with vitest next to the
  existing tests in `shared/` and `parts/`. Every bug fix there adds a regression test.
- Verify runs: `pnpm install --no-frozen-lockfile`, then typecheck + `vitest run` for shared and
  parts, server `typecheck`, and client `build`. All must pass. Never skip, delete or weaken an
  existing test to make verify pass.
- Playwright e2e (`client/e2e/`) needs a local SpacetimeDB, so it is NOT part of verify.
  Cards may add or update specs there. Name the spec in the card summary so a human can run
  `pnpm e2e --grep <name>`.
- Never hand-edit `pnpm-lock.yaml`. When a card needs a dependency, add it to the right package's
  `package.json` with a caret range. Verify's install regenerates the lockfile, and that generated
  `pnpm-lock.yaml` change is EXPECTED in the diff. Reviewers must not request changes for it.
- Node scripts under `client/scripts/` run directly on Node 26 with native type stripping:
  use only erasable TS syntax (no enums, namespaces or parameter properties) and import local
  files with an explicit `.ts` extension. Test them with `node:test` + `node:assert/strict` in
  `*.test.ts` files, run by `pnpm --filter client test:scripts`.
