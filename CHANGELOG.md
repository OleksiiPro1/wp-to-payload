# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Term meta (`wp:termmeta`) is read from exports, and a reader for PHP `serialize()` data
  handles plugin data such as Polylang translations and ACF settings. Groundwork for 0.2.

### Changed

- The required Node.js version is now what the dependencies need: 22.22.2 or newer on Node 22,
  24.15 or newer on Node 24, or Node 26 and later (jsdom 30). `engines` said 22.12, so npm
  warned about jsdom and its dependencies (`EBADENGINE`) on earlier Node 22 releases.

### Development

- Test fixtures from real WordPress 7.1 sites, built in Docker by `scripts/fixtures` and
  exported with both WordPress's exporter and WP-CLI.
- Tests of the Payload features the import relies on (hasMany numbers, localized fields).

## [0.1.0] - Unreleased

First release.

### Added

- `analyze`: a report of what a WordPress export contains (posts, pages, media, terms,
  authors, comments, custom post types, Gutenberg blocks, shortcodes, page builders, SEO
  plugins, WPML, Polylang, WooCommerce, ACF) with a simple, medium or complex rating.
  Writes `report.json` and `report.md`.
- `scaffold`: Payload collections for posts, pages, categories, tags, authors and media with
  a `wpId` field, an editor with code blocks, embeds and tables, and the setup for the SEO and
  redirects plugins.
- `import`: imports media, categories, tags, authors, posts and pages into a Payload 3 project
  through the Local API, with all relations. Repeatable: documents are matched by `wpId`.
  Supports `--dry-run`, `--only`, `--limit` and a local `--uploads-dir`.
- Gutenberg and classic content to Lexical with Payload's own converter; images become upload
  nodes, internal links point to the new URLs, links to files point to the imported media,
  Yoast and Rank Math data fill `meta`.
- `redirects`: old to new URLs as CSV, JSON, Next.js `redirects()`, Apache, nginx and Netlify,
  or into `@payloadcms/plugin-redirects`.
- `wp-to-payload.config.json` for URL patterns, collection and field names.
