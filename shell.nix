{ pkgs ? import <nixpkgs> {} }:

pkgs.mkShell {
  packages = [ pkgs.python3 ];

  shellHook = ''
    validate() { python3 .github/workflows/validate.py "$@"; }
    strip()    { python3 .github/workflows/strip_no_import.py "$@"; }
    publish()  { python3 .github/workflows/publish.py "$@"; }
    ci()       { validate && strip && publish; }

    export -f validate strip publish ci

    echo ""
    echo "  Trilium Scripts Dev Shell"
    echo ""
    echo "  validate   Validate addon structure"
    echo "  strip      Strip noImport files"
    echo "  publish    Merge and zip addons"
    echo "  ci         Run all three in sequence"
    echo ""
  '';
}
