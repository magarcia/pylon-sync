# Contributing

## Getting Started

1. Fork and clone the repo
2. Install dependencies: `pnpm install`
3. Run tests: `pnpm -r test`
4. Type check: `pnpm -r run typecheck`

## Project Structure

This is a pnpm monorepo with five packages:
- `packages/core` — Platform-agnostic sync engine
- `packages/provider-github` — GitHub API provider
- `packages/provider-s3` — S3-compatible storage provider (AWS S3, Cloudflare R2, MinIO, Backblaze B2)
- `packages/cli` — CLI companion tool
- `packages/obsidian-plugin` — Obsidian plugin

## Making Changes

1. Create a feature branch
2. Write tests first (TDD)
3. Make your changes
4. Ensure all checks pass: `pnpm -r test && pnpm -r run typecheck`
5. Submit a PR

## Code Style

- TypeScript strict mode
- No `any` types (use `unknown` + type guards)
- Comments explain "why", not "what"
- Tests use behavioral names: "should [expected] when [condition]"
