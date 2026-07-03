{ pkgs ? import <nixpkgs> {} }:

pkgs.mkShell {
  packages = [
    (pkgs.python3.withPackages (ps: [ ps.markdown ]))
  ];

  shellHook = ''
    validate()        { python3 scripts/validate.py "$@"; }
    strip()           { python3 scripts/strip_no_import.py "$@"; }
    publish()         { python3 scripts/publish.py "$@"; }
    ci()              { validate && publish; }
    import_addon()    { python3 scripts/import_addon.py "$@"; }
    generate_pages()  { python3 scripts/generate_pages.py "$@"; }
    convert_zip()     { python3 scripts/convert_zip.py "$@"; }

    export -f validate strip publish ci import_addon generate_pages convert_zip

    echo ""
    echo "  Trilium Scripts Dev Shell"
    echo ""
    echo "  validate                  Validate addon structure"
    echo "  publish                   Build per-addon .json files and metadata.json registry"
    echo "  ci                        Run validate then publish"
    echo "  import_addon <zip>        Import a Trilium export ZIP into addons/"
    echo "  convert_zip <zip>         Convert Trilium export ZIP to _tam_manifest_.json"
    echo "  generate_pages            Build GitHub Pages site (docs/) and README.md"
    echo ""
  '';
}
