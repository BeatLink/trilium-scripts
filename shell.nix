{ pkgs ? import <nixpkgs> {} }:

pkgs.mkShell {
  packages = [
    (pkgs.python3.withPackages (ps: [ ps.markdown ]))
  ];

  shellHook = ''
    validate()     { python3 scripts/validate.py "$@"; }
    strip()        { python3 scripts/strip_no_import.py "$@"; }
    publish()      { python3 scripts/publish.py "$@"; }
    ci()           { validate && strip && publish; }
    import_addon()    { python3 scripts/import_addon.py "$@"; }
    generate_pages()  { python3 scripts/generate_pages.py "$@"; }

    export -f validate strip publish ci import_addon generate_pages

    echo ""
    echo "  Trilium Scripts Dev Shell"
    echo ""
    echo "  validate                  Validate addon structure"
    echo "  strip                     Strip noImport files"
    echo "  publish                   Merge and zip addons"
    echo "  ci                        Run all three in sequence"
    echo "  import_addon <zip>        Import a Trilium export ZIP into addons/"
    echo "  generate_pages            Build GitHub Pages site into docs/"
    echo ""
  '';
}
