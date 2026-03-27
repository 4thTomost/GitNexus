# GitNexus: Dart Parser Setup on Windows

Guide for getting tree-sitter-dart working with GitNexus on Windows, covering both the CLI (native binding) and the web UI (WASM).

## Problem

GitNexus skips all Dart files during indexing:
```
Skipping 243 dart file(s) — dart parser not available (native binding may not have built)
```

The web UI fails with:
```
Failed to load grammar for dart: Incompatible language version 15. Compatibility range 13 through 14.
```

## Part 1: Native Binding for CLI / MCP Server

### Root Cause

GitNexus declares `tree-sitter-dart` as an **optional** GitHub dependency:
```json
"tree-sitter-dart": "github:UserNobody14/tree-sitter-dart#80e23c07b64494f7e21090bb3450223ef0b192f4"
```

On Windows, the native build fails silently because:
1. The package's bundled `node-gyp` (v10.3.1) cannot find Python (especially Anaconda Python)
2. Since it's an `optionalDependency`, npm skips it without error
3. `npm install` / `npm rebuild` report success even though the directory is never created

### Fix

**Step 1: Clone the repo directly into `node_modules`**

```powershell
cd C:\Users\tomos\IdeaProjects\GitNexus\gitnexus
git clone --depth 1 https://github.com/UserNobody14/tree-sitter-dart.git node_modules\tree-sitter-dart
```

**Step 2: Install the package's own dependencies (without running build scripts)**

```powershell
cd node_modules\tree-sitter-dart
npm install --ignore-scripts
```

This installs `node-addon-api` and `node-gyp-build` which are required by `binding.gyp`.

**Step 3: Build with the global node-gyp, setting PYTHON explicitly**

```powershell
# Set PYTHON env var so node-gyp finds Anaconda Python
$env:PYTHON = "C:\Users\tomos\anaconda3\python.exe"
npx node-gyp rebuild
```

This uses the newer global `node-gyp` (v12+) which handles Python discovery better.

**Step 4: Verify it loads**

```powershell
cd C:\Users\tomos\IdeaProjects\GitNexus\gitnexus
node -e "try { require('tree-sitter-dart'); console.log('OK') } catch(e) { console.log('FAIL:', e.message) }"
```

Should print `OK object`.

### Prerequisites

- **Visual Studio Build Tools 2019+** with "Desktop development with C++" workload
- **Python** (Anaconda or standalone) — node-gyp needs it for native compilation
- **Node.js** v22+

### Re-indexing

After the native binding is built, the GitNexus MCP server holds a lock on the `.gitnexus/lbug` database file. You must:

1. **Stop Claude Code** (or any process using the MCP server)
2. Delete the old index: `Remove-Item -Recurse -Force .gitnexus` (from the target repo)
3. Re-index:
   ```powershell
   cd C:\Users\tomos\IdeaProjects\GitNexus\gitnexus
   npx gitnexus analyze --force C:\path\to\your\repo
   ```
4. Restart Claude Code

Result: went from **521 nodes / 507 edges** to **2,931 nodes / 6,415 edges / 223 clusters / 71 flows**.

---

## Part 2: WASM for Web UI

### Root Cause

The gitnexus-web app uses `web-tree-sitter@0.20.8` which supports language ABI versions **13-14**. The `tree-sitter-dart.wasm` from the `tree-sitter-wasms` npm package is built with language version **15** (incompatible).

The web app expects WASM files at `/wasm/dart/tree-sitter-dart.wasm` but the `public/wasm/` directory has no `dart/` folder.

### Fix

**Step 1: Create the public directory**

```powershell
mkdir C:\Users\tomos\IdeaProjects\GitNexus\gitnexus-web\public\wasm\dart
```

**Step 2: Patch the grammar source to declare version 14**

In the cloned `tree-sitter-dart` repo, edit `src/parser.c` line 9:
```c
// Change:
#define LANGUAGE_VERSION 15
// To:
#define LANGUAGE_VERSION 14
```

