#!/usr/bin/env python3
"""TAM addon toolchain — one entry point for every build/validate/publish step.

Subcommands (run `tamhelper.py <cmd> -h` for each one's flags):

  validate              Lint every addon manifest before publishing.
  tam-to-zip            Convert a manifest (or --all) into a Trilium ZIP import.
  zip-to-tam            Convert a Trilium export ZIP into a manifest + source files.
  generate-pages        Build the GitHub Pages site (docs/, incl. catalog.json).
  generate-readme       Regenerate README.md's addon table from manifests.
  publish-release       Upload built *.zip files to GitHub Releases.
  backfill-source-url   Add manifestSourceUrl to every manifest missing one.
"""

import argparse
import html
import json
import os
import random
import re
import shutil
import string
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

MANIFEST_NAME = "_tam_manifest_.json"

# One MIME<->extension table, used in both build directions. tam-to-zip needs
# mime -> ext; zip-to-tam needs ext -> mime, with a preferred mime per ext.
MIME_TO_EXT = {
    "text/html":                           ".html",
    "text/markdown":                       ".md",
    "text/jsx":                            ".jsx",
    "text/css":                            ".css",
    "text/x-python":                       ".py",
    "text/plain":                          ".txt",
    "application/json":                    ".json",
    "application/javascript":             ".js",
    "application/javascript;env=frontend": ".js",
    "application/javascript;env=backend":  ".js",
    "application/javascript;env=hybrid":   ".js",
    "audio/wav":                           ".wav",
}
EXT_TO_MIME = {
    ".js":   "application/javascript;env=frontend",
    ".jsx":  "text/jsx",
    ".css":  "text/css",
    ".json": "application/json",
    ".html": "text/html",
    ".md":   "text/markdown",
    ".py":   "text/x-python",
}

ID_CHARS = string.ascii_letters + string.digits


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

def iter_manifests(addons_dir="addons"):
    """Sorted paths to every addons/*/_tam_manifest_.json."""
    return sorted(Path(addons_dir).glob(f"*/{MANIFEST_NAME}"))


def unique_name(base, used):
    """Return `base`, or `base-2`/`base-3`/... if taken. A name with an
    extension is disambiguated before the extension (foo.js -> foo-2.js).
    `used` is a set that this call adds the result to."""
    if base not in used:
        used.add(base)
        return base
    stem, suffix = (Path(base).stem, Path(base).suffix) if Path(base).suffix else (base, "")
    i = 2
    while f"{stem}-{i}{suffix}" in used:
        i += 1
    result = f"{stem}-{i}{suffix}"
    used.add(result)
    return result


def dep_ids(manifest_body):
    """Bare dependency ids from a manifest's inner body (string or {id,...})."""
    out = []
    for d in manifest_body.get("dependencies") or []:
        did = d if isinstance(d, str) else d.get("id")
        if did:
            out.append(did)
    return out


def _run_git(args, cwd):
    try:
        result = subprocess.run(
            ["git", *args], cwd=cwd, capture_output=True, text=True, check=True
        )
        return result.stdout.strip()
    except (subprocess.CalledProcessError, FileNotFoundError):
        return None


_GITHUB_REMOTE_RE = re.compile(r"^(?:git@github\.com:|https://github\.com/)(?P<path>.+?)(?:\.git)?$")


def detect_manifest_source_url(out_dir):
    """Best-effort raw.githubusercontent URL this manifest will be reachable at
    (tracking the current branch), or None if out_dir isn't inside a git working
    copy with a github.com origin remote on a named branch."""
    out_dir = out_dir.resolve()
    repo_root = _run_git(["rev-parse", "--show-toplevel"], out_dir)
    if not repo_root:
        return None
    repo_root = Path(repo_root)

    remote_url = _run_git(["remote", "get-url", "origin"], repo_root)
    if not remote_url:
        return None
    match = _GITHUB_REMOTE_RE.match(remote_url)
    if not match:
        return None

    branch = _run_git(["symbolic-ref", "--short", "HEAD"], repo_root)
    if not branch:
        return None  # detached HEAD or other odd state

    try:
        relative_dir = out_dir.relative_to(repo_root)
    except ValueError:
        return None

    manifest_path = "/".join((*relative_dir.parts, MANIFEST_NAME))
    return f"https://raw.githubusercontent.com/{match.group('path')}/refs/heads/{branch}/{manifest_path}"


def load_addons():
    """Parse every addon manifest under addons/ into {meta, readme_html, outer_dir}."""
    if not Path("addons").is_dir():
        sys.exit("ERROR: no 'addons/' directory — run from repo root")

    addons = []
    for meta_file in iter_manifests():
        try:
            meta = json.loads(meta_file.read_text())
        except json.JSONDecodeError as e:
            print(f"WARNING: skipping {meta_file}: {e}")
            continue
        if not meta.get("id"):
            continue

        outer_dir   = meta_file.parent
        readme_html = ""
        readme_rel  = meta.get("readme")
        if readme_rel and (outer_dir / readme_rel).exists():
            readme_html = _render_md((outer_dir / readme_rel).read_text())

        addons.append({"meta": meta, "readme_html": readme_html, "outer_dir": outer_dir})
    return addons


# ===========================================================================
# validate
# ===========================================================================

REQUIRED_FIELDS = ["id", "name", "description", "author", "homepage", "license", "latestVersion", "type"]
GENERIC_TITLES  = {"lib", "library", "libsettings", "settings", "utils", "helper", "helpers"}


