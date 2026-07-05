{ pkgs ? import <nixpkgs> {} }:

pkgs.mkShell {
  packages = [
    (pkgs.python3.withPackages (ps: [ ps.markdown ]))
    pkgs.gh
  ];

  shellHook = ''
    validate()          { python3 resources/scripts/validate.py "$@"; }
    tam_to_manifest()   { python3 resources/scripts/tam_to_manifest.py "$@"; }
    ci()                { validate && tam_to_manifest; }
    generate_pages()    { python3 resources/scripts/generate_pages.py "$@"; }
    zip_to_tam()        { python3 resources/scripts/zip_to_tam.py "$@"; }
    tam_to_zip()        { python3 resources/scripts/tam_to_zip.py "$@"; }
    publish_release()   { python3 resources/scripts/publish_release.py "$@"; }

    export -f validate tam_to_manifest ci generate_pages zip_to_tam tam_to_zip publish_release

    echo ""
    echo "  Trilium Scripts Dev Shell"
    echo ""
    echo "  validate                  Validate addon structure"
    echo "  tam_to_manifest           Build per-addon .json files and metadata.json registry"
    echo "  ci                        Run validate then tam_to_manifest"
    echo "  zip_to_tam <zip>          Convert Trilium export ZIP to _tam_manifest_.json"
    echo "  tam_to_zip <manifest>     Convert _tam_manifest_.json to a Trilium ZIP import"
    echo "  tam_to_zip --all          Convert every addon's manifest to a ZIP (used by CI)"
    echo "  generate_pages            Build GitHub Pages site (docs/) and README.md"
    echo "  publish_release           Upload *.json/*.zip to the 'latest' GitHub release (used by CI)"
    echo ""
  '';
}