**Step 3: Build the WASM using Docker + Emscripten + tree-sitter-cli@0.20.8**

```powershell
# Requires Docker Desktop running
$env:MSYS_NO_PATHCONV = 1
docker run --rm -v "C:/Users/tomos/IdeaProjects/GitNexus/tree-sitter-dart-build:/src" emscripten/emsdk:3.1.29 bash -c "
  cp -r /src /tmp/tree-sitter-dart &&
  cd /tmp &&
  npm install tree-sitter-cli@0.20.8 &&
  ./node_modules/.bin/tree-sitter build-wasm /tmp/tree-sitter-dart &&
  cp /tmp/tree-sitter-dart.wasm /src/tree-sitter-dart.wasm
"
```

Key details:
- Must use `MSYS_NO_PATHCONV=1` on Windows to prevent Git Bash from mangling Docker paths
- Must copy source to `/tmp` inside the container to avoid cross-device link errors
- Must use `tree-sitter-cli@0.20.8` to match the `web-tree-sitter@0.20.8` runtime
- Must patch `LANGUAGE_VERSION` to 14 since web-tree-sitter@0.20.8 only supports 13-14
- Docker image `emscripten/emsdk:3.1.29` is ~1.5GB on first pull

**Step 4: Copy WASM to the web app**

```powershell
Copy-Item .\tree-sitter-dart-build\tree-sitter-dart.wasm .\gitnexus-web\public\wasm\dart\tree-sitter-dart.wasm
```

**Step 5: Restart the Vite dev server**

```powershell
cd C:\Users\tomos\IdeaProjects\GitNexus\gitnexus-web
npm run dev
```

### Note on ABI Compatibility

The `web-tree-sitter` version determines which language versions are supported:

| web-tree-sitter | Supported language versions |
|----------------|---------------------------|
| 0.20.x         | 13 - 14                   |
| 0.24.x         | 14 - 15                   |
| 0.25.x+        | 14 - 15                   |

Upgrading `web-tree-sitter` would fix the Dart issue but could break the existing WASM files (JS, Python, etc.) that were built for the 0.20.x ABI. The safest approach is to patch `LANGUAGE_VERSION` and rebuild with the matching CLI version.

---

## Summary of Issues Encountered

| Issue | Root Cause | Fix |
|-------|-----------|-----|
| `npm install` silently skips tree-sitter-dart | Optional GitHub dependency fails to build; npm swallows error | Manual clone + npm install --ignore-scripts + node-gyp rebuild |
| node-gyp can't find Python | Bundled node-gyp v10.3.1 doesn't find Anaconda Python | Set `$env:PYTHON` explicitly, use global npx node-gyp (v12+) |
| `binding.gyp: undefined not found` | `node-addon-api` not installed in tree-sitter-dart | Run `npm install --ignore-scripts` inside tree-sitter-dart first |
| `npm rebuild tree-sitter-dart` says success but no directory | Package was never installed, nothing to rebuild | Manual clone approach instead |
| Re-index shows same node count | `.gitnexus/lbug` database locked by MCP server | Stop Claude Code, delete `.gitnexus/`, re-index, restart |
| WASM: "Incompatible language version 15" | Grammar declares v15, web-tree-sitter@0.20.8 supports 13-14 | Patch `parser.c` to v14, rebuild WASM with Docker |
| Docker: `src\scanner.c: No such file` | Windows backslash paths inside Linux container | Copy source to `/tmp` inside container before building |
| Docker: `Invalid cross-device link` | tree-sitter-cli can't rename across Docker volume boundary | Build in `/tmp`, then copy result back to mounted volume |
| Docker: `MSYS path conversion` | Git Bash on Windows rewrites `/src` to `C:/Program Files/Git/src` | Set `MSYS_NO_PATHCONV=1` |