def cmd_validate(args):
    errors, warnings, fixes = [], [], []

    def error(path, msg): errors.append(f"ERROR   {path}: {msg}")
    def warn(path, msg):  warnings.append(f"WARNING {path}: {msg}")

    require_re = re.compile(r"""require\(\s*["']([^"']+)["']\s*\)""")
    import_re  = re.compile(r"""^\s*import\s+(?:[^"']*?\s+from\s+)?["']([^"']+)["']""", re.MULTILINE)
    export_re  = re.compile(r"^\s*export\s+(const|let|var|function|class|default|\{)", re.MULTILINE)

    manifest_files = iter_manifests()
    for manifest_file in manifest_files:
        addon_dir = manifest_file.parent

        try:
            manifest = json.loads(manifest_file.read_text())
        except json.JSONDecodeError as e:
            error(manifest_file, f"invalid JSON — {e}")
            continue

        addon_id = manifest.get("id")
        if not addon_id:
            error(manifest_file, "missing required field 'id'")
            continue

        for field in REQUIRED_FIELDS:
            if field not in manifest:
                warn(manifest_file, f"missing field '{field}'")

        if " " in addon_id:
            error(manifest_file, f"'id' contains spaces: \"{addon_id}\"")
            continue

        # homepage URL must end with addons/{id} (only when it contains /addons/)
        homepage = manifest.get("homepage", "")
        if homepage:
            from urllib.parse import urlparse, urlunparse, unquote
            parsed_url   = urlparse(homepage)
            decoded_path = unquote(parsed_url.path).rstrip("/")
            expected     = f"addons/{addon_id}"
            if "/addons/" in decoded_path and not decoded_path.endswith(expected):
                if args.fix:
                    parts = decoded_path.split("/")
                    try:
                        addons_idx = len(parts) - 1 - parts[::-1].index("addons")
                        parts = parts[:addons_idx + 1] + [addon_id]
                    except ValueError:
                        parts[-1] = addon_id
                    new_homepage = urlunparse(parsed_url._replace(path="/".join(parts)))
                    manifest["homepage"] = new_homepage
                    manifest_file.write_text(json.dumps(manifest, indent=4) + "\n")
                    fixes.append(f"FIXED   updated homepage in '{manifest_file}': '{homepage}' → '{new_homepage}'")
                else:
                    warn(manifest_file, f"homepage does not end with 'addons/{addon_id}' (run --fix to update)")

        readme_rel = manifest.get("readme")
        if readme_rel and not (addon_dir / readme_rel).exists():
            error(manifest_file, f"'readme' points to \"{readme_rel}\" but file not found")

        if not manifest.get("manifestSourceUrl"):
            warn(manifest_file, "missing 'manifestSourceUrl' — addon can't be installed by TAM until this is set")

        m = manifest.get("manifest")
        if m is None:
            continue  # metadata-only addon

        root_id = m.get("root")
        if not root_id:
            error(manifest_file, "manifest.root is required")
            continue

        notes = m.get("notes")
        if not isinstance(notes, list):
            error(manifest_file, "manifest.notes must be an array")
            continue

        note_ids, by_id = set(), {}
        for note in notes:
            nid = note.get("id") or note.get("title")
            if nid:
                note_ids.add(nid)
                by_id[nid] = note
            if not note.get("title"):
                warn(manifest_file, f"note '{nid}' missing 'title'")

        if root_id not in note_ids:
            error(manifest_file, f"manifest.root '{root_id}' not found in notes")

        for field in ("settingsNote", "readmeNote"):
            local_id = m.get(field)
            if local_id and local_id not in note_ids:
                error(manifest_file, f"manifest.{field} '{local_id}' not found in notes")

        # settingsNote should point at a render note, not the raw code note
        settings_note = by_id.get(m.get("settingsNote"))
        if settings_note and settings_note.get("type") == "code":
            warn(manifest_file, f"settingsNote '{m['settingsNote']}' is a raw code note — point it at the wrapping render note instead")

        # Notes served as static HTTP resources are exempt from the env check.
        resource_note_ids = {
            lbl.get("note") for lbl in m.get("labels", [])
            if lbl.get("name") == "customResourceProvider"
        }

        for note in notes:
            nid  = note.get("id", note.get("title", "?"))
            mime = note.get("mime") or ""
            if mime.startswith("application/javascript"):
                if "env=hybrid" in mime:
                    error(manifest_file, f"note '{nid}': mime declares 'env=hybrid', which does not exist — ship two notes (env=frontend + env=backend) instead")
                elif "env=frontend" not in mime and "env=backend" not in mime and nid not in resource_note_ids:
                    warn(manifest_file, f"note '{nid}': mime '{mime}' is missing an env=frontend/env=backend qualifier")

        # plain .js notes are never transpiled — ES export/import will throw
        for note in notes:
            nid = note.get("id", note.get("title", "?"))
            source_url = note.get("sourceUrl") or ""
            if source_url.endswith(".js") and not source_url.startswith(("http://", "https://")):
                source_path = addon_dir / source_url
                if source_path.exists() and export_re.search(source_path.read_text(errors="ignore")):
                    warn(manifest_file, f"note '{nid}': plain .js source uses ES 'export' syntax, which is not transpiled — use CommonJS module.exports instead")

        # notes unreachable from root via children[] will never be created
        local_children = {c.get("child") for c in m.get("children", []) if c.get("child") and not c.get("addon")}
        for nid in note_ids:
            if nid != root_id and nid not in local_children:
                warn(manifest_file, f"note '{nid}' is not attached under any parent in 'children' — it will never be created")

        # promptOnUpdate no-ops without a matching AddonData: relation
        addon_data_targets = {rel.get("to") for rel in m.get("relations", []) if str(rel.get("type", "")).startswith("AddonData:")}
        for note in notes:
            nid = note.get("id", note.get("title", "?"))
            if note.get("promptOnUpdate") and nid not in addon_data_targets:
                warn(manifest_file, f"note '{nid}' sets promptOnUpdate but has no matching 'AddonData:{nid}' relation — the keep-mine/use-new prompt will never fire")

        # generic library titles collide globally across addons
        for note in notes:
            title = note.get("title", "")
            if title.lower() in GENERIC_TITLES and note.get("type") == "code":
                warn(manifest_file, f"note title '{title}' is generic — require()/the bundle-global namespace is shared across all addons; use a fully-qualified title")

        # sourceUrl files must exist
        for note in notes:
            nid = note.get("id", note.get("title", "?"))
            source_url = note.get("sourceUrl")
            if source_url and not source_url.startswith(("http://", "https://")):
                if not (addon_dir / source_url).exists():
                    error(manifest_file, f"note '{nid}': sourceUrl '{source_url}' not found on disk")

        # children references
        for c in m.get("children", []):
            parent, child = c.get("parent"), c.get("child")
            if parent and parent not in note_ids:
                error(manifest_file, f"children: parent '{parent}' not found in notes")
            if not c.get("addon") and child and child not in note_ids:
                error(manifest_file, f"children: child '{child}' not found in notes")

        # relations references
        for rel in m.get("relations", []):
            from_id, to_id = rel.get("from"), rel.get("to")
            if from_id and from_id not in note_ids:
                error(manifest_file, f"relations: from '{from_id}' not found in notes")
            if to_id and not rel.get("addon") and to_id not in note_ids:
                warn(manifest_file, f"relations: to '{to_id}' not found in notes (may be a literal noteId)")

        # labels references
        for label in m.get("labels", []):
            nid = label.get("note")
            if nid and nid not in note_ids:
                error(manifest_file, f"labels: note '{nid}' not found in notes")

        # require()/import targets must be co-installed in the requiring note's subtree
        _validate_require_reachability(manifest_file, m, notes, addon_dir, require_re, import_re, warn)

        # dependencies must be a bare id or {id, manifestSourceUrl}
        deps = m.get("dependencies", [])
        if not isinstance(deps, list):
            error(manifest_file, "manifest.dependencies must be an array")
        else:
            for dep in deps:
                if isinstance(dep, str):
                    continue
                if isinstance(dep, dict) and isinstance(dep.get("id"), str):
                    if not dep.get("manifestSourceUrl"):
                        error(manifest_file, f"dependencies: entry for '{dep['id']}' is missing 'manifestSourceUrl'")
                else:
                    error(manifest_file, f"manifest.dependencies entries must be a string or a {{id, manifestSourceUrl}} object, got: {dep!r}")

    for msg in fixes + warnings + errors:
        print(msg)
    if not (fixes or warnings or errors):
        print(f"OK — {len(manifest_files)} addon(s) validated successfully")
    if errors:
        sys.exit(1)


