#!/usr/bin/env python3
"""Generate GitHub Pages from addon metadata and README files."""

import html
import json
import shutil
import sys
from pathlib import Path

try:
    import markdown
    def render_md(text):
        return markdown.markdown(text, extensions=["fenced_code", "tables", "toc"])
except ImportError:
    print("WARNING: 'markdown' package not installed — pip install markdown")
    def render_md(text):
        return f"<pre>{text}</pre>"

REPO       = "https://github.com/BeatLink/trilium-scripts"
RELEASES   = f"{REPO}/releases/latest"
PAGES_URL   = "https://beatlink.github.io/trilium-scripts/"
CATALOG_URL = f"{PAGES_URL}catalog.json"

STATIC_DIR = Path(__file__).resolve().parent.parent / "static" / "pages"
BASE_HTML  = (STATIC_DIR / "base.html").read_text()
CSS        = (STATIC_DIR / "style.css").read_text()

IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp"}

TYPE_COLORS = {
    "widget":   "#2563eb",
    "theme":    "#7c3aed",
    "css":      "#059669",
    "script":   "#d97706",
    "library":  "#0891b2",
    "template": "#be185d",
}


# ---------------------------------------------------------------------------
# HTML primitives
# ---------------------------------------------------------------------------

def badge(t):
    color = TYPE_COLORS.get(t, "#6b7280")
    return f'<span class="badge" style="background:{color}">{html.escape(t)}</span>'


def page(title, body, css="style.css"):
    return (
        BASE_HTML
        .replace("{{TITLE}}", html.escape(title))
        .replace("{{CSS}}", css)
        .replace("{{BODY}}", body)
        .replace("{{REPO}}", REPO)
    )


# ---------------------------------------------------------------------------
# Dependency graph -> Mermaid
#
# The mermaid *source* built here is intentionally the same shape TAM's own
# widget builds in the browser (TAMShared.jsx's buildDependencyMermaid), so the
# GitHub Pages catalog and the in-Trilium UI render an identical diagram from
# the same edges — one is fed on-disk manifests, the other the live Database.
# ---------------------------------------------------------------------------

def _dep_ids(meta):
    """Bare dependency ids declared by an addon's manifest (string or {id,...})."""
    deps = (meta.get("manifest") or {}).get("dependencies") or []
    return [d if isinstance(d, str) else d.get("id") for d in deps if (d if isinstance(d, str) else d.get("id"))]


def build_dep_graph(addons):
    """{id -> meta}, {id -> [dep ids]} (edges kept only when both ends exist)."""
    metas = {a["meta"]["id"]: a["meta"] for a in addons}
    edges = {aid: [d for d in _dep_ids(m) if d in metas] for aid, m in metas.items()}
    return metas, edges


def _node_id(addon_id):
    """A mermaid-safe node id — mermaid chokes on '@' and '-' in bare ids."""
    return "n_" + "".join(c if c.isalnum() else "_" for c in addon_id)


def _mermaid_body(node_ids, edges, metas, focus=None):
    """Shared node/edge/style emission for a set of node ids to include."""
    lines = ["flowchart LR"]
    for aid in node_ids:
        # Quote the label so names with spaces/punctuation survive; drop any
        # embedded double-quote, which would otherwise close the mermaid string.
        label = metas[aid].get("name", aid).replace('"', "'")
        lines.append(f'    {_node_id(aid)}["{label}"]')
    for aid in node_ids:
        for dep in edges.get(aid, []):
            if dep in node_ids:
                lines.append(f"    {_node_id(aid)} --> {_node_id(dep)}")
    # Colour every node by its addon type, matching the catalog badge palette.
    for aid in node_ids:
        color = TYPE_COLORS.get(metas[aid].get("type", ""), "#6b7280")
        lines.append(f"    style {_node_id(aid)} fill:{color},stroke:{color},color:#fff")
    if focus:
        lines.append(f"    style {_node_id(focus)} stroke:#0f172a,stroke-width:4px")
    return "\n".join(lines)


def mermaid_full(metas, edges):
    """Whole-catalog diagram: every addon, every in-catalog dependency edge."""
    return _mermaid_body(list(metas.keys()), edges, metas)


def _closure(seed, adjacency):
    """Transitive set reachable from seed through adjacency (excludes seed)."""
    seen, stack = set(), [seed]
    while stack:
        cur = stack.pop()
        for nxt in adjacency.get(cur, []):
            if nxt not in seen and nxt != seed:
                seen.add(nxt)
                stack.append(nxt)
    return seen


def mermaid_for_addon(addon_id, metas, edges):
    """Focused subgraph: the addon plus its transitive deps and dependents."""
    # Reverse edges: who depends on X.
    dependents = {aid: [] for aid in metas}
    for aid, deps in edges.items():
        for dep in deps:
            dependents[dep].append(aid)
    nodes = {addon_id} | _closure(addon_id, edges) | _closure(addon_id, dependents)
    return _mermaid_body(nodes, edges, metas, focus=addon_id)


