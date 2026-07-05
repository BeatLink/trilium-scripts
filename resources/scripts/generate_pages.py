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
CATALOG_URL = "https://beatlink.github.io/trilium-scripts/catalog.json"

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
# Index page
# ---------------------------------------------------------------------------

def render_index(addons):
    types_present = sorted(set(a["meta"].get("type", "") for a in addons if a["meta"].get("type")))

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

def render_addon(meta, readme_html):
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
    (docs_dir / "catalog.json").write_text(json.dumps({"tam-addons": urls}, indent=2) + "\n")
    print(f"Generated docs/catalog.json with {len(urls)} addon(s)" + (f" ({missing} skipped — no manifestSourceUrl)" if missing else ""))


# ---------------------------------------------------------------------------
# README generator
# ---------------------------------------------------------------------------

README_START = "<!-- GENERATED:START -->"
README_END   = "<!-- GENERATED:END -->"


def generate_readme(addons):
    base_path = Path("README_base.md")
    if not base_path.exists():
        print("WARNING: README_base.md not found — skipping README generation")
        return

    base = base_path.read_text()

    rows = []
    for a in sorted(addons, key=lambda x: x["meta"].get("name", x["meta"]["id"]).lower()):
        m    = a["meta"]
        aid  = m["id"]
        name = m.get("name", aid)
        t    = m.get("type", "")
        # Escape raw HTML (GitHub's markdown renderer embeds it, so an
        # unclosed tag like a literal "<details>" in a description would
        # swallow the rest of the table) and markdown table pipes.
        desc = html.escape(m.get("description", "").split("\n")[0]).replace("|", "\\|")
        ver  = m.get("latestVersion", "")
        link = f"[{name}](addons/{a['outer_dir'].name}/)"
        rows.append(f"| {link} | {t} | {desc} | {ver} |")

    table = "\n".join([
        "| Name | Type | Description | Version |",
        "|------|------|-------------|---------|",
        *rows,
    ])

    start_idx = base.find(README_START)
    end_idx   = base.find(README_END)

    if start_idx == -1 or end_idx == -1:
        print("WARNING: README_base.md missing GENERATED markers — skipping README generation")
        return

    after_start = start_idx + len(README_START)
    new_readme  = base[:after_start] + "\n" + table + "\n" + base[end_idx:]

    Path("README.md").write_text(new_readme)
    print(f"Generated README.md with {len(rows)} addons")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    addons_dir = Path("addons")
    docs_dir   = Path("docs")

    if not addons_dir.is_dir():
        print("ERROR: no 'addons/' directory — run from repo root")
        sys.exit(1)

    docs_dir.mkdir(exist_ok=True)

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

    # Per-addon pages
    for a in addons:
        aid      = a["meta"]["id"]
        page_dir = docs_dir / aid
        page_dir.mkdir(exist_ok=True)

        # Copy images so README-relative paths resolve correctly
        for f in a["outer_dir"].iterdir():
            if f.is_file() and f.suffix.lower() in IMAGE_EXTS:
                shutil.copy2(f, page_dir / f.name)

        (page_dir / "index.html").write_text(render_addon(a["meta"], a["readme_html"]))

    (docs_dir / "index.html").write_text(render_index(addons))
    (docs_dir / "style.css").write_text(CSS)

    print(f"Generated docs/ for {len(addons)} addons")

    generate_catalog(addons, docs_dir)
    generate_readme(addons)


if __name__ == "__main__":
    main()
