# testing

Binding for every card.

- Pure logic (balance, schema parsing, recipes, assembly math) is tested with vitest next to the
  existing tests in `shared/` and `parts/`. Every bug fix there adds a regression test.
- Verify runs: `pnpm install --frozen-lockfile`, then typecheck + `vitest run` for shared and
  parts, server `typecheck`, and client `build`. All must pass. Never skip, delete or weaken an
  existing test to make verify pass.
- Playwright e2e (`client/e2e/`) needs a local SpacetimeDB, so it is NOT part of verify.
  Cards may add or update specs there. Name the spec in the card summary so a human can run
  `pnpm e2e --grep <name>`.
- If you change the lockfile, `--frozen-lockfile` must still pass. Prefer not to add
  dependencies.
