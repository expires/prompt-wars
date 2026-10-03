# conventions

Binding for every card.

- TypeScript strict mode, ESM, `import type` for type-only imports. Don't add `any` where a
  type already exists in `@ai-gaem/shared`.
- The single source of truth for weapons is the `Weapon` schema and `clampWeapon()` in
  `shared/src/`. The server must run `clampWeapon` on every weapon it stores. The client never
  trusts its own damage numbers.
- Movement is client-authoritative. Damage, ammo, cooldown, range, HP, death and respawn are
  server-authoritative (reducers in `server/src/index.ts`).
- Client networking goes through the `NetClient` interface (`client/src/net/`). Any feature
  visible to the network needs both a `SpacetimeNetClient` and an `OfflineNetClient` path.
- Never hand-edit `client/src/module_bindings/**` or `server/src/catalog.generated.ts`.
  If server tables or reducers change, write "requires `pnpm --filter @ai-gaem/server generate`"
  in the card summary.
- New dependencies go in the right package's `package.json`. Don't add deps to the root.
- UI is plain DOM + CSS in `client/src/ui/`. No React or other UI frameworks.
- Keep `window.__game` (`client/src/testHook.ts`) working. Extend it when a feature needs
  e2e control.
- Comments only where the reason is not obvious. Match the density of the surrounding code.
