# GitHub Actions for Obsidian Plugins

## Release Workflow

This workflow builds and releases the plugin when a version tag is pushed:

```yaml
# .github/workflows/release.yml
name: Release Obsidian Plugin

on:
  push:
    tags:
      - "*"

permissions:
  contents: write

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: "20"

      - name: Install dependencies
        run: npm ci

      - name: Build
        run: npm run build

      - name: Create release
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          tag="${GITHUB_REF#refs/tags/}"

          # Verify version consistency
          manifest_version=$(jq -r '.version' manifest.json)
          if [ "$tag" != "$manifest_version" ]; then
            echo "Tag ($tag) does not match manifest version ($manifest_version)"
            exit 1
          fi

          # Create GitHub Release with required files
          gh release create "$tag" \
            --title "v$tag" \
            --generate-notes \
            main.js manifest.json styles.css
```

## PR Validation Workflow

Validates builds on pull requests:

```yaml
# .github/workflows/ci.yml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: "20"

      - name: Install dependencies
        run: npm ci

      - name: Type check
        run: npx tsc --noEmit

      - name: Build
        run: npm run build

      - name: Test
        run: npm test

      - name: Verify manifest
        run: |
          # Check manifest.json is valid
          jq empty manifest.json

          # Check versions.json is valid
          jq empty versions.json

          # Check manifest version exists in versions.json
          version=$(jq -r '.version' manifest.json)
          jq -e --arg v "$version" '.[$v]' versions.json > /dev/null
```

## Release Process

```bash
# 1. Decide new version
NEW_VERSION="1.2.0"

# 2. Update manifest.json version
jq --arg v "$NEW_VERSION" '.version = $v' manifest.json > tmp && mv tmp manifest.json

# 3. Update versions.json
MIN_APP=$(jq -r '.minAppVersion' manifest.json)
jq --arg v "$NEW_VERSION" --arg m "$MIN_APP" '. + {($v): $m}' versions.json > tmp && mv tmp versions.json

# 4. Update package.json (optional but recommended)
npm version "$NEW_VERSION" --no-git-tag-version

# 5. Commit and tag
git add manifest.json versions.json package.json package-lock.json
git commit -m "Release $NEW_VERSION"
git tag "$NEW_VERSION"

# 6. Push (triggers release workflow)
git push && git push --tags
```

## Handling styles.css

If the plugin has no `styles.css`, remove it from the release command:

```yaml
gh release create "$tag" \
  --title "v$tag" \
  --generate-notes \
  main.js manifest.json
```

If styles.css is optional, make it conditional:

```yaml
- name: Create release
  run: |
    files="main.js manifest.json"
    if [ -f styles.css ]; then
      files="$files styles.css"
    fi
    gh release create "$tag" --title "v$tag" --generate-notes $files
```