def _validate_require_reachability(manifest_file, m, notes, addon_dir, require_re, import_re, warn):
    """A code note that require()s/imports another note by title resolves it
    within its own installed subtree. Warn when a target isn't reachable there."""
    id_to_title = {n.get("id") or n.get("title"): n.get("title", "") for n in notes}
    local_titles = {t for t in id_to_title.values() if t}

    local_child_edges, cross_edges = {}, {}
    for c in m.get("children", []):
        parent = c.get("parent")
        if not parent:
            continue
        if c.get("addon"):
            cross_edges.setdefault(parent, []).append((c["addon"], c.get("child")))
        elif c.get("child"):
            local_child_edges.setdefault(parent, []).append(c["child"])

    export_title_cache = {}
    def resolve_export_title(dep_id, export_key):
        key = (dep_id, export_key)
        if key in export_title_cache:
            return export_title_cache[key]
        title = None
        dep_file = Path("addons") / dep_id / MANIFEST_NAME
        if dep_file.exists():
            try:
                dm = json.loads(dep_file.read_text()).get("manifest", {})
                local_id = (dm.get("exports") or {}).get(export_key, export_key)
                for dn in dm.get("notes", []):
                    if (dn.get("id") or dn.get("title")) == local_id:
                        title = dn.get("title")
                        break
            except (json.JSONDecodeError, OSError):
                pass
        export_title_cache[key] = title
        return title

    def descendants(start_id):
        seen, stack = set(), [start_id]
        while stack:
            cur = stack.pop()
            if cur in seen:
                continue
            seen.add(cur)
            stack.extend(local_child_edges.get(cur, []))
        return seen

    for note in notes:
        if note.get("type") != "code":
            continue
        mime = note.get("mime") or ""
        if not (mime.startswith("application/javascript") or "jsx" in mime):
            continue
        source_url = note.get("sourceUrl") or ""
        if not source_url or source_url.startswith(("http://", "https://")):
            continue
        source_path = addon_dir / source_url
        if not source_path.exists():
            continue

        src = source_path.read_text(errors="ignore")
        targets = set(require_re.findall(src)) | set(import_re.findall(src))
        targets = {t for t in targets if t.endswith((".js", ".jsx"))}
        if not targets:
            continue

        nid = note.get("id") or note.get("title")
        subtree = descendants(nid)
        reachable = {id_to_title.get(d, "") for d in subtree}
        for parent_id in subtree:
            for dep_id, child_key in cross_edges.get(parent_id, []):
                t = resolve_export_title(dep_id, child_key)
                if t:
                    reachable.add(t)

        for t in sorted(targets):
            if t in reachable:
                continue
            if t in local_titles:
                warn(manifest_file, f"note '{nid}': require/import of '{t}' resolves to a local note wired outside this note's subtree — it won't be found at runtime")
            else:
                warn(manifest_file, f"note '{nid}': require/import of '{t}' is not installed in this note's subtree — wire the providing addon's export under '{nid}' via children[]")


# ===========================================================================
# tam-to-zip
# ===========================================================================

TRILIUM_APP_VERSION = "0.103.0"


def _safe_name(title):
    return title.replace("/", "-").replace("\\", "-")


