#!/usr/bin/env python3
"""Regenerate README.md's addon table from addon metadata."""

import html
from pathlib import Path

from generate_pages import load_addons

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


def main():
    generate_readme(load_addons())


if __name__ == "__main__":
    main()