def mermaid_block(source):
    """Wrap mermaid source in the <pre class="mermaid"> the page script renders."""
    return f'<pre class="mermaid">\n{html.escape(source)}\n</pre>'


# ---------------------------------------------------------------------------
# Index page
# ---------------------------------------------------------------------------

def render_index(addons):
    types_present = sorted(set(a["meta"].get("type", "") for a in addons if a["meta"].get("type")))
    metas, edges = build_dep_graph(addons)

    cards = []
    for a in addons:
        m       = a["meta"]
        aid     = m["id"]
        t       = m.get("type", "")
        name    = m.get("name", aid)
        desc    = m.get("description", "")
        author  = m.get("author", "")
        version = m.get("latestVersion", "")
        cards.append(f"""  <a class="card" href="{html.escape(aid, quote=True)}/" data-type="{html.escape(t, quote=True)}" data-name="{html.escape(name.lower(), quote=True)}" data-desc="{html.escape(desc.lower(), quote=True)}">
    <div class="card-top">
      <span class="card-name">{html.escape(name)}</span>
      {badge(t)}
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
      {mermaid_block(mermaid_full(metas, edges))}
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

    return page("Trilium Addons — BeatLink", body)


# ---------------------------------------------------------------------------
# Per-addon page
# ---------------------------------------------------------------------------

def render_addon(meta, readme_html, metas, edges):
    aid          = meta["id"]
    name         = meta.get("name", aid)
    version      = meta.get("latestVersion", "—")
    author       = meta.get("author", "—")
    lic          = meta.get("license", "—")
    t            = meta.get("type", "")
    hp           = meta.get("homepage", "")
    zip_url      = f"{RELEASES}/download/{aid}.zip"
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

    content = (
        f'<div class="readme">{readme_html}</div>'
        if readme_html
        else '<p class="no-readme">No README available.</p>'
    )

    # Dependency subgraph — only when this addon actually has a dep or a dependent.
    has_edge = bool(edges.get(aid)) or any(aid in deps for deps in edges.values())
    if has_edge:
        content += (
            '<div class="dep-graph-section">'
            '<h2>Dependencies</h2>'
            '<div class="dep-graph-scroll">'
            f'{mermaid_block(mermaid_for_addon(aid, metas, edges))}'
            '</div></div>'
        )

    body = f"""<header>
  <div class="hdr">
    <a class="back" href="../">← All Addons</a>
    <div class="hdr-name">
      <h1>{html.escape(name)}</h1>
      {badge(t)}
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

    return page(f"{name} — Trilium Addons", body, css="../style.css")


# ---------------------------------------------------------------------------
# TAM catalog (the {"tam-addons": [...]} format TAM's "add catalog" reads)
# ---------------------------------------------------------------------------

def generate_catalog(addons, docs_dir):
    urls = [a["meta"]["manifestSourceUrl"] for a in addons if a["meta"].get("manifestSourceUrl")]
    missing = len(addons) - len(urls)
    catalog = {"webUrl": PAGES_URL, "tam-addons": urls}
    (docs_dir / "catalog.json").write_text(json.dumps(catalog, indent=2) + "\n")
    print(f"Generated docs/catalog.json with {len(urls)} addon(s)" + (f" ({missing} skipped — no manifestSourceUrl)" if missing else ""))


# ---------------------------------------------------------------------------
# Addon loading (shared with generate_readme.py)
# ---------------------------------------------------------------------------

def load_addons():
    """Parse every addon manifest under addons/ into {meta, readme_html, outer_dir}."""
    addons_dir = Path("addons")
    if not addons_dir.is_dir():
        print("ERROR: no 'addons/' directory — run from repo root")
        sys.exit(1)

    addons = []
    for meta_file in sorted(addons_dir.glob("*/_tam_manifest_.json")):
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
        if readme_rel:
            readme_path = outer_dir / readme_rel
            if readme_path.exists():
                readme_html = render_md(readme_path.read_text())

        addons.append({"meta": meta, "readme_html": readme_html, "outer_dir": outer_dir})

    return addons


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    docs_dir = Path("docs")
    docs_dir.mkdir(exist_ok=True)

    addons = load_addons()
    metas, edges = build_dep_graph(addons)

    # Per-addon pages
    for a in addons:
        aid      = a["meta"]["id"]
        page_dir = docs_dir / aid
        page_dir.mkdir(exist_ok=True)

        # Copy images so README-relative paths resolve correctly
        for f in a["outer_dir"].iterdir():
            if f.is_file() and f.suffix.lower() in IMAGE_EXTS:
                shutil.copy2(f, page_dir / f.name)

        (page_dir / "index.html").write_text(render_addon(a["meta"], a["readme_html"], metas, edges))

    (docs_dir / "index.html").write_text(render_index(addons))
    (docs_dir / "style.css").write_text(CSS)

    print(f"Generated docs/ for {len(addons)} addons")

    generate_catalog(addons, docs_dir)


if __name__ == "__main__":
    main()
