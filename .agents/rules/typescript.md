---
paths:
  - "**/*.ts"
---

# TypeScript Rules

- Strict mode enabled with `noUncheckedIndexedAccess` — handle `undefined` from indexed access
- Never use `any` — model real shapes with interfaces. Use `unknown` + type guards
- Avoid `as` casts — if you must cast, explain why in a comment
- Use `readonly` on data interfaces (FileEntry, SnapshotEntry, SyncResult)
- Use `import type` for type-only imports
- Prefer discriminated unions over optional fields (e.g., SyncResult status → error)
- Export types alongside implementations from barrel files (index.ts)
- Error classes extend `ProviderError` (core) with a `code` discriminant field
