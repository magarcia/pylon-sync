---
paths:
  - "**/*.test.ts"
  - "**/*.spec.ts"
  - "**/mock-fs.ts"
  - "**/mocks/**"
---

# Testing Rules

- vitest with `globals: true` — no explicit imports needed
- Test BEHAVIOR not implementation — "should [expected] when [condition]"
- Mock at module boundaries (`vi.mock("../scanner")`), not individual functions
- Non-null assertions (`!`) are acceptable for array/map access in tests
- Use `as any` for mock-only helpers (`_seed`, `_getContent`, `_clear`)
- Each test must be independent — use `beforeEach` for setup, never share mutable state
- For async tests: use `vi.useFakeTimers()` and `vi.advanceTimersByTime()` for timing
- Mock `cross-keychain` and `fetch` with `vi.mock()` / `vi.stubGlobal()`
- When mocking the Provider interface: include all methods (fetch, push, bootstrap, getBase)
- Run `npx vitest run` in the specific package, not from root, for faster feedback
