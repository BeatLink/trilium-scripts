import { useState, useEffect } from "trilium:preact"
import { activateNote } from "trilium:api"
import { resolveConfigNotes } from "libSettingsUI.jsx"
import { findDuplicates, mergeDuplicates } from "duplicateRegistry.jsx"

// One card per duplicate group. The user picks which copy survives (defaults to
// the oldest, which the scan already sorted first), then converts the rest into
// clones of it. A copy carrying children is shown but cannot be chosen away from
// — merging would delete its subtree — so it is locked out of the merge.
function DuplicateGroup({ group, onMerged }) {
    const [keeperNoteId, setKeeperNoteId] = useState(group.notes[0].noteId)
    const [busy, setBusy] = useState(false)
    const [status, setStatus] = useState(null)

    const mergeable = group.notes.filter(n => n.noteId !== keeperNoteId && n.childCount === 0)
    const blocked = group.notes.filter(n => n.noteId !== keeperNoteId && n.childCount > 0)

    async function merge() {
        if (busy || mergeable.length === 0) return
        setBusy(true)
        setStatus(null)
        try {
            const result = await mergeDuplicates(keeperNoteId, mergeable.map(n => n.noteId))
            if (result.deleted > 0) {
                onMerged(group.signature, keeperNoteId, result)
                return
            }
            setStatus(
                result.skipped.length
                    ? "Nothing merged: " + result.skipped.map(s => s.reason).join("; ")
                    : "Nothing merged."
            )
        } catch (e) {
            setStatus("Merge failed: " + String(e && e.message ? e.message : e))
        } finally {
            setBusy(false)
        }
    }

    return (
        <div className="duplicate-finder-group">
            <div className="duplicate-finder-group-header">
                <span className="duplicate-finder-group-title">{group.notes[0].title || "(untitled)"}</span>
                <span className="duplicate-finder-group-count">{group.notes.length} copies</span>
            </div>

            {group.notes[0].contentPreview && (
                <div className="duplicate-finder-preview">{group.notes[0].contentPreview}</div>
            )}

            <div className="duplicate-finder-copies">
                {group.notes.map(note => (
                    <label
                        key={note.noteId}
                        className={"duplicate-finder-copy" + (note.noteId === keeperNoteId ? " is-keeper" : "")}
                    >
                        <input
                            type="radio"
                            name={"keeper-" + group.signature}
                            checked={note.noteId === keeperNoteId}
                            disabled={busy}
                            onChange={() => setKeeperNoteId(note.noteId)}
                        />
                        <span className="duplicate-finder-copy-body">
                            <span
                                className="duplicate-finder-copy-title"
                                title="Open this note"
                                onClick={e => { e.preventDefault(); activateNote(note.noteId) }}
                            >
                                {note.title || "(untitled)"}
                            </span>
                            <span className="duplicate-finder-copy-meta">
                                created {String(note.dateCreated || "").slice(0, 16)}
                                {" · modified " + String(note.dateModified || "").slice(0, 16)}
                                {note.childCount > 0 && " · " + note.childCount + " children"}
                            </span>
                            <span className="duplicate-finder-copy-parents">
                                in {note.parents.length === 0
                                    ? "(no parent)"
                                    : note.parents.map(p => p.title).join(", ")}
                            </span>
                        </span>
                    </label>
                ))}
            </div>

            {blocked.length > 0 && (
                <div className="duplicate-finder-warning">
                    {blocked.length} cop{blocked.length === 1 ? "y has" : "ies have"} children and will be
                    left alone — deleting them would take their subtrees. Keep one of those instead, or
                    move their children first.
                </div>
            )}

            <div className="duplicate-finder-group-actions">
                <button className="duplicate-finder-merge" disabled={busy || mergeable.length === 0} onClick={merge}>
                    {busy
                        ? "Converting..."
                        : "Convert " + mergeable.length + " to clone" + (mergeable.length === 1 ? "" : "s")}
                </button>
                {status && <span className="duplicate-finder-group-status">{status}</span>}
            </div>
        </div>
    )
}

export default function DuplicateFinderPage() {
    const [notes, setNotes] = useState(null)
    const [result, setResult] = useState(null)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState(null)
    const [merged, setMerged] = useState([])

    useEffect(() => {
        // `api.currentNote` must be read here, in this addon's own module —
        // inside libsettings it resolves to the library's note instead.
        (async () => setNotes(await resolveConfigNotes(api.currentNote)))()
    }, [])

    async function scan() {
        if (!notes?.schemaNoteId || !notes?.configNoteId) return
        setBusy(true)
        setError(null)
        setMerged([])
        try {
            const found = await findDuplicates(notes.schemaNoteId, notes.configNoteId)
            if (found.error) {
                setError(found.error)
                setResult(null)
            } else {
                setResult(found)
            }
        } catch (e) {
            setError("Scan failed: " + String(e && e.message ? e.message : e))
        } finally {
            setBusy(false)
        }
    }

    // A merged group leaves the list, so the remaining ones stay actionable
    // without needing a rescan.
    function onMerged(signature, keeperNoteId, mergeResult) {
        setResult(r => ({ ...r, groups: r.groups.filter(g => g.signature !== signature) }))
        setMerged(m => [...m, { keeperNoteId, ...mergeResult }])
    }

    if (!notes) return <div className="duplicate-finder-page">Loading...</div>
    if (!notes.schemaNoteId || !notes.configNoteId) {
        return <div className="duplicate-finder-page">Settings notes could not be resolved.</div>
    }

    const totalDeleted = merged.reduce((sum, m) => sum + m.deleted, 0)

    return (
        <div className="duplicate-finder-page">
            <h4 className="duplicate-finder-heading">Duplicate Notes</h4>

            <p className="duplicate-finder-blurb">
                Finds notes with matching title, content and attributes, and converts the extra copies
                into clones of whichever one you keep — the clone is placed everywhere the copy was, so
                nothing moves in your tree. Adjust what counts as a match in Settings.
            </p>

            <div className="duplicate-finder-toolbar">
                <button className="duplicate-finder-scan" disabled={busy} onClick={scan}>
                    {busy ? "Scanning..." : "Scan for duplicates"}
                </button>
                {result && !busy && (
                    <span className="duplicate-finder-summary">
                        {result.groups.length === 0
                            ? "No duplicates found in " + result.scanned + " notes."
                            : result.groups.length + " duplicate group" +
                              (result.groups.length === 1 ? "" : "s") + " in " + result.scanned + " notes."}
                    </span>
                )}
            </div>

            {error && <div className="duplicate-finder-error">{error}</div>}

            {totalDeleted > 0 && (
                <div className="duplicate-finder-done">
                    Converted {totalDeleted} duplicate{totalDeleted === 1 ? "" : "s"} into clones.
                </div>
            )}

            {result?.groups.map(group => (
                <DuplicateGroup key={group.signature} group={group} onMerged={onMerged} />
            ))}
        </div>
    )
}
