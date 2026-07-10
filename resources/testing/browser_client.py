"""Playwright-driven browser layer on top of the headless trilium_client.py API.

Some things TAM does (fetching a manifest, running `require()`-bundled frontend JSX
widgets, dispatching UI commands) only happen in frontend-env code, which
/api/script/exec can't execute (it only runs backend-env bundles — see
exec_script()'s docstring). To exercise those, drive a real Chromium instance
against the running trilium-server instead.

Usage:
    from browser_client import launch
    with launch() as page:
        page.goto_note(some_note_id)
        page.enable_render_note()  # dismiss the "untrusted render note" warning once
"""
import os
import time
from contextlib import contextmanager

from playwright.sync_api import sync_playwright

PORT = int(os.environ.get("TRILIUM_TESTING_PORT", "8090"))
BASE_URL = f"http://127.0.0.1:{PORT}"

# PLAYWRIGHT_BROWSERS_PATH / PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS are set by
# shell.nix's shellHook (pointing at pkgs.playwright-driver.browsers, matched to the
# pinned `playwright` Python package's expected browser revision) so `playwright
# install` — which tries to download into $HOME/.cache and fails offline/in a
# sandbox — is never needed inside `nix develop`/`nix-shell`.


class TriliumPage:
    """Thin wrapper around a Playwright Page pre-aimed at this trilium-server."""

    def __init__(self, page):
        self.page = page

    def goto_note(self, note_id, wait_seconds=3):
        self.page.goto(f"{BASE_URL}/#root/{note_id}", wait_until="networkidle")
        time.sleep(wait_seconds)
        return self

    def enable_render_note(self, wait_seconds=3):
        """Dismiss the "this render note comes from an external source" trust
        warning Trilium shows the first time a render-type note is opened.
        No-op if the note is already trusted (or isn't a render note)."""
        btns = self.page.get_by_role("button", name="Enable render note")
        if btns.count() > 0:
            btns.first.click(force=True)
            time.sleep(wait_seconds)
        return self

    def __getattr__(self, name):
        return getattr(self.page, name)


@contextmanager
def launch(headless=True):
    """Yields a TriliumPage against a fresh Chromium instance. Closes the
    browser on exit (including on exception)."""
    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--no-sandbox"], headless=headless)
        page = browser.new_page()
        try:
            yield TriliumPage(page)
        finally:
            browser.close()
