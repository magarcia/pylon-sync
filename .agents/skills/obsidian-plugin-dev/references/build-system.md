# Build System

## esbuild Configuration

Standard Obsidian plugin build setup:

```javascript
// esbuild.config.mjs
import esbuild from "esbuild";
import process from "process";
import builtins from "builtin-modules";

const prod = process.argv[2] === "production";

const context = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: [
    "obsidian",
    "electron",
    "@codemirror/autocomplete",
    "@codemirror/collab",
    "@codemirror/commands",
    "@codemirror/language",
    "@codemirror/lint",
    "@codemirror/search",
    "@codemirror/state",
    "@codemirror/view",
    "@lezer/common",
    "@lezer/highlight",
    "@lezer/lr",
    ...builtins,
  ],
  format: "cjs",
  target: "es2018",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  outfile: "main.js",
});

if (prod) {
  await context.rebuild();
  process.exit(0);
} else {
  await context.watch();
}
```

## TypeScript Configuration

```json
// tsconfig.json
{
  "compilerOptions": {
    "baseUrl": ".",
    "inlineSourceMap": true,
    "inlineSources": true,
    "module": "ESNext",
    "target": "ES6",
    "allowJs": true,
    "noImplicitAny": true,
    "moduleResolution": "node",
    "importHelpers": true,
    "isolatedModules": true,
    "strictNullChecks": true,
    "lib": ["DOM", "ES5", "ES6", "ES7"]
  },
  "include": ["**/*.ts"]
}
```

## package.json Scripts

```json
{
  "scripts": {
    "dev": "node esbuild.config.mjs",
    "build": "node esbuild.config.mjs production",
    "version": "node version-bump.mjs && git add manifest.json versions.json"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "builtin-modules": "^4.0.0",
    "esbuild": "^0.25.0",
    "obsidian": "latest",
    "typescript": "^5.7.0"
  }
}
```

## Development Workflow

```bash
# Start dev build (watches for changes)
npm run dev

# Create symlink to test vault
# macOS/Linux:
ln -s /path/to/plugin/repo /path/to/vault/.obsidian/plugins/your-plugin-id

# Reload Obsidian to pick up changes:
# Cmd+P → "Reload app without saving" (or Ctrl+P on Win/Linux)
# OR disable/enable plugin in Settings → Community Plugins
```

## Hot Reload Plugin

Install the [Hot Reload](https://github.com/pjeby/hot-reload) community plugin in your test vault. It watches for `main.js` changes and auto-reloads the plugin — no manual restart needed during development.

## version-bump.mjs

Standard version bump script (run by `npm version`):

```javascript
// version-bump.mjs
import { readFileSync, writeFileSync } from "fs";

const targetVersion = process.env.npm_package_version;

// Update manifest.json
let manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
const { minAppVersion } = manifest;
manifest.version = targetVersion;
writeFileSync("manifest.json", JSON.stringify(manifest, null, "\t"));

// Update versions.json
let versions = JSON.parse(readFileSync("versions.json", "utf8"));
versions[targetVersion] = minAppVersion;
writeFileSync("versions.json", JSON.stringify(versions, null, "\t"));
```

## Linting

Use `eslint-plugin-obsidianmd` for Obsidian-specific rules:

```bash
npm install --save-dev eslint eslint-plugin-obsidianmd
```

## Key Build Rules

1. **Output format: CommonJS** — Obsidian loads plugins via `require()`
2. **External: obsidian** — provided by the runtime, never bundle it
3. **External: electron** — desktop-only, provided by Electron
4. **External: @codemirror/*** — provided by Obsidian's editor
5. **Target: ES2018** — safe for all supported Obsidian versions
6. **Single output: main.js** — one bundled file at project root
7. **No Node builtins in bundle** — they don't exist on mobile
