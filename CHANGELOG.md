# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.2.0] - 2026-11-03

0.1.0 was not published to npm, so 0.2.0 is the first version there and includes everything
listed under 0.1.0 as well.

### Added

- Synced patterns (reusable blocks) are inlined where they are used, instead of being removed:
  their content is in the export as `wp_block` items. Patterns inside patterns work, a pattern
  that contains itself stops with a warning, and pattern overrides of headings and paragraphs
  are applied; other overrides are reported (`BLOCK_PARTIAL`).
- Elementor. Pages built with Elementor are converted from Elementor's data (`_elementor_data`)
  instead of the HTML Elementor stores in the content: headings, text, images and galleries,
  buttons, videos (YouTube and Vimeo as embed blocks), icon lists, image and icon boxes,
  testimonials, accordions, toggles, tabs, dividers, HTML, shortcodes and alerts, and the Pro
  widgets call to action, slides, blockquote, animated headline and flip box, in reading order
  and through the same pipeline as other content. Other widgets are reported with their type
  (`BUILDER_WIDGET_UNKNOWN`); broken data falls back to the stored HTML (`BUILDER_DATA_INVALID`).
  `analyze` counts the widgets and names the ones without a converter.

- Menus. Every WordPress menu goes into a global, `header` or `footer`, by the `menus` setting or
  by its name, with entries in `navItems` shaped like the links of the Payload website template:
  internal links to the imported documents, archive and custom links with their new URLs, the
  label and new tab. Submenus are put after their parent. On multilingual sites each menu goes
  into the locale of its language. `scaffold export.xml` writes `Header` and `Footer` globals
  (unless the project has them), `analyze` lists the menus with their places, and `--only menus`
  runs the step on its own. New warning codes `MENU_SKIPPED`, `MENU_FLATTENED`,
  `MENU_ITEM_SKIPPED` and `MENU_LINK_UNCHANGED`.

- ACF fields (Advanced Custom Fields and Secure Custom Fields). Field groups are read from the
  export, and from ACF JSON files with the new `--acf-json` option or `acfJson` setting for
  groups that a theme keeps in code. `scaffold` writes their fields into the collections of the
  post types and taxonomies they apply to, under their ACF names (`recipe.baking_time`;
  `acf_excerpt` when the collection has the name already). `import` fills them from post meta
  and term meta: text, number, choice, date, link, image, file, gallery, relationship and
  taxonomy fields, groups, repeaters (arrays) and flexible content (blocks), with WYSIWYG fields
  converted like post content and a value per locale on multilingual sites. Clone, map, user,
  message and tab fields are reported, password fields never imported. `analyze` lists the
  groups and what happens to their fields. New setting `timeZone` (and `--time-zone`) for dates
  with times; new warning codes `ACF_FIELD_SKIPPED`, `ACF_FIELD_RENAMED`, `ACF_FIELD_UNKNOWN`
  and `ACF_VALUE_INVALID`.
- Multilingual sites. Polylang's languages and translation groups, and WPML's through the post
  meta of its WPML Export and Import add-on (experimental), become Payload localization: one
  document per translation group with title, slug, content, excerpt, featured image, SEO fields,
  term texts and media texts per locale; `wpIds` holds the WordPress IDs of all versions, so
  repeated imports and later translations update the same document. URLs keep a language
  directory except for the default language (`:locale` token), every language's old URLs are
  redirected, `scaffold` writes localized collections and prints the `localization` block, and
  `analyze` shows the languages, items per language and the completeness of translations. New
  setting `localization`; new warning codes `LANGUAGE_SKIPPED`, `TRANSLATION_DRAFT` and
  `FIELD_NOT_LOCALIZED`.
- Custom post types and custom taxonomies. `analyze` lists them with what the import does with
  each. `scaffold export.xml` writes a collection for each (`recipe` → `recipes`,
  `recipe_category` → `recipe-categories`) with the fields of posts or categories, a parent for
  hierarchical ones and relationship fields for the taxonomies. `import` brings them over like
  posts and pages, and links and redirects use their new URLs (`/recipes/:slug` by default).
  Archives of custom taxonomies are redirected when their new path is configured.
- `postTypes` and `taxonomies` in the config file: collection, path, hierarchy, and for
  taxonomies the old archive base and the relationship field.
- Post types of plugins (form definitions and entries, page builder templates, ACF settings,
  WooCommerce) are recognised and never imported as documents; naming one under `postTypes`
  imports it.
- Warning codes `COLLECTION_MISSING` (a step's collection does not exist) and `TYPE_SKIPPED`
  (items of a plugin's post type).
- Term meta (`wp:termmeta`) is read from exports, and a reader for PHP `serialize()` data
  handles plugin data such as Polylang translations and ACF settings. Groundwork for 0.2.

### Changed

- Elementor no longer makes a site complex on its own in `analyze`: it adds 3 points, widgets
  without a converter 1, broken data 2 and makes it complex. Items of plugin types (page builder
  templates, Elementor's kit) no longer count in the content statistics.

- ACF adds 1 point to the complexity score of `analyze` instead of 2, since its fields are
  imported now; values that are lost or have no field definition add more.
- The required Node.js version is now what the dependencies need: 22.22.2 or newer on Node 22,
  24.15 or newer on Node 24, or Node 26 and later (jsdom 30). `engines` said 22.12, so npm
  warned about jsdom and its dependencies (`EBADENGINE`) on earlier Node 22 releases.
- A missing collection used to be noted on the console only, and a missing categories or tags
  field on posts not at all. Both are warnings now (`COLLECTION_MISSING`, `FIELD_MISSING`).
- `analyze`: `counts.customPostTypes` counts only the types the import brings over; the new
  `customTypes` lists every custom post type and taxonomy.
- `--only` accepts the steps of custom types, which are named after their collections.

### Development

- A fixture site built with Elementor 4.0.8: pages saved through Elementor's document API with
  every converted free widget, free widgets without a converter, and a page with broken data.

- A fixture site with Secure Custom Fields 6.9.7 that uses every field type, including the ones
  ACF has only in its paid version (repeater, flexible content, gallery, clone), and the
  Polylang site has custom fields per language now.
- A German and English fixture site with Polylang 3.9.1. When wordpress.org cannot be reached,
  the fixture generator builds plugins from their official Git repositories.
- Test fixtures from real WordPress 7.1 sites, built in Docker by `scripts/fixtures` and
  exported with both WordPress's exporter and WP-CLI. The `core` site has a custom post type
  with a hierarchical taxonomy and a hierarchical custom post type.
- CI runs the unit tests on the lowest supported Node.js versions too, and installs the packed
  package there without engine warnings.
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
