# ADR-001: API-Only Transport (No Git Binary)

## Status

Accepted

## Date

2026-03-29

## Context

Obsidian runs on Desktop (Electron), iOS (WKWebView), and Android (WebView). The most popular sync plugin (obsidian-git) relies on the native `git` binary on desktop and `isomorphic-git` on mobile — the mobile experience is explicitly described as "very unstable" by its maintainer. We need a transport layer that works identically on all platforms.

## Options Considered

### Option A: Native git binary + isomorphic-git fallback
- Pros: Full git compatibility, existing plugin (obsidian-git) proves feasibility
- Cons: Mobile is unstable, SSH unsupported on mobile, scanning takes 3+ minutes on large vaults

### Option B: isomorphic-git everywhere
- Pros: Pure JS, works on all platforms
- Cons: Large bundle (~200KB), incomplete git implementation, performance issues on mobile

### Option C: GitHub REST/GraphQL API directly via requestUrl()
- Pros: Works identically on all platforms, no native deps, small bundle, Obsidian's requestUrl bypasses CORS
- Cons: GitHub-only (no GitLab/Bitbucket), requires PAT, subject to API rate limits

## Decision

Option C — GitHub API directly via Obsidian's `requestUrl()`. Rate limits (~7 requests per sync cycle, 5000/hr limit) are more than sufficient. The provider-agnostic architecture allows adding other backends (S3, WebDAV) later.

## Consequences

- Plugin is GitHub-only (acceptable for MVP, can add other providers later)
- No git binary needed on any platform
- Identical behavior on desktop and mobile
- Must handle rate limits and conflict detection at the API level
