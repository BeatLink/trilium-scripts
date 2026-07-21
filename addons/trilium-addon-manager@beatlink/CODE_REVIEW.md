# Trilium Addon Manager - Code Analysis & Optimization Opportunities

## Overview
Examined ~2,800 lines across TAM.jsx (frontend, 1,500 LOC), lib-tam.js (backend, 1,100 LOC), and lib-tam-db.js (database, 50 LOC).

---

## High-Impact Optimization Opportunities

### 1. **Tripled `fetchWithRetry` Function** ⭐⭐⭐
**Severity:** Code Duplication | **Impact:** Maintenance Risk
**Status:** 3 copies + 1 module-level definition

The same HTTP retry logic is duplicated verbatim in three separate contexts:
- Module-level in lib-tam.js (~44 lines)
- Inline in `fetchJson` backend callback (~44 lines, lines 60-75)
- Inline in `resolveNotes` backend callback (~44 lines, lines 430-445)

**Root cause:** Backend async callbacks run in a serialized context and can't close over module-level functions. The comment even acknowledges this: "Own copy of fetchWithRetry: this callback is serialized and runs in a separate backend context that can't close over the module-level one."

**Solution:**
- Extract to a shared string constant or create a factory that generates the function
- Use Trilium's built-in retry mechanism if available, or wrap fetch as a reusable backend helper
- **If kept duplicated:** At minimum, add a version string or timestamp to the duplicates and link to the module-level definition with a comment for sync purposes

**Recommendation:** This is genuinely difficult to DRY — backend isolation is the constraint. Best approach:
1. Keep module-level definition as the source of truth
2. Add a JSDoc comment explaining the duplication and linking all 3 locations
3. If Trilium adds a native `api.fetch()` or similar, migrate immediately

---

### 2. **TAM-File-ID Prefix Checks** ⭐⭐
**Severity:** Repeated Logic | **Impact:** Cognitive Load + Fragility

The pattern appears 4+ times:
```javascript
const ownTamFileId = note.getLabelValue(tamFileIdLabel)
if (!ownTamFileId || !ownTamFileId.startsWith(`${addonId}/`)) continue
```

Appears in:
- `connectAddonPersistence` line ~680
- `enableAddon` line ~1230
- `detachAddonOwnedBranches` line ~1340
- `validateDatabase` line ~1410

**Solution:**
```javascript
function isOwnTamFileId(note, addonId) {
    const tamFileId = note.getLabelValue(tamFileIdLabel)
    return tamFileId && tamFileId.startsWith(`${addonId}/`)
}
```

**Saves:** ~4 lines × 4 locations = 16 lines, plus cognitive overhead in understanding intent.

---

### 3. **Addon Metadata Assembly** ⭐⭐
**Severity:** Repeated Pattern | **Impact:** Consistency Risk

The same shape is built in multiple places:
```javascript
const meta = {
    name: manifest.name,
    description: manifest.description,
    author: manifest.author,
    license: manifest.license,
    type: manifest.type,
    homepage: manifest.homepage
}
```

Appears in:
- `syncAddon` line ~1100
- `recordDependencyMeta` line ~950
- (partially in `fetchDependencyMeta` line ~910)

**Solution:**
```javascript
function extractAddonMeta(manifest) {
    return {
        name: manifest.name,
        description: manifest.description,
        author: manifest.author,
        license: manifest.license,
        type: manifest.type,
        homepage: manifest.homepage
    }
}
```

**Saves:** ~6 lines × multiple locations, ensures consistency.

---

### 4. **Frontend: Button Click Handler Boilerplate** ⭐
**Severity:** Repeated Pattern | **Impact:** Verbosity

Multiple places repeat:
```javascript
onClick={e => {
    e.stopPropagation()
    onSomeAction(addonData.id)
}}
```

In AddonCard, appears 3+ times. Could be abstracted to a helper:
```javascript
function stopPropagationAndCall(fn) {
    return (e) => {
        e.stopPropagation()
        fn()
    }
}
```

**Saves:** ~3 lines × occurrences, improves readability.

---

### 5. **Database Load/Modify/Save Pattern** ⭐
**Severity:** Repeated Pattern | **Impact:** Transaction Safety

Most commands follow:
```javascript
let database = await db.loadDatabase()
// ... modify database.installedAddons[...] ...
await db.saveDatabase(database)
```

This pattern is vulnerable to:
- Intermediate loads trampling each other's changes
- No transaction safety
- Repeated boilerplate

**Solution:**
```javascript
async function transact(fn) {
    let database = await db.loadDatabase()
    await fn(database)
    await db.saveDatabase(database)
}

// Usage:
await transact(database => {
    database.installedAddons[addonId].enabled = enabled
})
```