def _process_manifest(full_manifest, addon_dir, deps_map):
    """Build ZIP entries for one manifest.
    Returns (root_entry, zip_files, warnings, uuid_map)."""
    m = full_manifest.get("manifest") or {}

    notes_by_id = {n["id"]: n for n in m.get("notes", [])}
    uuid_map    = {lid: "".join(random.choices(ID_CHARS, k=12)) for lid in notes_by_id}

    # A local child listed under >1 parent builds only on first occurrence;
    # later occurrences become isClone references to the same generated noteId.
    children_map, seen_local_children = {}, set()
    for c in m.get("children", []):
        if c.get("addon"):
            continue
        child_lid = c["child"]
        is_clone_ref = child_lid in seen_local_children
        seen_local_children.add(child_lid)
        children_map.setdefault(c["parent"], []).append((child_lid, is_clone_ref))

    dep_children_map = {}
    for c in m.get("children", []):
        if c.get("addon"):
            dep_children_map.setdefault(c["parent"], []).append(c)

    note_labels, note_relations = {}, {}
    for lbl in m.get("labels", []):
        note_labels.setdefault(lbl["note"], []).append(lbl)
    for rel in m.get("relations", []):
        note_relations.setdefault(rel["from"], []).append(rel)

    zip_files, warnings = [], []
    used_bases = {}

    def unique_base(dir_prefix, base):
        return unique_name(base, used_bases.setdefault(dir_prefix, set()))

    def build_entry(local_id, note_position, dir_prefix, note_path):
        note_def   = notes_by_id[local_id]
        note_uuid  = uuid_map[local_id]
        note_type  = note_def.get("type", "text")
        note_mime  = note_def.get("mime", "text/html")
        title      = note_def["title"]

        local_children = children_map.get(local_id, [])
        dep_children   = dep_children_map.get(local_id, [])
        has_children   = bool(local_children or dep_children)
        current_path   = note_path + [note_uuid]

        ext  = ".html" if note_type == "render" else MIME_TO_EXT.get(note_mime, ".html")
        base = unique_base(dir_prefix, _safe_name(title))
        data_name = base if base.lower().endswith(ext.lower()) else base + ext
        dir_name  = base if has_children else None

        # A title carrying its own extension (e.g. "libTAM.js") makes
        # data_name == base == dir_name once it gains a child — impossible on a
        # filesystem/zip. Reserve a second name to disambiguate.
        if dir_name is not None and dir_name == data_name:
            dir_name = unique_base(dir_prefix, dir_name)

        if note_type == "render":
            content = b""
        else:
            source_url = note_def.get("sourceUrl")
            if source_url and not source_url.startswith(("http://", "https://")):
                src = addon_dir / source_url
                if src.exists():
                    content = src.read_bytes()
                else:
                    warnings.append(f"note '{local_id}': sourceUrl '{source_url}' not found — empty content used")
                    content = b""
            elif note_def.get("content") is not None:
                c = note_def["content"]
                content = c.encode() if isinstance(c, str) else c
            else:
                content = b""

        zip_files.append((dir_prefix + data_name, content))
        child_prefix = dir_prefix + dir_name + "/" if dir_name else dir_prefix

        attrs, pos = [], 10
        # Every TAM-managed note carries a permanent #TAMFILEID label
        # ("{addonId}/{localId}") — its sole identity mechanism.
        attrs.append({"type": "label", "name": "TAMFILEID",
                      "value": f"{full_manifest.get('id', '')}/{local_id}",
                      "isInheritable": False, "position": pos})
        pos += 10

        for lbl in note_labels.get(local_id, []):
            attrs.append({"type": "label", "name": lbl["name"], "value": lbl.get("value", ""),
                          "isInheritable": False, "position": pos})
            pos += 10

        for rel in note_relations.get(local_id, []):
            if rel.get("addon"):
                target = (deps_map.get(rel["addon"]) or {}).get(rel["to"])
                if not target:
                    warnings.append(f"relation '{local_id}' type '{rel['type']}': dep '{rel['addon']}' export '{rel['to']}' not resolved — skipped")
                    continue
            else:
                target = uuid_map.get(rel["to"], rel["to"])
            attrs.append({"type": "relation", "name": rel["type"], "value": target,
                          "isInheritable": False, "position": pos})
            pos += 10

        # A Trilium ZIP import walks physical file entries; an isClone meta
        # entry with no backing file is never visited. Mirror Trilium's own
        # exporter: write an empty placeholder file for every clone.
        def clone_entry(note_id, clone_note_path, position):
            clone_name = unique_base(child_prefix, "clone") + ".html"
            zip_files.append((child_prefix + clone_name, b""))
            return {"isClone": True, "noteId": note_id, "notePath": clone_note_path,
                    "notePosition": position, "prefix": None, "isExpanded": False,
                    "dataFileName": clone_name}

        child_entries = []
        for i, (child_lid, is_clone_ref) in enumerate(local_children, start=1):
            if is_clone_ref:
                child_entries.append(clone_entry(uuid_map[child_lid], current_path + [uuid_map[child_lid]], i * 10))
            else:
                child_entries.append(build_entry(child_lid, i * 10, child_prefix, current_path))

        for j, dep_c in enumerate(dep_children, start=len(local_children) + 1):
            dep_note_id = (deps_map.get(dep_c["addon"]) or {}).get(dep_c["child"])
            if not dep_note_id:
                warnings.append(f"child clone: parent '{local_id}' addon '{dep_c['addon']}' export '{dep_c['child']}' not resolved — skipped")
                continue
            child_entries.append(clone_entry(dep_note_id, [dep_note_id], j * 10))

        entry = {"isClone": False, "noteId": note_uuid, "notePath": current_path,
                 "title": title, "notePosition": note_position, "prefix": None,
                 "isExpanded": has_children, "type": note_type, "mime": note_mime,
                 "attributes": attrs, "attachments": [], "dataFileName": data_name}
        if dir_name:
            entry["dirFileName"] = dir_name
        if child_entries:
            entry["children"] = child_entries
        if note_type == "text":
            entry["format"] = "markdown" if note_mime == "text/markdown" else "html"
        return entry

    root_lid   = m["root"]
    root_entry = build_entry(root_lid, 10, "", [])
    if "dirFileName" not in root_entry:
        root_entry["dirFileName"] = _safe_name(notes_by_id[root_lid]["title"])
    return root_entry, zip_files, warnings, uuid_map


def _direct_deps(mf):
    ids = set()
    for c in mf.get("children", []):
        if c.get("addon"):
            ids.add(c["addon"])
    for r in mf.get("relations", []):
        if r.get("addon"):
            ids.add(r["addon"])
    # manifest.dependencies is the source of truth for "must be installed",
    # independent of whether the dep is cloned as a child/relation.
    ids.update(dep_ids(mf))
    return ids


