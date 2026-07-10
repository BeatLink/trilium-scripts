# Commands

Inside `nix-shell`:

```bash
validate                       # lint all manifests — closest thing to a test suite; run after any manifest/source edit
tam_to_zip <manifest-dir>      # manifest -> Trilium-importable ZIP
zip_to_tam <zip>                # Trilium export ZIP -> starting manifest + source files
generate_pages                 # rebuild docs/ + README.md
```

Testing against a live instance: `nix develop`, `trilium_seed` (once), `trilium_server start`
(serves http://127.0.0.1:8090 from an in-memory snapshot — never corrupts it). See
`resources/testing/README.md`.
