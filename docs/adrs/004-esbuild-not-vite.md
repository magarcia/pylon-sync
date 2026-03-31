# ADR-004: Use esbuild for Build, Vitest for Testing

## Status

Accepted

## Date

2026-03-29

## Context

Obsidian plugins require a specific build setup: CommonJS output format, `obsidian` module externalized (provided by runtime), single `main.js` output file. The official sample plugin uses esbuild.

For testing, we need a framework that can run pure TypeScript functions and mock the `obsidian` module. The core sync logic (reconciler, hash, snapshot) is pure functions testable without any mocking.

## Options Considered

### Option A: Vite for build + test
- Pros: Single tool, good DX
- Cons: Vite outputs ESM by default, Obsidian requires CJS, would need custom config to match official setup

### Option B: esbuild for build, Vitest for test
- Pros: esbuild matches official sample plugin exactly, Vitest is fast and supports module aliasing for mocking `obsidian`
- Cons: Two tools instead of one

## Decision

Option B — esbuild for production build (matching official Obsidian plugin template), Vitest for testing with `obsidian` module aliased to our mock.

## Consequences

- Build config matches what Obsidian plugin developers expect
- Tests run fast with Vitest
- `obsidian` module is aliased in vitest.config.ts to `test/mocks/obsidian.ts`
- No runtime dependency on any build tool
