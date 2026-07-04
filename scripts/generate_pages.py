#!/usr/bin/env python3
"""Generate GitHub Pages from addon metadata and README files."""

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

REPO      = "https://github.com/BeatLink/trilium-scripts"
RELEASES  = f"{REPO}/releases/latest"
META_URL  = f"{RELEASES}/download/metadata.json"
TAM_REPO  = "BeatLink/trilium-scripts"

IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp"}

TYPE_COLORS = {
    "widget": "#2563eb",
    "theme":  "#7c3aed",
    "css":    "#059669",
    "script": "#d97706",
}


# ---------------------------------------------------------------------------
# HTML primitives
# ---------------------------------------------------------------------------

def badge(t):
    color = TYPE_COLORS.get(t, "#6b7280")
    return f'<span class="badge" style="background:{color}">{t}</span>'


def page(title, body, css="style.css"):
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{title}</title>
  <link rel="stylesheet" href="{css}">
</head>
<body>
{body}
<footer><p>Generated from <a href="{REPO}" target="_blank">BeatLink/trilium-scripts</a></p></footer>
</body>
</html>"""


# ---------------------------------------------------------------------------
# Index page
# ---------------------------------------------------------------------------

def render_index(addons):
    import html as _html

    types_present = sorted(set(a["meta"].get("type", "") for a in addons if a["meta"].get("type")))

    cards = []
    for a in addons:
        m   = a["meta"]
        aid = m["id"]
        t   = m.get("type", "")
        cards.append(f"""  <a class="card" href="{aid}/" data-type="{t}" data-name="{_html.escape(m.get("name", aid).lower(), quote=True)}" data-desc="{_html.escape(m.get("description", "").lower(), quote=True)}">
    <div class="card-top">
      <span class="card-name">{m.get("name", aid)}</span>
      {badge(t)}
    </div>
    <p class="card-desc">{m.get("description", "")}</p>
    <div class="card-foot">
      <span>v{m.get("latestVersion", "")}</span>
      <span>{m.get("author", "")}</span>
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
        <span class="tam-label">Add to Trilium Addon Manager</span>
        <code class="tam-url">{TAM_REPO}</code>
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
}})();
</script>"""

    return page("Trilium Addons — BeatLink", body)


# ---------------------------------------------------------------------------
# Per-addon page
# ---------------------------------------------------------------------------

def render_addon(meta, readme_html):
    aid     = meta["id"]
    name    = meta.get("name", aid)
    version = meta.get("latestVersion", "—")
    author  = meta.get("author", "—")
    lic     = meta.get("license", "—")
    t       = meta.get("type", "")
    hp      = meta.get("homepage", "")
    zip_url = f"{RELEASES}/download/{aid}.json"

    rows = "".join(
        f"<tr><th>{k}</th><td>{v}</td></tr>"
        for k, v in [
            ("ID",      f"<code>{aid}</code>"),
            ("Version", version),
            ("Author",  author),
            ("License", lic),
            ("Type",    t),
        ]
    )

    actions = f'<a class="btn" href="{zip_url}">Download Manifest</a>'
    if hp:
        actions += f'\n      <a class="btn btn-ghost" href="{hp}" target="_blank">Source</a>'

    content = (
        f'<div class="readme">{readme_html}</div>'
        if readme_html
        else '<p class="no-readme">No README available.</p>'
    )

    body = f"""<header>
  <div class="hdr">
    <a class="back" href="../">← All Addons</a>
    <div class="hdr-name">
      <h1>{name}</h1>
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
# CSS
# ---------------------------------------------------------------------------