**Saves:** ~2 lines × ~15+ locations, improves predictability.

---

### 6. **Frontend: Command Dispatch Boilerplate** ⭐
**Severity:** Repeated Pattern | **Impact:** Maintainability

Many UI elements dispatch commands with repetitive patterns:
```javascript
onClick={() => dispatch({ command: "update-addon", addon: addonId })}
```

This is scattered across dozens of callbacks. Consider:
```javascript
function createCommandDispatcher(command, mapProps = null) {
    return (value) => dispatch({
        command,
        ...(mapProps ? mapProps(value) : { value })
    })
}
```

**Saves:** Reduces scattered dispatch site boilerplate, centralized command construction.

---

### 7. **Frontend: SearchFilterToolbar Duplication** ⭐
**Severity:** Duplicated Component Logic | **Impact:** Code Reuse

`SearchFilterToolbar` is used in two views (ListView, CatalogBrowseView), and both implement identical search/filter state. The `useAddonFilter` hook already handles this well, so no change needed here — **good design**.

---

### 8. **`stripManifestForStorage` Inverse Operation Missing**
**Severity:** Asymmetry | **Impact:** Cognitive Load

`stripManifestForStorage` removes fields, but there's no counterpart to add defaults back. When a stored manifest is loaded, fields like `type ?? "text"` and `mime ?? "text/html"` appear scattered through `resolveNotes`.

**Solution:**
```javascript
function expandManifestDefaults(storedManifest) {
    return {
        ...storedManifest,
        notes: (storedManifest.notes || []).map(n => ({
            type: "text",
            mime: "text/html",
            ...n
        }))
    }
}
```

---

### 9. **`normalizeManifest` Repetition**
**Severity:** Repeated Pattern | **Impact:** Consistency

Normalizing a manifest (handling missing `manifest` wrapper) is done in:
- `fetchManifest` -> `normalizeManifest` (correct)
- But also inline defaults in `resolveNotes` and others

**Good:** `normalizeManifest` is already centralized. No change needed.

---

### 10. **Label/Relation Name Building**
**Severity:** String Manipulation | **Impact:** Fragility

Patterns like `${addonId}/${localId}` and `rel.type.split("AddonData:")[1]` appear multiple times. Could use helpers:
```javascript
function encodeTamFileId(addonId, localId) { return `${addonId}/${localId}` }
function decodeTamFileId(tamFileId) { return tamFileId.split("/") } // Returns [addonId, localId]
function decodeAddonDataKey(relationName) { return relationName.split("AddonData:")[1] }
```

**Saves:** Clarity, prevents accidental format changes.

---

## Low-Impact / Design-Sound Areas

✅ **Good separation:** lib-tam.js (backend) vs lib-tam-db.js (database) vs TAM.jsx (UI)  
✅ **Good abstraction:** `useAddonFilter` hook reused by two views  
✅ **Good state model:** useTamCommands separates data/commands from UI state  
✅ **Good error handling:** Try/catch on commands, error feedback to user  
✅ **Good manifest design:** Normalization, storage stripping, all centralized  

---

## Summary of Recommendations (Priority Order)

| # | Issue | Effort | Impact | Type |
|----|-------|--------|--------|------|
| 1 | `fetchWithRetry` triplication | Medium | High | Duplication |
| 2 | TAM-file-ID guard helper | Low | Medium | Duplication |
| 3 | Addon metadata helper | Low | Medium | Duplication |
| 4 | Database transact wrapper | Low | Medium | Pattern |
| 5 | Button click handler helper | Low | Low | Pattern |
| 6 | Command dispatch helpers | Medium | Low | Pattern |
| 7 | Expand manifest defaults inverse | Low | Medium | Asymmetry |
| 8 | Label/relation name helpers | Low | Low | Clarity |

---

## Trilium Scripting API Alignment

Per Trilium's [script documentation](https://docs.triliumnotes.org/user-guide/scripts):

✅ **Frontend `api` usage:** Correct (activateNote, currentNote, runOnBackend)  
✅ **Backend callback isolation:** Correctly understood — functions can't close over frontend scope  
✅ **Manual transaction handling:** `runAsyncOnBackendWithManualTransactionHandling` used appropriately  
✅ **Label/relation patterns:** Matches Trilium's attribute model correctly  

---

## Suggested Next Steps

1. **Quick wins (30 min):** Extract `isOwnTamFileId()`, `extractAddonMeta()`, TAM ID helpers
2. **Medium (1-2 hrs):** Add database `transact()` wrapper, test thoroughly for transaction safety
3. **Harder (2-3 hrs):** Attempt `fetchWithRetry` DRY without breaking backend isolation (may not be worth it)
4. **Polish (optional):** Add helpers for label/relation name building if further maintenance is expected
