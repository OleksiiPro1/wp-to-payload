# wp-to-payload

[![CI](https://github.com/oleksiipro1/wp-to-payload/actions/workflows/ci.yml/badge.svg)](https://github.com/oleksiipro1/wp-to-payload/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Move a WordPress site to [Payload CMS 3](https://payloadcms.com) from the standard WordPress
export file. No access to the old site is needed: no plugin, no API keys, no database dump.

- **`analyze`** tells you what a site contains and how hard the move will be, before you start.
- **`scaffold`** writes ready-made Payload collections for posts, pages, categories, tags,
  authors and media.
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
npx wp-to-payload scaffold
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

- Node.js 22.12 or newer. Payload 3.92 itself needs Node.js 22.23.4+ or 24.22.1+.
- A Payload 3 project with `payload` and `@payloadcms/richtext-lexical` installed.
  `analyze` and `redirects` work without one.
- A WordPress export file (WXR). Files of hundreds of megabytes are fine: the export is
  streamed, never loaded into memory as a whole.

## What gets migrated

| WordPress                                                                                                                        | Payload                                                                                        |     |
| -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | --- |
| Posts and pages                                                                                                                  | `posts`, `pages` with title, slug, content, excerpt, date, author, status (published or draft) | ✅  |
| Parent pages                                                                                                                     | `parent` relationship                                                                          | ✅  |
| Categories (with hierarchy) and tags                                                                                             | `categories`, `tags`                                                                           | ✅  |
| Authors                                                                                                                          | `authors`: name and slug (e-mail only if you enable it)                                        | ✅  |
| Media library                                                                                                                    | `media` upload collection with alt text and caption                                            | ✅  |
| Featured images                                                                                                                  | `featuredImage`                                                                                | ✅  |
| Images in content                                                                                                                | Upload nodes pointing to the imported media                                                    | ✅  |
| Links between posts and pages                                                                                                    | Rewritten to the new URLs                                                                      | ✅  |
| Yoast SEO and Rank Math                                                                                                          | `meta.title`, `meta.description`, `meta.image` (SEO plugin), template variables resolved       | ✅  |
| Canonical URLs                                                                                                                   | Written only if your `meta` group has a `canonical` field                                      | ⚠️  |
| Gutenberg: paragraph, heading, list, quote, image, gallery, code, preformatted, table, separator, buttons, embed, columns, group | Lexical rich text; code and embeds as blocks                                                   | ✅  |
| Gutenberg: cover, media & text, pullquote, verse, details, audio, video, file                                                    | Content kept, layout lost; players become links                                                | ⚠️  |
| Gutenberg: dynamic blocks (latest posts, query loops, navigation, …)                                                             | Removed, listed in the report                                                                  | ❌  |
| Blocks from plugins                                                                                                              | HTML converted as is, listed in the report                                                     | ⚠️  |
| Classic editor content                                                                                                           | Paragraphs and line breaks as WordPress shows them                                             | ✅  |
| `[caption]`, `[gallery]`, `[embed]`                                                                                              | Images, captions and embeds                                                                    | ✅  |
| `[audio]`, `[video]`                                                                                                             | Links to the files                                                                             | ⚠️  |
| Other shortcodes                                                                                                                 | Removed, the text inside kept, every place listed in the report                                | ⚠️  |
| Elementor, Divi, WPBakery, Beaver Builder, Avada                                                                                 | Text and images kept, layout lost, listed in the report                                        | ⚠️  |
| Oxygen, Bricks                                                                                                                   | Detected only (their content is not in post content)                                           | ❌  |
| Old URLs                                                                                                                         | Redirects in six formats or in the Payload redirects plugin                                    | ✅  |
| Comments, menus, custom post types                                                                                               | Counted and reported, not imported                                                             | ❌  |
| WPML, Polylang, WooCommerce, ACF                                                                                                 | Detected and reported, not imported                                                            | ❌  |
| All in One SEO, SEOPress                                                                                                         | Detected only                                                                                  | ❌  |
| Users, passwords, roles                                                                                                          | Never imported                                                                                 | ❌  |

✅ migrated · ⚠️ migrated with loss, always reported · ❌ not migrated in 0.1

## Commands

### analyze

```bash
npx wp-to-payload analyze export.xml [--out <dir>] [--json]
```

Writes `report.json` and `report.md` to `wp-to-payload-report/` and prints a summary: counts of
posts, pages, media, categories, tags, authors and comments; custom post types; every
Gutenberg block with how the import handles it; shortcodes; page builders; SEO plugins;
WPML and Polylang; WooCommerce; ACF. It ends with a rating, **simple**, **medium** or
**complex**, and lists the reasons behind it. Page builders, WooCommerce and multilingual
content always make a site complex. `analyze` never needs Payload.

### scaffold

```bash
npx wp-to-payload scaffold [--out <dir>] [--slug-prefix <prefix>] [--force]
```

Writes collection configs to `src/collections/wp/`: `Posts`, `Pages`, `Categories`, `Tags`,
`Authors` and `Media`. Each has a `wpId` field, which is how repeated imports find what they
imported before. Posts and pages use drafts and a Lexical editor with code blocks, embeds and
tables. They get their `meta` fields from `@payloadcms/plugin-seo`.

The files are yours afterwards; existing files are never overwritten without `--force`. If
your project already has collections with these slugs (the Payload website template has
`posts`, `pages`, `categories` and `media`), scaffold stops and explains the options:
`--slug-prefix wp-`, removing yours, or mapping your own collections in the config file.

### import

```bash
npx wp-to-payload import export.xml [options]
```

Starts your project's Payload with `payload run`, so your `.env`, TypeScript config, database
adapter and hooks work as usual. Steps: media → categories → tags → authors → posts → pages →
(redirects).

| Option                |                                                                               |
| --------------------- | ----------------------------------------------------------------------------- |
| `--uploads-dir <dir>` | Local copy of `wp-content/uploads`; files found there are not downloaded      |
| `--offline`           | Never download; use only `--uploads-dir`                                      |
| `--dry-run`           | Check the schema and report what would be created or updated, without writing |
| `--only <list>`       | Only these steps, e.g. `--only posts,pages`                                   |
| `--write-redirects`   | Also write redirects into the `@payloadcms/plugin-redirects` collection       |
| `--limit <n>`         | At most n posts and n pages, for a first test                                 |
| `--media-host <host>` | Another host media may be downloaded from (a CDN); repeatable                 |
| `--refresh-media`     | Upload files again even if they were imported before                          |
| `--concurrency <n>`   | Parallel downloads (default 4)                                                |
| `--max-media-mb <n>`  | Skip larger files (default 100)                                               |
| `--report-dir <dir>`  | Where `import-report.json` and `import-report.md` go                          |

Path options (`--post-path` and others, see [URLs](#urls)) are accepted too, because links in
the content are rewritten to the new URLs.

Every document gets the WordPress ID in `wpId`. A second run updates those documents; media
already imported are not uploaded again. Only fields that exist in your collections are
written, and each missing field is reported once, so the import also works with collections
you designed yourself. The report lists everything that could not be moved as it was, with a
code per kind of problem; see [docs/warnings.md](docs/warnings.md).

Media are only downloaded from the site's own hosts and the ones you allow with
`--media-host`. Password-protected posts are imported as drafts, so their content does not
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
posts at `/posts/:slug`, pages at `/:slug`.

| Token                     | Value                                                     |
| ------------------------- | --------------------------------------------------------- |
| `:slug`                   | The item's slug                                           |
| `:path`                   | Slugs of the parent pages and the page, e.g. `about/team` |
| `:year`, `:month`, `:day` | Publication date                                          |
| `:category`               | First category with its parents, e.g. `recipes/bread`     |
| `:id`                     | WordPress ID                                              |

```bash
npx wp-to-payload redirects export.xml --post-path /blog/:slug --page-path /:path --category-path /blog/category/:path
```

## Configuration file

Options that you would repeat on every run can go into `wp-to-payload.config.json` in the
project root. Everything is optional:

```json
{
  "paths": { "post": "/blog/:slug", "page": "/:path", "category": "/blog/category/:path" },
  "siteHosts": ["staging.example.com"],
  "collections": { "posts": "articles", "media": "media" },
  "fields": { "featuredImage": "heroImage" },
  "seo": { "separator": "|" },
  "media": { "hosts": ["cdn.example.com"] },
  "importAuthorEmails": false
}
```

- `paths`: URL patterns per type (`post`, `page`, `category`, `tag` or a custom post type).
- `siteHosts`: more hostnames of the old site, so links to them count as internal.
- `collections`: your collection slugs, if they differ from `posts`, `pages`, `categories`,
  `tags`, `authors`, `media` and `redirects`.
- `fields`: your field names for posts and pages, if they differ (`title`, `slug`, `content`,
  `excerpt`, `publishedAt`, `author`, `categories`, `tags`, `featuredImage`, `parent`, `meta`,
  `wpId`).
- `seo.separator`: what `%%sep%%` (Yoast) and `%sep%` (Rank Math) become. Default `-`.
- `media.hosts`: hosts media may be downloaded from besides the site.
- `importAuthorEmails`: copy author e-mail addresses. Off by default, because they are
  personal data.

## Limitations

- **Page builders.** For Elementor, Divi, WPBakery, Beaver Builder and Avada, the text and
  images come over and the layout does not. Elementor content is taken from the HTML that
  Elementor stores in the post; if that is empty, the post is empty.
- **Images inside paragraphs** are placed between the paragraph's halves, because a Lexical
  upload is a block of its own.
- **Internal links** become links to the new URL, not Lexical links to the document.
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

- WPML and Polylang to Payload localization
- WooCommerce products
- ACF fields
- Custom post types, comments and menus
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