CSS = """\
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  font-size: 15px;
  line-height: 1.6;
  color: #1a1a2e;
  background: #f1f5f9;
}

a { color: #2563eb; text-decoration: none; }
a:hover { text-decoration: underline; }

/* Header */
header {
  background: linear-gradient(135deg, #0f172a, #1e3a5f);
  color: #fff;
  padding: 28px 0;
}
.hdr {
  max-width: 1100px;
  margin: 0 auto;
  padding: 0 24px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 24px;
  flex-wrap: wrap;
}
header h1 { font-size: 26px; font-weight: 700; letter-spacing: -0.4px; }
header p  { color: #94a3b8; margin-top: 4px; font-size: 14px; }
header p a { color: #93c5fd; }

.hdr-right { display: flex; flex-direction: column; align-items: flex-end; gap: 10px; }

.tam-box {
  background: rgba(255,255,255,0.06);
  border: 1px solid rgba(255,255,255,0.12);
  border-radius: 6px;
  padding: 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.tam-label { font-size: 10px; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.06em; }
.tam-url {
  font-family: "SFMono-Regular", Consolas, monospace;
  font-size: 12px;
  color: #e2e8f0;
  word-break: break-all;
  user-select: all;
}

.hdr-links { display: flex; gap: 16px; }
.hdr-links a { color: #93c5fd; font-size: 13px; }

/* Badge */
.badge {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #fff;
  padding: 2px 8px;
  border-radius: 10px;
  white-space: nowrap;
  flex-shrink: 0;
}

/* Main */
main { max-width: 1100px; margin: 0 auto; padding: 28px 24px; }

/* Card grid */
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(270px, 1fr));
  gap: 14px;
}
.card {
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 16px 18px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  color: inherit;
  transition: box-shadow 0.15s, border-color 0.15s;
}
.card:hover { box-shadow: 0 4px 14px rgba(0,0,0,0.09); border-color: #93c5fd; text-decoration: none; }
.card-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.card-name { font-size: 15px; font-weight: 600; color: #0f172a; }
.card-desc { font-size: 13px; color: #64748b; flex: 1; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.card-foot { display: flex; justify-content: space-between; font-size: 12px; color: #94a3b8; border-top: 1px solid #f1f5f9; padding-top: 10px; margin-top: auto; }

/* Addon detail */
.back { color: #93c5fd; font-size: 13px; display: block; margin-bottom: 10px; }
.hdr-name { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }

.addon-layout { display: grid; grid-template-columns: 220px 1fr; gap: 28px; align-items: start; }

.addon-sidebar {
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 16px;
  position: sticky;
  top: 16px;
}
.meta-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.meta-table th { color: #64748b; font-weight: 500; text-align: left; padding: 5px 12px 5px 0; white-space: nowrap; width: 1%; }
.meta-table td { color: #0f172a; padding: 5px 0; word-break: break-word; }
.meta-table tr + tr th, .meta-table tr + tr td { border-top: 1px solid #f1f5f9; }
.meta-table code { font-size: 11px; background: #f1f5f9; padding: 1px 4px; border-radius: 3px; }

.addon-actions { margin-top: 14px; display: flex; flex-direction: column; gap: 8px; }
.btn { display: block; text-align: center; padding: 8px 14px; border-radius: 6px; font-size: 13px; font-weight: 500; background: #2563eb; color: #fff !important; transition: opacity 0.15s; }
.btn:hover { opacity: 0.85; text-decoration: none; }
.btn-ghost { background: transparent; color: #2563eb !important; border: 1px solid #2563eb; }

/* README */
.readme { background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 24px 28px; }
.readme h1 { font-size: 21px; margin-bottom: 12px; border-bottom: 1px solid #e2e8f0; padding-bottom: 8px; }
.readme h2 { font-size: 17px; margin: 20px 0 8px; }
.readme h3 { font-size: 14px; font-weight: 600; margin: 14px 0 6px; }
.readme p  { margin-bottom: 12px; }
.readme ul, .readme ol { margin: 0 0 12px 20px; }
.readme li { margin-bottom: 3px; }
.readme a  { color: #2563eb; }
.readme code { font-family: "SFMono-Regular", Consolas, monospace; font-size: 12px; background: #f1f5f9; padding: 1px 5px; border-radius: 3px; }
.readme pre { background: #0f172a; color: #e2e8f0; padding: 16px; border-radius: 6px; overflow-x: auto; margin: 12px 0; font-size: 12px; line-height: 1.5; }
.readme pre code { background: none; padding: 0; color: inherit; }
.readme img { max-width: 100%; border-radius: 6px; margin: 8px 0; display: block; }
.readme table { border-collapse: collapse; margin: 12px 0; width: 100%; font-size: 13px; }
.readme th, .readme td { border: 1px solid #e2e8f0; padding: 6px 12px; }
.readme th { background: #f8fafc; font-weight: 600; }
.readme blockquote { border-left: 3px solid #e2e8f0; margin: 12px 0; padding: 4px 16px; color: #64748b; }
.no-readme { color: #94a3b8; font-style: italic; }

/* Footer */
footer { text-align: center; padding: 24px; font-size: 13px; color: #94a3b8; border-top: 1px solid #e2e8f0; margin-top: 40px; }
footer a { color: #64748b; }

/* Toolbar */
.toolbar { display: flex; gap: 10px; align-items: center; margin-bottom: 24px; flex-wrap: wrap; }
.search-wrap { position: relative; flex: 1; min-width: 200px; }
.search-wrap::before {
  content: '';
  position: absolute;
  left: 11px;
  top: 50%;
  transform: translateY(-50%);
  width: 15px;
  height: 15px;
  background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%2394a3b8' stroke-width='2.5'%3E%3Ccircle cx='11' cy='11' r='8'/%3E%3Cpath d='m21 21-4.35-4.35'/%3E%3C/svg%3E") center/contain no-repeat;
  pointer-events: none;
}
#search {
  width: 100%;
  padding: 9px 12px 9px 34px;
  border: 1.5px solid #e2e8f0;
  border-radius: 8px;
  font-size: 14px;
  color: #0f172a;
  background: #fff;
  outline: none;
  transition: border-color 0.15s, box-shadow 0.15s;
}
#search:focus { border-color: #2563eb; box-shadow: 0 0 0 3px rgba(37,99,235,0.12); }
#search::placeholder { color: #94a3b8; }
.filters { display: flex; gap: 6px; flex-wrap: wrap; }
.filter {
  padding: 7px 16px;
  border-radius: 20px;
  border: 1.5px solid #e2e8f0;
  background: #fff;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.03em;
  cursor: pointer;
  color: #64748b;
  transition: background 0.15s, border-color 0.15s, color 0.15s;
  white-space: nowrap;
  text-transform: uppercase;
}
.filter:hover { border-color: var(--c, #2563eb); color: var(--c, #2563eb); }
.filter.active { background: var(--c, #2563eb); border-color: var(--c, #2563eb); color: #fff; }

/* Responsive */
@media (max-width: 768px) {
  .hdr { flex-direction: column; align-items: flex-start; }
  .hdr-right { align-items: flex-start; }
  .addon-layout { grid-template-columns: 1fr; }
  .addon-sidebar { position: static; }
}
"""


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
        desc = m.get("description", "").split("\n")[0]
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

    generate_readme(addons)


if __name__ == "__main__":
    main()
