#!/usr/bin/env bash
# Builds a throwaway WordPress site per scenario, fills it with synthetic content and writes two
# exports to test/fixtures/wxr/wordpress/: <scenario>.xml from WordPress's own exporter (what
# Tools → Export produces) and <scenario>.wp-cli.xml from `wp export`, whose format differs
# (for example, it has no term meta). See CONTRIBUTING.md.
#
#   scripts/fixtures/generate.sh            all scenarios
#   scripts/fixtures/generate.sh core       one scenario
#
# WP2P_REGISTRY=mirror.gcr.io/library uses a mirror of the official images (Docker Hub limits
# anonymous pulls).
#
# Scenarios name their plugins with versions (`* Plugins: polylang@3.9.1`). They come from
# wordpress.org; when it cannot be reached, plugins.sh builds the same version from the plugin's
# official Git repository. WP2P_PLUGIN_SOURCE=wordpress.org or git chooses one explicitly.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
target="$here/../../test/fixtures/wxr/wordpress"
cd "$here"

if [ "$#" -gt 0 ]; then
  scenarios=("$@")
else
  scenarios=()
  for file in scenarios/*.php; do scenarios+=("$(basename "$file" .php)"); done
fi

compose() { docker compose --progress quiet -f compose.yaml "$@"; }
wp() { compose run --rm -T cli "$@"; }

cleanup() { compose down --volumes --remove-orphans > /dev/null 2>&1 || true; }
trap cleanup EXIT

mkdir -p "$target" out
chmod 777 out

plugin_source="${WP2P_PLUGIN_SOURCE:-auto}"
if [ "$plugin_source" = auto ]; then
  if curl -sfI --max-time 15 https://downloads.wordpress.org/ > /dev/null 2>&1; then
    plugin_source=wordpress.org
  else
    plugin_source=git
  fi
fi

for scenario in "${scenarios[@]}"; do
  file="scenarios/$scenario.php"
  if [ ! -f "$file" ]; then
    echo "unknown scenario: $scenario (see $here/scenarios)" >&2
    exit 2
  fi
  title="$(sed -n 's/^ \* Title: //p' "$file")"
  plugins="$(sed -n 's/^ \* Plugins: //p' "$file")"
  echo "== $scenario${plugins:+ (plugins: $plugins)}"

  cleanup
  rm -f "out/$scenario.xml"
  compose up --detach --wait db wordpress > /dev/null

  # The admin password is random and never exported (WXR has no passwords of users).
  wp core install --url="https://$scenario.example.com" --title="${title:-$scenario}" \
    --admin_user=editor --admin_email=editor@example.com \
    --admin_password="$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')" --skip-email > /dev/null
  wp option update timezone_string Europe/Vienna > /dev/null
  wp rewrite structure '/%year%/%monthnum%/%day%/%postname%/' > /dev/null
  # Start empty: no sample post, page or comment.
  wp site empty --yes > /dev/null
  for entry in ${plugins//,/ }; do
    slug="${entry%@*}"
    version="${entry#*@}"
    if [ "$version" = "$entry" ]; then
      echo "plugin $slug has no version; write it as $slug@<version>" >&2
      exit 2
    fi
    if [ "$plugin_source" = git ]; then
      zip="$("$here/plugins.sh" "$slug" "$version")"
      echo "   $slug $version from its Git repository"
      wp plugin install "/out/plugins/$(basename "$zip")" --activate > /dev/null
    else
      wp plugin install "$slug" --version="$version" --activate > /dev/null
    fi
  done

  wp eval-file "/fixtures/$file"

  # Tools → Export in the admin runs export_wp(); `wp export` has its own writer.
  wp eval 'require_once ABSPATH . "wp-admin/includes/export.php"; export_wp();' > "out/$scenario.xml"
  wp export --dir=/out --filename_format="$scenario.wp-cli.xml" > /dev/null

  for name in "$scenario.xml" "$scenario.wp-cli.xml"; do
    # The export date is the only part that changes between runs.
    sed -e '0,/<pubDate>[^<]*<\/pubDate>/s//<pubDate>Thu, 01 Jan 2026 00:00:00 +0000<\/pubDate>/' \
      -e 's#^\([[:space:]]*\)<!-- generator="WordPress/\([^"]*\)" created="[^"]*" -->#\1<!-- generator="WordPress/\2" -->#' \
      "out/$name" > "$target/$name"
    rm -f "out/$name"
    echo "   wrote test/fixtures/wxr/wordpress/$name"
  done
done
