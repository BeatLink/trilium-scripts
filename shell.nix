{ pkgs ? import <nixpkgs> {} }:

pkgs.mkShell {
  packages = [
    (pkgs.python3.withPackages (ps: [ ps.markdown ]))
    pkgs.gh
  ];

  shellHook = ''
    validate()          { python3 resources/scripts/validate.py "$@"; }
    strip()             { python3 resources/scripts/strip_no_import.py "$@"; }
    publish()           { python3 resources/scripts/publish.py "$@"; }
    ci()                { validate && publish; }
    import_addon()      { python3 resources/scripts/import_addon.py "$@"; }
    generate_pages()    { python3 resources/scripts/generate_pages.py "$@"; }
    convert_zip()       { python3 resources/scripts/convert_zip.py "$@"; }
    export_zip()        { python3 resources/scripts/export_zip.py "$@"; }
    build_addon_zips()  { python3 resources/scripts/build_addon_zips.py "$@"; }
    publish_release()   { python3 resources/scripts/publish_release.py "$@"; }

    export -f validate strip publish ci import_addon generate_pages convert_zip export_zip build_addon_zips publish_release

    echo ""
    echo "  Trilium Scripts Dev Shell"
    echo ""
    echo "  validate                  Validate addon structure"
    echo "  publish                   Build per-addon .json files and metadata.json registry"
    echo "  ci                        Run validate then publish"
    echo "  import_addon <zip>        Import a Trilium export ZIP into addons/"
    echo "  convert_zip <zip>         Convert Trilium export ZIP to _tam_manifest_.json"
    echo "  export_zip <manifest>     Convert _tam_manifest_.json to a Trilium ZIP import"
    echo "  generate_pages            Build GitHub Pages site (docs/) and README.md"
    echo "  build_addon_zips          Build {id}.zip for every addon (used by CI)"
    echo "  publish_release           Upload *.json/*.zip to the 'latest' GitHub release (used by CI)"
    echo ""
  '';
}
