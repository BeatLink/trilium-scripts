{ pkgs ? import <nixpkgs> {} }:

pkgs.mkShell {
  packages = [
    (pkgs.python3.withPackages (ps: [ ps.markdown ps.playwright ]))
    pkgs.gh
    pkgs.playwright-driver.browsers
  ];

  shellHook = ''
    tamhelper()            { python3 resources/scripts/tamhelper.py "$@"; }
    validate()             { tamhelper validate "$@"; }
    ci()                   { validate && tam_to_zip --all; }
    generate_pages()       { tamhelper generate-pages "$@"; }
    generate_readme()      { tamhelper generate-readme "$@"; }
    zip_to_tam()           { tamhelper zip-to-tam "$@"; }
    tam_to_zip()           { tamhelper tam-to-zip "$@"; }
    publish_release()      { tamhelper publish-release "$@"; }
    backfill_manifest_source_url() { tamhelper backfill-source-url "$@"; }

    export -f tamhelper validate ci generate_pages generate_readme zip_to_tam tam_to_zip publish_release backfill_manifest_source_url

    # playwright-driver.browsers ships prebuilt browser binaries matching the
    # exact revision the pinned `playwright` Python package expects -- point
    # at it directly instead of `playwright install` (which would try to
    # download into $HOME/.cache and fails offline/in sandboxes), and skip
    # the host-requirements probe that otherwise complains about a NixOS host.
    export PLAYWRIGHT_BROWSERS_PATH="${pkgs.playwright-driver.browsers}"
    export PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=1

    echo ""
    echo "  Trilium Scripts Dev Shell"
    echo ""
    echo "  validate                       Validate addon structure"
    echo "  ci                             Run validate then tam_to_zip --all"
    echo "  zip_to_tam <zip>               Convert Trilium export ZIP to _tam_manifest_.json"
    echo "  tam_to_zip <manifest>          Convert _tam_manifest_.json to a Trilium ZIP import"
    echo "  tam_to_zip --all               Convert every addon's manifest to a ZIP (used by CI)"
    echo "  generate_pages                 Build GitHub Pages site (docs/, incl. catalog.json)"
    echo "  generate_readme                Regenerate README.md's addon table from manifests"
    echo "  publish_release                Upload *.zip to a new versioned + the 'latest' GitHub release (used by CI)"
    echo "  backfill_manifest_source_url   One-time: add manifestSourceUrl to every addon missing one"
    echo ""
  '';
}