def _build_zip(manifest_path, out_path, addons_dir_arg):
    if not manifest_path.exists():
        sys.exit(f"ERROR: {manifest_path} not found")

    addon_dir     = manifest_path.parent
    full_manifest = json.loads(manifest_path.read_text())
    if out_path is None:
        out_path = addon_dir / f"{full_manifest.get('id', 'export')}.zip"

    m = full_manifest.get("manifest")
    if not m:
        sys.exit("ERROR: no 'manifest' key — metadata-only addons cannot be exported as a Trilium ZIP")
    if not m.get("root"):
        sys.exit("ERROR: manifest.root is required")

    addons_dir = Path(addons_dir_arg) if addons_dir_arg else addon_dir.parent

    def explicit_dep_ids(mf):
        return {d["id"] for d in mf.get("dependencies", []) if isinstance(d, dict)}

    all_warnings = []

    # Discover the full transitive dependency set (deps of deps of ...).
    dep_manifests = {}
    all_explicit_dep_ids = set(explicit_dep_ids(m))
    to_visit, visited = list(_direct_deps(m)), set()
    while to_visit:
        dep_id = to_visit.pop()
        if dep_id in visited:
            continue
        visited.add(dep_id)

        dep_dir   = addons_dir / dep_id
        dep_mpath = dep_dir / MANIFEST_NAME
        if not dep_mpath.exists():
            if dep_id in all_explicit_dep_ids:
                all_warnings.append(f"dep '{dep_id}': declared with an explicit manifestSourceUrl, no local sibling folder — cannot be bundled into an offline ZIP, skipped")
            else:
                all_warnings.append(f"dep '{dep_id}': manifest not found at {dep_mpath} — skipped")
            continue
        dep_full = json.loads(dep_mpath.read_text())
        dep_m    = dep_full.get("manifest") or {}
        if not dep_m.get("root"):
            all_warnings.append(f"dep '{dep_id}': no manifest.root — skipped")
            continue

        dep_manifests[dep_id] = (dep_dir, dep_full, dep_m)
        all_explicit_dep_ids.update(explicit_dep_ids(dep_m))
        to_visit.extend(_direct_deps(dep_m) - visited)

    # Process deps in dependency order so cross-addon children resolve.
    deps_map, dep_root_entries, dep_zip_files = {}, [], []
    remaining = dict(dep_manifests)
    while remaining:
        progressed = False
        for dep_id, (dep_dir, dep_full, dep_m) in list(remaining.items()):
            if not _direct_deps(dep_m).issubset(deps_map.keys()):
                continue
            dep_root, dep_zf, dep_w, dep_uuids = _process_manifest(dep_full, dep_dir, deps_map)
            dep_root_entries.append(dep_root)
            dep_zip_files.extend(dep_zf)
            all_warnings.extend(f"[dep:{dep_id}] {w}" for w in dep_w)
            dep_exports = dep_m.get("exports", {})
            deps_map[dep_id] = {
                exp: dep_uuids[lid] for exp, lid in dep_exports.items() if lid in dep_uuids
            }
            del remaining[dep_id]
            progressed = True
        if not progressed:
            for dep_id in remaining:
                all_warnings.append(f"dep '{dep_id}': could not resolve its own dependencies (cycle or missing) — skipped")
            break

    root_entry, zip_files, warnings, _ = _process_manifest(full_manifest, addon_dir, deps_map)
    all_warnings.extend(warnings)

    trilium_meta = {"formatVersion": 2, "appVersion": TRILIUM_APP_VERSION,
                    "files": [root_entry] + dep_root_entries}
    all_zip_files = zip_files + dep_zip_files

    with zipfile.ZipFile(out_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("!!!meta.json", json.dumps(trilium_meta, indent=2))
        for zip_path, content in all_zip_files:
            zf.writestr(zip_path, content)

    if all_warnings:
        print("Warnings:")
        for w in all_warnings:
            print(f"  {w}")

    skipped     = sum(1 for w in all_warnings if "skipped" in w)
    bundled     = f", {len(dep_root_entries)} dep(s) bundled" if dep_root_entries else ""
    skipped_str = f", {skipped} skipped" if skipped else ""
    print(f"Written: {out_path}  ({len(all_zip_files)} content files{bundled}{skipped_str})")


def cmd_tam_to_zip(args):
    if args.all:
        if args.manifest or args.out:
            sys.exit("ERROR: --all cannot be combined with a manifest path or --out")
        addons_dir = Path(args.addons_dir) if args.addons_dir else Path("addons")
        out_dir    = Path(args.out_dir) if args.out_dir else Path(".")

        manifest_paths = sorted(addons_dir.glob(f"*/{MANIFEST_NAME}"))
        if not manifest_paths:
            sys.exit(f"ERROR: no {MANIFEST_NAME} files found under {addons_dir}")
        for manifest_path in manifest_paths:
            addon_id = json.loads(manifest_path.read_text()).get("id", "export")
            _build_zip(manifest_path, out_dir / f"{addon_id}.zip", args.addons_dir)
        return

    if not args.manifest:
        sys.exit("ERROR: manifest is required unless --all is given")
    manifest_path = Path(args.manifest)
    if manifest_path.is_dir():
        manifest_path = manifest_path / MANIFEST_NAME
    _build_zip(manifest_path, Path(args.out) if args.out else None, args.addons_dir)


# ===========================================================================
# zip-to-tam
# ===========================================================================

def _slugify(title):
    return re.sub(r'[^a-z0-9]+', '-', title.lower()).strip('-') or "note"


def _assign_ids(files_array, id_map, seen_ids):
    """First pass: assign a stable local id to every noteId in the tree."""
    for entry in files_array:
        note_id = entry.get("noteId")
        if note_id is None:
            continue  # noImport scaffold entry
        if note_id not in id_map:
            id_map[note_id] = unique_name(_slugify(entry.get("title", "note")), seen_ids)
        _assign_ids(entry.get("children", []), id_map, seen_ids)


def _walk_entries(files_array, parent_local_id, id_map):
    """Second pass: yield (entry, local_id, parent_local_id, is_clone) in tree order."""
    for entry in files_array:
        note_id = entry.get("noteId")
        if note_id is None:
            continue
        local_id = id_map[note_id]
        yield entry, local_id, parent_local_id, entry.get("isClone", False)
        yield from _walk_entries(entry.get("children", []), local_id, id_map)


def cmd_zip_to_tam(args):
    input_path, out_dir = Path(args.input), Path(args.out)
    if not input_path.exists():
        sys.exit(f"ERROR: {input_path} not found")
    out_dir.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory() as tmpdir:
        tmppath = Path(tmpdir)
        with zipfile.ZipFile(input_path) as zf:
            zf.extractall(tmppath)

        meta_files = list(tmppath.rglob("!!!meta.json"))
        if not meta_files:
            sys.exit("ERROR: no !!!meta.json found in ZIP")
        meta_file = meta_files[0]
        meta_root = meta_file.parent
        meta = json.loads(meta_file.read_text())

        files_array = [f for f in meta.get("files", []) if not f.get("noImport")]
        if not files_array:
            sys.exit("ERROR: !!!meta.json has no 'files' array")

        id_map, seen_ids = {}, set()
        _assign_ids(files_array, id_map, seen_ids)
        root_local_id = id_map[files_array[0]["noteId"]]

        notes, children, relations, labels = [], [], [], []
        used_filenames = set()

        for entry, local_id, parent_local_id, is_clone in _walk_entries(files_array, None, id_map):
            if is_clone:
                if parent_local_id:
                    children.append({"parent": parent_local_id, "child": local_id})
                continue

            note_type = entry.get("type", "text")
            data_file = entry.get("dataFileName")

            source_url = None
            if data_file and not data_file.endswith(".clone.html"):
                data_path = meta_root / data_file
                if not data_path.exists():
                    matches = list(tmppath.rglob(data_file))
                    data_path = matches[0] if matches else None
                if data_path and data_path.exists():
                    dest_name = unique_name(data_file, used_filenames)
                    shutil.copy2(data_path, out_dir / dest_name)
                    source_url = dest_name

            mime = entry.get("mime") or (EXT_TO_MIME.get(Path(data_file).suffix.lower(), "text/plain") if data_file else "text/html")
            note = {"id": local_id, "title": entry.get("title", local_id),
                    "type": note_type, "mime": mime, "sourceUrl": source_url}
            if note_type == "file":
                note["binary"] = True
            notes.append(note)

            if parent_local_id:
                children.append({"parent": parent_local_id, "child": local_id})

            for attr in entry.get("attributes", []):
                if attr.get("type") == "label":
                    labels.append({"note": local_id, "name": attr.get("name", ""), "value": attr.get("value", "")})
                elif attr.get("type") == "relation":
                    relations.append({"from": local_id, "type": attr.get("name", ""),
                                      "to": id_map.get(attr.get("value", ""), attr.get("value", ""))})

        manifest_source_url = detect_manifest_source_url(out_dir)
        manifest = {
            "id": "FILL_IN", "name": "FILL_IN", "description": "FILL_IN",
            "author": "FILL_IN", "homepage": "FILL_IN", "license": "GPL-3.0-or-later",
            "latestVersion": "1.0.0", "type": "widget", "readme": "README.md",
            **({"manifestSourceUrl": manifest_source_url} if manifest_source_url else {}),
            "manifest": {"root": root_local_id, "dependencies": [], "exports": {},
                         "notes": notes, "children": children,
                         "relations": relations, "labels": labels},
        }
        output_file = out_dir / MANIFEST_NAME
        output_file.write_text(json.dumps(manifest, indent=2))

    print(f"Written: {output_file}")
    print(f"  {len(notes)} notes, {len(children)} children, {len(relations)} relations, {len(labels)} labels")
    print("  Search for '\"FILL_IN\"' in _tam_manifest_.json and replace with real values")
    if manifest_source_url:
        print(f"  manifestSourceUrl auto-detected: {manifest_source_url}")
    else:
        print("  manifestSourceUrl NOT set (not inside a git repo with a github.com origin) — fill in by hand before publishing")


# ===========================================================================
# generate-pages / generate-readme (shared addon rendering)
# ===========================================================================

try:
    import markdown
    def _render_md(text):
        return markdown.markdown(text, extensions=["fenced_code", "tables", "toc"])
except ImportError:
    def _render_md(text):
        return f"<pre>{text}</pre>"

REPO        = "https://github.com/BeatLink/trilium-scripts"
RELEASES    = f"{REPO}/releases/latest"
PAGES_URL   = "https://beatlink.github.io/trilium-scripts/"
CATALOG_URL = f"{PAGES_URL}catalog.json"

IMAGE_EXTS  = {".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp"}
TYPE_COLORS = {
    "widget": "#2563eb", "theme": "#7c3aed", "css": "#059669",
    "script": "#d97706", "library": "#0891b2", "template": "#be185d",
}


def _badge(t):
    return f'<span class="badge" style="background:{TYPE_COLORS.get(t, "#6b7280")}">{html.escape(t)}</span>'


def _page(base_html, title, body, css="style.css"):
    return (base_html
            .replace("{{TITLE}}", html.escape(title))
            .replace("{{CSS}}", css)
            .replace("{{BODY}}", body)
            .replace("{{REPO}}", REPO))


# --- Dependency graph -> Mermaid (same shape as TAM's in-browser widget) ----

def _build_dep_graph(addons):
    metas = {a["meta"]["id"]: a["meta"] for a in addons}
    edges = {aid: [d for d in dep_ids(m.get("manifest") or {}) if d in metas] for aid, m in metas.items()}
    return metas, edges


def _node_id(addon_id):
    return "n_" + "".join(c if c.isalnum() else "_" for c in addon_id)


def _mermaid_body(node_ids, edges, metas, focus=None):
    lines = ["flowchart LR"]
    for aid in node_ids:
        label = metas[aid].get("name", aid).replace('"', "'")
        lines.append(f'    {_node_id(aid)}["{label}"]')
    for aid in node_ids:
        for dep in edges.get(aid, []):
            if dep in node_ids:
                lines.append(f"    {_node_id(aid)} --> {_node_id(dep)}")
    for aid in node_ids:
        color = TYPE_COLORS.get(metas[aid].get("type", ""), "#6b7280")
        lines.append(f"    style {_node_id(aid)} fill:{color},stroke:{color},color:#fff")
    if focus:
        lines.append(f"    style {_node_id(focus)} stroke:#0f172a,stroke-width:4px")
    return "\n".join(lines)


def _closure(seed, adjacency):
    seen, stack = set(), [seed]
    while stack:
        cur = stack.pop()
        for nxt in adjacency.get(cur, []):
            if nxt not in seen and nxt != seed:
                seen.add(nxt)
                stack.append(nxt)
    return seen


def _mermaid_for_addon(addon_id, metas, edges):
    dependents = {aid: [] for aid in metas}
    for aid, deps in edges.items():
        for dep in deps:
            dependents[dep].append(aid)
    nodes = {addon_id} | _closure(addon_id, edges) | _closure(addon_id, dependents)
    return _mermaid_body(nodes, edges, metas, focus=addon_id)


def _mermaid_block(source):
    return f'<pre class="mermaid">\n{html.escape(source)}\n</pre>'


def _render_index(base_html, addons):
    types_present = sorted(set(a["meta"].get("type", "") for a in addons if a["meta"].get("type")))
    metas, edges = _build_dep_graph(addons)

    cards = []
    for a in addons:
        m = a["meta"]
        aid, t = m["id"], m.get("type", "")
        name, desc = m.get("name", aid), m.get("description", "")
        author, version = m.get("author", ""), m.get("latestVersion", "")
        cards.append(f"""  <a class="card" href="{html.escape(aid, quote=True)}/" data-type="{html.escape(t, quote=True)}" data-name="{html.escape(name.lower(), quote=True)}" data-desc="{html.escape(desc.lower(), quote=True)}">
    <div class="card-top">
      <span class="card-name">{html.escape(name)}</span>
      {_badge(t)}
    </div>
    <p class="card-desc">{html.escape(desc)}</p>
    <div class="card-foot">
      <span>v{html.escape(version)}</span>
      <span class="card-author" data-author="{html.escape(author, quote=True)}">{html.escape(author)}</span>
    </div>
  </a>""")

    filter_btns = ['<button class="filter active" data-type="all" style="--c:#2563eb">All</button>']
    for t in types_present:
        color = TYPE_COLORS.get(t, "#2563eb")
        filter_btns.append(f'<button class="filter" data-type="{t}" style="--c:{color}">{t.title()}</button>')

    body = f"""<header>
  <div class="hdr">
    <div class="hdr-left">
      <h1>Trilium Addons</h1>
      <p>{len(addons)} addons for <a href="https://github.com/TriliumNext/Notes" target="_blank">TriliumNext Notes</a></p>
    </div>
    <div class="hdr-right">
      <div class="tam-box">
        <span class="tam-label">Add as a Trilium Addon Manager catalog</span>
        <code class="tam-url">{CATALOG_URL}</code>
      </div>
      <div class="hdr-links">
        <a href="{REPO}" target="_blank">GitHub</a>
        <a href="{RELEASES}" target="_blank">Releases</a>
      </div>
    </div>
  </div>
</header>
<main>
  <div class="toolbar">
    <div class="search-wrap">
      <input type="search" id="search" placeholder="Search addons…" autocomplete="off" spellcheck="false">
    </div>
    <div class="filters">
      {" ".join(filter_btns)}
    </div>
  </div>
  <details class="dep-graph">
    <summary>Dependency graph</summary>
    <div class="dep-graph-scroll">
      {_mermaid_block(_mermaid_body(list(metas.keys()), edges, metas))}
    </div>
  </details>
  <div class="grid">
{chr(10).join(cards)}
  </div>
</main>
<script>
(function() {{
  var s = document.getElementById('search');
  var btns = document.querySelectorAll('.filter');
  var cards = document.querySelectorAll('.card');
  var activeType = 'all';
  function run() {{
    var q = s.value.trim().toLowerCase();
    cards.forEach(function(c) {{
      var ok = (activeType === 'all' || c.dataset.type === activeType) &&
               (!q || c.dataset.name.includes(q) || c.dataset.desc.includes(q));
      c.style.display = ok ? '' : 'none';
    }});
  }}
  s.addEventListener('input', run);
  btns.forEach(function(b) {{
    b.addEventListener('click', function() {{
      btns.forEach(function(x) {{ x.classList.remove('active'); }});
      b.classList.add('active');
      activeType = b.dataset.type;
      run();
    }});
  }});
  document.querySelectorAll('.card-author').forEach(function(el) {{
    el.addEventListener('click', function(e) {{
      e.preventDefault();
      e.stopPropagation();
      window.open('https://github.com/' + el.dataset.author, '_blank');
    }});
  }});
}})();
</script>"""
    return _page(base_html, "Trilium Addons — BeatLink", body)


def _render_addon(base_html, meta, readme_html, metas, edges):
    aid     = meta["id"]
    name    = meta.get("name", aid)
    version = meta.get("latestVersion", "—")
    author  = meta.get("author", "—")
    lic     = meta.get("license", "—")
    t       = meta.get("type", "")
    hp      = meta.get("homepage", "")
    zip_url = f"{RELEASES}/download/{aid}.zip"
    manifest_url = meta.get("manifestSourceUrl", "")

    author_display = (
        f'<a href="https://github.com/{html.escape(author, quote=True)}" target="_blank">{html.escape(author)}</a>'
        if author and author != "—" else html.escape(author)
    )

    rows = "".join(
        f"<tr><th>{k}</th><td>{v}</td></tr>"
        for k, v in [
            ("ID",      f"<code>{html.escape(aid)}</code>"),
            ("Version", html.escape(version)),
            ("Author",  author_display),
            ("License", html.escape(lic)),
            ("Type",    html.escape(t)),
        ]
    )

    actions = f'<a class="btn" href="{html.escape(zip_url, quote=True)}">Download ZIP</a>'
    if manifest_url:
        actions += f'\n      <a class="btn btn-ghost" href="{html.escape(manifest_url, quote=True)}" target="_blank">View Manifest</a>'
    if hp:
        actions += f'\n      <a class="btn btn-ghost" href="{html.escape(hp, quote=True)}" target="_blank">Source</a>'

    content = (f'<div class="readme">{readme_html}</div>' if readme_html
               else '<p class="no-readme">No README available.</p>')

    has_edge = bool(edges.get(aid)) or any(aid in deps for deps in edges.values())
    if has_edge:
        content += (
            '<div class="dep-graph-section"><h2>Dependencies</h2>'
            '<div class="dep-graph-scroll">'
            f'{_mermaid_block(_mermaid_for_addon(aid, metas, edges))}'
            '</div></div>'
        )

    body = f"""<header>
  <div class="hdr">
    <a class="back" href="../">← All Addons</a>
    <div class="hdr-name">
      <h1>{html.escape(name)}</h1>
      {_badge(t)}
    </div>
  </div>
</header>
<main>
  <div class="addon-layout">
    <aside class="addon-sidebar">
      <table class="meta-table">{rows}</table>
      <div class="addon-actions">
      {actions}
      </div>
    </aside>
    <div class="addon-content">
      {content}
    </div>
  </div>
</main>"""
    return _page(base_html, f"{name} — Trilium Addons", body, css="../style.css")


def cmd_generate_pages(args):
    static_dir = Path(__file__).resolve().parent.parent / "static" / "pages"
    base_html  = (static_dir / "base.html").read_text()
    css        = (static_dir / "style.css").read_text()

    docs_dir = Path("docs")
    docs_dir.mkdir(exist_ok=True)

    addons = load_addons()
    metas, edges = _build_dep_graph(addons)

    for a in addons:
        aid = a["meta"]["id"]
        page_dir = docs_dir / aid
        page_dir.mkdir(exist_ok=True)
        for f in a["outer_dir"].iterdir():
            if f.is_file() and f.suffix.lower() in IMAGE_EXTS:
                shutil.copy2(f, page_dir / f.name)
        (page_dir / "index.html").write_text(_render_addon(base_html, a["meta"], a["readme_html"], metas, edges))

    (docs_dir / "index.html").write_text(_render_index(base_html, addons))
    (docs_dir / "style.css").write_text(css)
    print(f"Generated docs/ for {len(addons)} addons")

    urls = [a["meta"]["manifestSourceUrl"] for a in addons if a["meta"].get("manifestSourceUrl")]
    missing = len(addons) - len(urls)
    (docs_dir / "catalog.json").write_text(json.dumps({"webUrl": PAGES_URL, "tam-addons": urls}, indent=2) + "\n")
    print(f"Generated docs/catalog.json with {len(urls)} addon(s)" + (f" ({missing} skipped — no manifestSourceUrl)" if missing else ""))


README_START = "<!-- GENERATED:START -->"
README_END   = "<!-- GENERATED:END -->"


def cmd_generate_readme(args):
    base_path = Path("README_base.md")
    if not base_path.exists():
        print("WARNING: README_base.md not found — skipping README generation")
        return
    base = base_path.read_text()

    addons = load_addons()
    rows = []
    for a in sorted(addons, key=lambda x: x["meta"].get("name", x["meta"]["id"]).lower()):
        m = a["meta"]
        name = m.get("name", m["id"])
        t    = m.get("type", "")
        # Escape raw HTML (GitHub embeds it) and markdown table pipes.
        desc = html.escape(m.get("description", "").split("\n")[0]).replace("|", "\\|")
        ver  = m.get("latestVersion", "")
        rows.append(f"| [{name}](addons/{a['outer_dir'].name}/) | {t} | {desc} | {ver} |")

    table = "\n".join([
        "| Name | Type | Description | Version |",
        "|------|------|-------------|---------|",
        *rows,
    ])

    start_idx, end_idx = base.find(README_START), base.find(README_END)
    if start_idx == -1 or end_idx == -1:
        print("WARNING: README_base.md missing GENERATED markers — skipping README generation")
        return
    after_start = start_idx + len(README_START)
    Path("README.md").write_text(base[:after_start] + "\n" + table + "\n" + base[end_idx:])
    print(f"Generated README.md with {len(rows)} addons")


# ===========================================================================
# publish-release
# ===========================================================================

def cmd_publish_release(args):
    sha        = os.environ.get("GITHUB_SHA", "unknown")
    run_number = os.environ.get("GITHUB_RUN_NUMBER", "0")

    files = sorted(str(p) for p in Path(".").glob("*.zip"))
    if not files:
        sys.exit("No *.zip files found to upload")

    notes = f"Auto-published from `{sha}`"

    def publish_to(tag, title, latest):
        subprocess.run(
            ["gh", "release", "create", tag, "--title", title, "--notes", notes,
             *(["--latest"] if latest else [])],
            stderr=subprocess.DEVNULL,
        )
        subprocess.run(["gh", "release", "upload", tag, *files, "--clobber"], check=True)

    # A permanently-addressable release for this exact publish (older-version
    # path), plus the floating 'latest' alias every "download current" link uses.
    publish_to(f"publish-{run_number}", f"Publish {run_number}", latest=False)
    publish_to("latest", "Latest", latest=True)


# ===========================================================================
# backfill-source-url
# ===========================================================================

def cmd_backfill_source_url(args):
    if not Path("addons").is_dir():
        sys.exit("ERROR: no 'addons/' directory — run from repo root")

    updated = skipped = 0
    for manifest_file in iter_manifests():
        url = detect_manifest_source_url(manifest_file.parent)
        if not url:
            print(f"SKIP  {manifest_file}: not detectable (no git repo / no github.com origin)")
            skipped += 1
            continue

        manifest = json.loads(manifest_file.read_text())
        if manifest.get("manifestSourceUrl") == url:
            continue

        # Place manifestSourceUrl right after "readme" (or at the end),
        # matching where zip-to-tam puts it — cosmetic, keeps manifests uniform.
        new_manifest, inserted = {}, False
        for key, value in manifest.items():
            new_manifest[key] = value
            if key == "readme":
                new_manifest["manifestSourceUrl"] = url
                inserted = True
        if not inserted:
            new_manifest["manifestSourceUrl"] = url

        manifest_file.write_text(json.dumps(new_manifest, indent=4) + "\n")
        print(f"SET   {manifest_file}: {url}")
        updated += 1

    print(f"\n{updated} manifest(s) updated, {skipped} skipped")


# ===========================================================================
# CLI
# ===========================================================================

def main():
    parser = argparse.ArgumentParser(
        prog="tamhelper.py",
        description="TAM addon toolchain — validate, build, and publish addons.",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("validate", help="Lint every addon manifest")
    p.add_argument("--fix", action="store_true", help="Auto-fix fixable issues (e.g. homepage suffix)")
    p.set_defaults(func=cmd_validate)

    p = sub.add_parser("tam-to-zip", help="Convert a manifest (or --all) to a Trilium ZIP")
    p.add_argument("manifest", nargs="?", help=f"{MANIFEST_NAME} path or its directory (omit with --all)")
    p.add_argument("--out", help="Output ZIP path (default: {id}.zip next to the manifest)")
    p.add_argument("--addons-dir", metavar="DIR", help="addons/ dir for resolving deps (default: parent of the addon dir, or 'addons' with --all)")
    p.add_argument("--all", action="store_true", help=f"Build a ZIP for every addon under --addons-dir")
    p.add_argument("--out-dir", metavar="DIR", help="Directory to write each {id}.zip into with --all (default: current dir)")
    p.set_defaults(func=cmd_tam_to_zip)

    p = sub.add_parser("zip-to-tam", help="Convert a Trilium export ZIP to a manifest + source files")
    p.add_argument("input", help="Trilium export ZIP file")
    p.add_argument("--out", default=".", help="Output directory (default: current dir)")
    p.set_defaults(func=cmd_zip_to_tam)

    p = sub.add_parser("generate-pages", help="Build the GitHub Pages site (docs/, incl. catalog.json)")
    p.set_defaults(func=cmd_generate_pages)

    p = sub.add_parser("generate-readme", help="Regenerate README.md's addon table")
    p.set_defaults(func=cmd_generate_readme)

    p = sub.add_parser("publish-release", help="Upload built *.zip files to GitHub Releases")
    p.set_defaults(func=cmd_publish_release)

    p = sub.add_parser("backfill-source-url", help="Add manifestSourceUrl to every manifest missing one")
    p.set_defaults(func=cmd_backfill_source_url)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
