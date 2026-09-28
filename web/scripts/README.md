# Build Scripts

This directory contains build-time transformation scripts for the pochade-js project.

## transform-workers.js

This script automatically embeds Web Worker code into the main bundle during the build process.

### What it does

1. **Scans** the `src/` directory for worker files (files ending in `.worker.js`, `-webworker.js`, or `webworker.js`)
2. **Finds** all occurrences of `new Worker(new URL('./file.worker.js', import.meta.url))`
3. **Reads** the worker file contents
4. **Transforms** the code to embed the worker as a string using the Blob/Object URL pattern
5. **Writes** the transformed code back to the source files

### When it runs

This script runs automatically as a prebuild hook when you run `npm run build`.

```bash
npm run build
# Runs in this order:
# 1. prebuild: node scripts/transform-workers.js
# 2. build: webpack build
# 3. postbuild: git checkout -- src/
```

### Running manually

```bash
node scripts/transform-workers.js
```

### Why this approach?

By embedding workers as strings in the bundle:
- ✅ Single file deployment (works with unpkg.com and other CDNs)
- ✅ No separate worker files to manage
- ✅ No CORS issues
- ✅ Workers and main code always in sync
- ✅ Standard Web Worker API in source code

### Example transformation

**Before transformation:**
```javascript
const worker = new Worker(new URL('./example-webworker.js', import.meta.url));
```

**After transformation:**
```javascript
const worker = (function() {
  const __workerCode = `self.onmessage = (e) => { /* worker code */ };`;
  const blob = new Blob([__workerCode], { type: 'application/javascript' });
  const url = URL.createObjectURL(blob);
  const worker = new Worker(url);
  URL.revokeObjectURL(url);
  return worker;
})();
```

### File restoration

After the build completes, the `postbuild` hook runs `git checkout -- src/` to restore all source files to their original state. This ensures your working directory stays clean and you can continue development with the standard Worker API syntax.
