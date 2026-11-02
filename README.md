# wp-to-payload

[![CI](https://github.com/OleksiiPro1/wp-to-payload/actions/workflows/ci.yml/badge.svg)](https://github.com/OleksiiPro1/wp-to-payload/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Move a WordPress site to [Payload CMS 3](https://payloadcms.com) from the standard WordPress
export file. No access to the old site is needed: no plugin, no API keys, no database dump.

- **`analyze`** tells you what a site contains and how hard the move will be, before you start.
- **`scaffold`** writes ready-made Payload collections for posts, pages, categories, tags,
  authors and media, and for the site's custom post types and taxonomies.
- **`import`** brings everything into your Payload project through the Local API, with all
  relations. Run it as often as you like: it updates what it imported before instead of
  creating duplicates.
- **`redirects`** maps every old URL to its new one, for Next.js, Apache, nginx, Netlify, the
  Payload redirects plugin, or as CSV and JSON.

> **Unofficial.** wp-to-payload is an independent open-source project. It is not affiliated
> with, endorsed by or sponsored by Payload or Figma, or the WordPress Foundation.

## Quick start

Export your site in WordPress under **Tools → Export → All content**. Then, in the root of
your Payload 3 project:

```bash
npx wp-to-payload analyze export.xml
```

```bash
npx wp-to-payload scaffold export.xml
```

Add the printed lines to `payload.config.ts` (the collections and the SEO and redirects
plugins), then:

```bash
npx wp-to-payload import export.xml --uploads-dir ./uploads
```

`--uploads-dir` points to a copy of the old site's `wp-content/uploads`. Without it, media
files are downloaded from the site. Start with `--dry-run` to see what would change without
writing anything.

## Requirements

- Node.js 22.22.2 or newer on Node 22, 24.15 or newer on Node 24, or Node 26 and later: what
  jsdom, which the import uses to clean up HTML, supports. Payload 3.92 itself needs Node.js
  22.23.4+ or 24.22.1+.
- A Payload 3 project with `payload` and `@payloadcms/richtext-lexical` installed, set up as
  ES modules (`"type": "module"` in `package.json`, as `create-payload-app` does it).
  `analyze` and `redirects` work without one.
- A WordPress export file (WXR). Files of hundreds of megabytes are fine: the export is
  streamed, never loaded into memory as a whole.

## What gets migrated

| WordPress                                                                                                                        | Payload                                                                                             |     |
| -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | --- |
| Posts and pages                                                                                                                  | `posts`, `pages` with title, slug, content, excerpt, date, author, status (published or draft)      | ✅  |
| Parent pages                                                                                                                     | `parent` relationship                                                                               | ✅  |
| Categories (with hierarchy) and tags                                                                                             | `categories`, `tags`                                                                                | ✅  |
| Authors                                                                                                                          | `authors`: name and slug (e-mail only if you enable it)                                             | ✅  |
| Media library                                                                                                                    | `media` upload collection with alt text and caption                                                 | ✅  |
| Featured images                                                                                                                  | `featuredImage`                                                                                     | ✅  |
| Images in content                                                                                                                | Upload nodes pointing to the imported media                                                         | ✅  |
| Links between posts and pages                                                                                                    | Rewritten to the new URLs                                                                           | ✅  |
| Links to files in the media library (PDFs, downloads)                                                                            | Point to the imported files                                                                         | ✅  |
| Yoast SEO and Rank Math                                                                                                          | `meta.title`, `meta.description`, `meta.image` (SEO plugin), template variables resolved            | ✅  |
| Canonical URLs                                                                                                                   | Written only if your `meta` group has a `canonical` field                                           | ⚠️  |
| Gutenberg: paragraph, heading, list, quote, image, gallery, code, preformatted, table, separator, buttons, embed, columns, group | Lexical rich text; code and embeds as blocks                                                        | ✅  |
| Gutenberg: cover, media & text, pullquote, verse, details, audio, video, file                                                    | Content kept, layout lost; players become links                                                     | ⚠️  |
| Gutenberg: dynamic blocks (latest posts, query loops, navigation, …)                                                             | Removed, listed in the report                                                                       | ❌  |
| Blocks from plugins                                                                                                              | HTML converted as is, listed in the report                                                          | ⚠️  |
| Classic editor content                                                                                                           | Paragraphs and line breaks as WordPress shows them                                                  | ✅  |
| `[caption]`, `[gallery]`, `[embed]`                                                                                              | Images, captions and embeds                                                                         | ✅  |
| `[audio]`, `[video]`                                                                                                             | Links to the files                                                                                  | ⚠️  |
| Other shortcodes                                                                                                                 | Removed, the text inside kept, every place listed in the report                                     | ⚠️  |
| Elementor, Divi, WPBakery, Beaver Builder, Avada                                                                                 | Text and images kept, layout lost, listed in the report                                             | ⚠️  |
| Oxygen, Bricks                                                                                                                   | Detected only (their content is not in post content)                                                | ❌  |
| Old URLs                                                                                                                         | Redirects in six formats or in the Payload redirects plugin                                         | ✅  |
| Custom post types                                                                                                                | A collection each (`recipes` for `recipe`) with the fields of posts; parents for hierarchical types | ✅  |
| Custom taxonomies                                                                                                                | A collection each, with hierarchy, related from the documents                                       | ✅  |
| ACF and Secure Custom Fields: text, number, choice, date, link, image, file, gallery, relationship and taxonomy fields           | Fields of the collection (`recipe.baking_time`), written by `scaffold`; values per locale           | ✅  |
| ACF groups, repeaters and flexible content                                                                                       | Groups, arrays and blocks                                                                           | ✅  |
| ACF field groups that exist only in the theme (local JSON)                                                                       | Read with `--acf-json`; groups registered in PHP need ACF's JSON export                             | ⚠️  |
| ACF clone, map, user, message and tab fields                                                                                     | Listed in the report, not imported                                                                  | ❌  |
| ACF password fields                                                                                                              | Never imported                                                                                      | ❌  |
| ACF options pages and ACF blocks                                                                                                 | Not imported (options are not in the export; ACF blocks are reported as plugin blocks)              | ❌  |
| Other post meta of plugins                                                                                                       | Not imported                                                                                        | ❌  |
| Menus                                                                                                                            | `header` and `footer` globals: `navItems` with links like the website template                      | ✅  |
| Submenus                                                                                                                         | Put after their parent entry, because `navItems` has one level                                      | ⚠️  |
| Comments                                                                                                                         | Counted and reported, not imported                                                                  | ❌  |
| Post types of plugins: forms and their entries, page builder templates, ACF settings                                             | Listed in the reports, never imported (ACF field groups are read for the fields)                    | ❌  |
| Polylang: languages and translations of posts, pages, custom post types, terms and images                                        | One document per translation group, texts per Payload locale; redirects per language                | ✅  |
| WPML with its WPML Export and Import add-on (experimental)                                                                       | As for Polylang, from the add-on's documented post meta                                             | ⚠️  |
| WPML without the add-on                                                                                                          | Languages from the URL directories, translations stay separate documents                            | ⚠️  |
| WooCommerce                                                                                                                      | Detected and reported, not imported                                                                 | ❌  |
| All in One SEO, SEOPress                                                                                                         | Detected only                                                                                       | ❌  |
| Users, passwords, roles                                                                                                          | Never imported                                                                                      | ❌  |

✅ migrated · ⚠️ migrated with loss, always reported · ❌ not migrated

## Commands

### analyze

```bash
npx wp-to-payload analyze export.xml [--out <dir>] [--json] [--acf-json <path>]
```

Writes `report.json` and `report.md` to `wp-to-payload-report/` and prints a summary: counts of
posts, pages, media, categories, tags, authors and comments; custom post types and taxonomies
with what the import does with them; every Gutenberg block with how the import handles it; shortcodes; page builders; SEO plugins;
WPML and Polylang; WooCommerce; ACF field groups with the collections they go into and the
fields that are not imported. It ends with a rating, **simple**, **medium** or
**complex**, and lists the reasons behind it. Page builders, WooCommerce and multilingual
content always make a site complex. `analyze` never needs Payload.

### scaffold

```bash
npx wp-to-payload scaffold [export.xml] [--out <dir>] [--slug-prefix <prefix>] [--acf-json <path>] [--force]
```

Writes collection configs to `src/collections/wp/`: `Posts`, `Pages`, `Categories`, `Tags`,
`Authors` and `Media`. Each has a `wpId` field, which is how repeated imports find what they
imported before. Posts and pages use drafts and a Lexical editor with code blocks, embeds and
tables. They get their `meta` fields from `@payloadcms/plugin-seo`.

Given the export file, scaffold also writes a collection for each custom post type and custom
taxonomy in it: `recipe` becomes `Recipes` (slug `recipes`) with the fields of posts, a `parent`
field when its items have parents, and a relationship field for each taxonomy its items use
(`recipeCategories` for `recipe_category`). Post types of plugins, such as forms or page builder
templates, get none. Delete the files of types you do not need; the import skips types without
a collection and says so. The collections also get the site's ACF fields; see
[Custom fields](#custom-fields-acf). For the menus of the export, scaffold writes `Header` and
`Footer` globals shaped like the website template's, unless your project has globals with these
slugs already; see [Menus](#menus).

The files are yours afterwards; existing files are never overwritten without `--force`. If
your project already has collections with these slugs (the Payload website template has
`posts`, `pages`, `categories` and `media`), scaffold stops and explains the options:
`--slug-prefix wp-`, removing yours, or mapping your own collections in the config file.

### import

```bash
npx wp-to-payload import export.xml [options]
```

Starts your project's Payload with `payload run`, so your `.env`, TypeScript config, database
adapter and hooks work as usual. Steps: media → categories → tags → custom taxonomies → authors
→ posts → pages → custom post types → menus → (redirects). The steps of custom types are named after
their collections, as in `--only recipes`.

| Option                |                                                                               |
| --------------------- | ----------------------------------------------------------------------------- |
| `--uploads-dir <dir>` | Local copy of `wp-content/uploads`; files found there are not downloaded      |
| `--offline`           | Never download; use only `--uploads-dir`                                      |
| `--dry-run`           | Check the schema and report what would be created or updated, without writing |
| `--only <list>`       | Only these steps, e.g. `--only posts,pages,recipes`                           |
| `--write-redirects`   | Also write redirects into the `@payloadcms/plugin-redirects` collection       |
| `--limit <n>`         | At most n items of each post type, for a first test                           |
| `--media-host <host>` | Another host media may be downloaded from (a CDN); repeatable                 |
| `--refresh-media`     | Upload files again even if they were imported before                          |
| `--concurrency <n>`   | Parallel downloads (default 4)                                                |
| `--max-media-mb <n>`  | Skip larger files (default 100)                                               |
| `--report-dir <dir>`  | Where `import-report.json` and `import-report.md` go                          |
| `--acf-json <path>`   | ACF field groups that are not in the export; repeatable                       |
| `--time-zone <zone>`  | The site's time zone for ACF dates with times, e.g. `Europe/Vienna`           |

Path options (`--post-path` and others, see [URLs](#urls)) are accepted too, because links in
the content are rewritten to the new URLs.

Every document gets the WordPress ID in `wpId`. A second run updates those documents; media
already imported are not uploaded again. Only fields that exist in your collections are
written, and each missing field is reported once, so the import also works with collections
you designed yourself. The report lists everything that could not be moved as it was, with a
code per kind of problem; see [docs/warnings.md](docs/warnings.md).

Media are only downloaded from the site's own hosts and the ones you allow with
`--media-host`, also when the server redirects. Password-protected posts are imported as drafts, so their content does not
become public by accident.

### redirects

```bash
npx wp-to-payload redirects export.xml --format next,htaccess,nginx,netlify,csv,json --out redirects/
```

One format prints to stdout; several are written to a directory. Every published permalink
gets a redirect, and so do earlier slugs that WordPress remembered (`_wp_old_slug`). Category
and tag archives get one when you set `--category-path` or `--tag-path`.

| Format        | File                              | Notes                                                                                   |
| ------------- | --------------------------------- | --------------------------------------------------------------------------------------- |
| `next`        | `next-redirects.json`             | For `redirects()` in `next.config`                                                      |
| `htaccess`    | `redirects.htaccess`              | Anchored `RedirectMatch`, so URLs below an old path are not caught                      |
| `nginx`       | `redirects.nginx.conf`            | A `map`; include it in `http {}` and add the `if` line shown in the file to `server {}` |
| `netlify`     | `_redirects`                      |                                                                                         |
| `csv`, `json` | `redirects.csv`, `redirects.json` | For review or other tools                                                               |

`--to-payload` writes into the `@payloadcms/plugin-redirects` collection instead, as
references to the imported documents (run it in the Payload project, after the import).
Conflicts, such as two items with the same new URL, are reported and left out rather than
guessed. The site root and `/wp-admin` are never redirected.

## URLs

New URLs come from patterns. The defaults match the
[Payload website template](https://github.com/payloadcms/payload/tree/main/templates/website):
posts at `/posts/:slug`, pages at `/:slug`. Custom post types get the plural of their name:
`/recipes/:slug`, or `/guides/:path` for hierarchical types.

| Token                     | Value                                                                    |
| ------------------------- | ------------------------------------------------------------------------ |
| `:slug`                   | The item's slug                                                          |
| `:path`                   | Slugs of the parent pages and the page, e.g. `about/team`                |
| `:year`, `:month`, `:day` | Publication date                                                         |
| `:category`               | First category with its parents, e.g. `recipes/bread`                    |
| `:id`                     | WordPress ID                                                             |
| `:locale`                 | Language directory on multilingual sites, empty for the default language |

```bash
npx wp-to-payload redirects export.xml --post-path /blog/:slug --page-path /:path --category-path /blog/category/:path
```

Archives of custom taxonomies get new URLs and redirects when `taxonomies.<name>.path` is set
in the config file. WordPress does not export their old URLs; they are taken to be
`/<base>/<term>/`, with the taxonomy name as `base` (WordPress's default) unless you set it.

## Configuration file

Options that you would repeat on every run can go into `wp-to-payload.config.json` in the
project root. Everything is optional:

```json
{
  "paths": { "post": "/blog/:slug", "page": "/:path", "category": "/blog/category/:path" },
  "siteHosts": ["staging.example.com"],
  "collections": { "posts": "articles", "media": "media" },
  "fields": { "featuredImage": "heroImage" },
  "postTypes": { "recipe": { "collection": "recipes", "path": "/rezepte/:slug" } },
  "taxonomies": {
    "recipe_category": { "base": "rezeptkategorie", "path": "/rezepte/kategorie/:path" }
  },
  "seo": { "separator": "|" },
  "media": { "hosts": ["cdn.example.com"] },
  "importAuthorEmails": false,
  "localization": { "defaultLanguage": "de", "locales": { "de": "de", "en": "en" } },
  "acfJson": ["wp-content/themes/my-theme/acf-json"],
  "timeZone": "Europe/Vienna",
  "menus": { "Hauptmenü": "header", "footer-links": "footer", "social": false }
}
```

- `paths`: URL patterns per type (`post`, `page`, `category`, `tag` or a custom post type).
- `siteHosts`: more hostnames of the old site, so links to them count as internal.
- `collections`: your collection slugs, if they differ from `posts`, `pages`, `categories`,
  `tags`, `authors`, `media` and `redirects`.
- `fields`: your field names for posts, pages and custom post types, if they differ (`title`,
  `slug`, `content`, `excerpt`, `publishedAt`, `author`, `categories`, `tags`, `featuredImage`,
  `parent`, `meta`, `wpId`).
- `postTypes`: settings per custom post type, all optional: `collection` (default: the plural
  of the name), `path` (the same as `paths.<type>`), `hierarchical` (default: whether its items
  have parents). Naming a plugin's post type here imports it, which is otherwise skipped.
- `taxonomies`: settings per custom taxonomy, all optional: `collection`, `path` of the new term
  archives (no redirects without it), `base` of the old archives (default: the taxonomy name),
  `field` on the documents (default: `recipeCategories` for `recipe_category`) and
  `hierarchical`.
- `seo.separator`: what `%%sep%%` (Yoast) and `%sep%` (Rank Math) become. Default `-`.
- `media.hosts`: hosts media may be downloaded from besides the site.
- `importAuthorEmails`: copy author e-mail addresses. Off by default, because they are
  personal data.
- `localization`, for multilingual sites: `defaultLanguage`, the WordPress code of the default
  language (otherwise the one whose URLs have no language directory); `locales`, WordPress
  language → Payload locale where the codes differ; `prefixDefaultLanguage`, to give the
  default language a directory in new URLs too.
- `acfJson`: ACF JSON files or folders with field groups that are not in the export, relative
  to the config file. `--acf-json` adds more.
- `timeZone`: the site's time zone, for ACF dates with times (WordPress stores them without one).
- `menus`: menus by slug or name → the Payload global they go into, or `false` to leave a menu
  out. Menus not named here are placed by their names; see [Menus](#menus).

## Multilingual sites

Polylang keeps languages and translations in the export, so `analyze` shows the languages, the
items per language and how complete the translations are, `scaffold export.xml` writes
collections with localized fields and prints the `localization` block for `payload.config.ts`,
and `import` turns each translation group into one document with a value per locale:

- Localized: title, slug, content, excerpt, featured image, the SEO fields and ACF fields; for
  terms title, slug, description and ACF fields; for media alt text and caption. Relations, the author and the date come
  from the default language's version.
- `wpId` is the smallest WordPress ID of the group and `wpIds` holds all of them, so a later
  import, also with a translation that is new, updates the same document.
- The default language keeps URLs without a language directory (`/ueber-uns`), others get theirs
  (`/en/about-us`); old URLs of every language are redirected.
- Payload publishes all locales of a document together. A version that is not public in
  WordPress while another one is stays out (`TRANSLATION_DRAFT`).
- Without `localization` in Payload only the default language is imported, and the report says
  so.

**WPML** support is experimental. WPML keeps languages in its own tables, which the export does
not contain; only its WPML Export and Import add-on writes
them into the export (`_wpml_import_language_code`, `_wpml_import_source_language_code`,
`_wpml_import_translation_group`). Only these documented keys are read. Without them the
language of an item comes from its URL directory and translations stay separate documents.

## Custom fields (ACF)

Advanced Custom Fields and Secure Custom Fields (the community fork, which stores data the same
way) keep their field groups in the export. `analyze` lists them, `scaffold export.xml` writes
their fields into the collections, and `import` fills them. A group goes into the collections
of the post types and taxonomies its location rules name, and of those whose items have values
of its fields.

| ACF                                              | Payload                                                     |
| ------------------------------------------------ | ----------------------------------------------------------- |
| text, textarea, email, number, range             | `text`, `textarea`, `email`, `number`                       |
| url, oEmbed, color picker, time picker           | `text`                                                      |
| WYSIWYG                                          | `richText`, converted like post content                     |
| image, file, gallery                             | `upload` to the media collection (gallery: `hasMany`)       |
| select, checkbox, radio, button group            | `select` (checkbox and multiple: `hasMany`), `radio`        |
| true / false                                     | `checkbox`                                                  |
| date picker, date time picker                    | `date`                                                      |
| link                                             | `group` of `label`, `url` and `newTab`                      |
| post object, page link, relationship             | `relationship` to the collections of the allowed post types |
| taxonomy                                         | `relationship` to the taxonomy's collection                 |
| group, repeater, flexible content                | `group`, `array`, `blocks` (a block per layout)             |
| clone, Google map, user, message, tab, accordion | Not imported; listed in the report                          |
| password                                         | Never imported                                              |

- Fields keep their ACF names at the top level of the collection (`recipe.baking_time`). A name
  the collection uses already, such as `excerpt`, becomes `acf_excerpt`, and the report says so
  (`ACF_FIELD_RENAMED`).
- Blocks are named after their layout. Payload needs one name per block across the whole
  config, so when two flexible fields have a layout of the same name, the field's name goes in
  front (`sections_quote`).
- Links in text and link fields point to the new URLs. Relations to items that come later in
  the export are set once those exist.
- On multilingual sites every ACF field is localized, so each language keeps its own values.
- Groups that a theme registers in code are not in the export, but their values are. Pass the
  theme's `acf-json` folder, or a JSON file from ACF's export tool (Tools → Export field groups),
  with `--acf-json`. Without it, the report names the values whose fields are unknown
  (`ACF_FIELD_UNKNOWN`).
- Dates with times have no time zone in WordPress. Set `timeZone` (or `--time-zone`) for exact
  values; otherwise the offset that most posts of the export have is used.
- Values that do not fit their field (a choice that no longer exists, a number that is not
  one) are left out and reported (`ACF_VALUE_INVALID`). A field your collection does not have is
  reported once (`FIELD_MISSING`) and not imported.

## Menus

Which menu a theme shows in which place is a theme setting, and the export does not contain it.
So menus go into the `header` and `footer` globals by their names: "Footer", "Fußzeile" or
"Legal" into the footer, "Main menu", "Primary" or "Hauptmenü" into the header. Without such a
name, the largest remaining menu becomes the header. `menus` in the config file sets the global
of any menu, also one of your own (`"social": "socialLinks"`), or leaves it out.

The globals need a `navItems` array of `link` groups, as in the Payload website template and as
`scaffold` writes them:

- Entries for pages, posts and custom post types become internal links (`type: 'reference'`)
  when the link field can point to their collection, and links to their new URL otherwise.
- Category and tag entries link to the archive's new URL. Without a pattern for it
  (`paths.category`), they keep the old URL and the report says so (`MENU_LINK_UNCHANGED`).
- Custom links keep their URL; links to the old site get the new path. New tab is kept.
- Labels are the entry's own label, or the title of what it links to.
- Submenus are put after their parent (`MENU_FLATTENED`). Entries that link to something that
  was not imported, or beyond the global's `maxRows` (the website template's header allows 6),
  are left out (`MENU_ITEM_SKIPPED`).
- On multilingual sites, each menu belongs to the language most of its links are in, and
  `navItems` gets one menu per locale.
- `navItems` is written anew on every run.

## Limitations

- **Page builders.** For Elementor, Divi, WPBakery, Beaver Builder and Avada, the text and
  images come over and the layout does not. Elementor content is taken from the HTML that
  Elementor stores in the post; if that is empty, the post is empty.
- **Images inside paragraphs** are placed between the paragraph's halves, because a Lexical
  upload is a block of its own.
- **Internal links** become links to the new URL, not Lexical links to the document.
- **Custom post types** come over with title, slug, content, excerpt, dates, author, featured
  image, SEO data, taxonomies and ACF fields. Other post meta is not imported. WordPress does not
  export how a type was registered: whether it is hierarchical is read from its items, and a
  plugin's internal types are recognised by name (form plugins, page builders, ACF, WooCommerce).
- **The Payload website template's pages** are built from layout blocks and have no `content`
  field, so page content is not imported into them. Use the scaffolded `Pages` collection, or
  add a rich text field and map it with `fields.content`.
- **Schema changes.** In development, Payload asks before it drops a column from the database.
  Run the import in a terminal so you can answer.
- **Proxies.** Media downloads use Node's `fetch`. Behind a proxy, set
  `NODE_USE_ENV_PROXY=1` so it uses `HTTPS_PROXY`.
- **Speed.** Documents are written one at a time through the Local API, so hooks and
  validation run for each. Sites with tens of thousands of posts take a while; try `--limit`
  first.
- **Multisite.** Export and import each site separately.

## Roadmap

- WooCommerce products
- ACF options pages and ACF blocks
- Comments
- Nested menus (for headers that support them)
- Reusable blocks (synced patterns) inlined into the content
- Lexical internal links to documents
- All in One SEO and SEOPress
- The WordPress REST API as a second source

Ideas and pull requests are welcome; see [CONTRIBUTING.md](CONTRIBUTING.md).

## How it works

The export is read twice as a stream. The first pass collects everything except post bodies
(attachments, terms, authors and the URL of every item), so references can be resolved
whatever order the file is in. The second pass converts and writes one post at a time.

Content goes through four steps: the Gutenberg block comments are parsed (classic content gets
paragraphs); shortcodes are replaced; the HTML is cleaned with jsdom (images matched to media,
internal links rewritten, layout wrappers removed); and Payload's own `convertHTMLToLexical`
turns it into Lexical, using the editor config of your `content` field.

## Alternatives

[wp2payload](https://github.com/abdulrehmankz1/wp2payload) migrates through the WordPress
REST API of the running site. Use it when the old site is reachable and you would rather not
work with export files.

## Development

```bash
npm ci
npm ci --prefix test/payload-project
npm test
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the test layers and project rules.

## Need help with a complex migration?

Page builders, WooCommerce, multilingual sites, custom fields, thousands of posts: some sites
need more than a tool. [Wien Webstudio](https://wienwebstudio.at) in Vienna, Austria moves
WordPress sites to Payload CMS at a fixed price, from the first `analyze` report to the
redirects on launch day.

[wienwebstudio.at](https://wienwebstudio.at)

## License

[MIT](LICENSE) © 2026 Oleksii Piltenko, Wien Webstudio
