#!/usr/bin/env bash
# Builds a plugin zip for a fixture site from the plugin's official Git repository, for when
# wordpress.org cannot be reached: clones the release tag, installs the plugin's runtime Composer
# packages if the repository does not ship them, and zips the result for `wp plugin install`.
# The plugin is built in scripts/fixtures/out/, which git ignores; it never enters this
# repository.
#
#   scripts/fixtures/plugins.sh polylang 3.9.1      prints the path of out/plugins/polylang-3.9.1.zip
#
# Needs git, zip, and PHP with Composer for plugins that need Composer packages.
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "usage: $0 <wordpress.org slug> <version>" >&2
  exit 2
fi
slug="$1"
version="$2"

# The official repositories and how their release tags are named.
case "$slug" in
  polylang) repo=https://github.com/polylang/polylang tag="$version" ;;
  advanced-custom-fields) repo=https://github.com/AdvancedCustomFields/acf tag="$version" ;;
  secure-custom-fields) repo=https://github.com/WordPress/secure-custom-fields tag="$version" ;;
  elementor) repo=https://github.com/elementor/elementor tag="v$version" ;;
  *)
    echo "no Git repository known for the plugin $slug; add it to $0" >&2
    exit 2
    ;;
esac

here="$(cd "$(dirname "$0")" && pwd)"
out="$here/out/plugins"
zip="$out/$slug-$version.zip"
if [ -f "$zip" ]; then
  echo "$zip"
  exit 0
fi

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
git -c advice.detachedHead=false clone --quiet --depth 1 --branch "$tag" "$repo" "$work/$slug"
rm -rf "$work/$slug/.git"
if [ -f "$work/$slug/composer.json" ] && [ ! -d "$work/$slug/vendor" ]; then
  # Runtime packages only. Some plugins load vendor/ only when it exists; when a package cannot
  # be downloaded, the plugin is built without it and the build says so.
  if ! (cd "$work/$slug" && COMPOSER_ALLOW_SUPERUSER=1 composer install --no-dev --prefer-source \
    --no-interaction --no-progress --quiet >&2); then
    echo "warning: Composer packages of $slug $version could not be installed; built without them" >&2
    rm -rf "$work/$slug/vendor"
  fi
fi
mkdir -p "$out"
(cd "$work" && zip -qr "$zip" "$slug")
echo "$zip"
