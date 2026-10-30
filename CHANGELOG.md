# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/).

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
