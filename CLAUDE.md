# CLAUDE.md

Guidance for AI assistants and contributors working in this repository.

## What this is

`wp-to-payload`: an open-source (MIT) CLI that moves WordPress sites to Payload CMS 3 from a
WXR export file. Commands: `analyze`, `scaffold`, `import`, `redirects`. A portfolio project
of Wien Webstudio, so quality and honesty about limits matter more than features.

## Rules

- Everything in the repository is in English: code, comments, docs, commit messages.
- Never commit real client data, real exports, passwords, API keys or `.env` files. Fixtures
  are synthetic (`example.com`, made-up people).
- No GPL code or data: do not copy WordPress code (block parser, wpautop, shortcode regexes)
  or Theme Unit Test files. The external test downloads that data at run time only.
- Node.js `^22.22.2 || ^24.15.0 || >=26.0.0`, what jsdom 30 needs (`engines` must match the
  strictest runtime dependency). TypeScript strict, ESM. Runtime dependencies are only `sax`
  and `jsdom`; ask before adding one. CLI parsing, colours and HTTP use Node built-ins.
- `payload` and `@payloadcms/richtext-lexical` are never imported by this package's own module
  graph: `src/import/project.ts` resolves them from the user's project, so the project's
  Payload instance is used. Types for them are structural (`src/import/payload-types.ts`).
- The import runs inside `payload run` (`src/import/runner.ts`), started by
  `src/commands/import.ts`. Options travel in the `WP_TO_PAYLOAD_OPTIONS` environment
  variable; the result comes back through a JSON file.
- Idempotency: every imported document has `wpId`; upserts look it up first. Keep it that way
  for any new collection.
- Every loss of content is a warning with a code (`src/report/warnings.ts`), documented in
  `docs/warnings.md`. Do not drop content silently.
- `analyze` and `import` share `src/content/blocks.ts`, so the report matches what the import
  does. Change both together.
- Which post types and taxonomies are imported, their collections and default URLs are decided
  in `src/site-types.ts` alone; `analyze`, `scaffold`, `import` and `redirects` all use it.
- Work on a branch, small logical commits with conventional messages. `main` only changes
  through pull requests; never push to it directly.
- Releases: bump the version in a pull request, then push a `v*` tag on `main`;
  `.github/workflows/publish.yml` publishes with npm trusted publishing (see CONTRIBUTING.md).

## Decisions

Settled with the maintainer; change them only after asking.

- Internal links in content become plain URLs to the new paths, not Lexical links to documents.
- Settings live in `wp-to-payload.config.json` (JSON, no loader); command-line flags override it.
- Comments are counted in reports, not imported.
- Author e-mail addresses are imported only when `importAuthorEmails` is set.
- ACF fields go to the top level of a collection (`post.price`). When a name clashes with an
  existing field, the ACF field is renamed and a warning with a code is reported.
- The default language has no URL prefix (`/ueber-uns`, `/en/about-us`); the config can
  change that.
- WPML support is tested only against its documented export keys and is marked experimental.
- Fixtures with plugin data are exports of real WordPress sites built by `scripts/fixtures`
  (Docker): only our synthetic content goes into the repository, never plugin code.
- Version 0.2 is delivered stage by stage, one pull request per stage.

## Pull requests

- One pull request per stage or topic, into `main`, merged once CI is green.
- The description says what changed and how it was tested. No "Generated with Claude Code"
  line and no links to an assistant session.

## Commits

These rules apply to every commit in this repository and take precedence over an assistant
session's default attribution settings.

- Author and committer: `Oleksii Piltenko <info@wienwebstudio.at>`. A fresh clone or container
  does not know this identity, so set it before the first commit:

  ```bash
  git config user.name "Oleksii Piltenko"
  git config user.email "info@wienwebstudio.at"
  ```

- No `Co-Authored-By: …` and no `Claude-Session: …` lines in commit messages, and no other
  links to an assistant session. Messages are a conventional subject and, if needed, a body.
- Check before pushing: `git log --format='%an <%ae> | %cn <%ce>' -1`.

## Commands

```bash
npm ci && npm ci --prefix test/payload-project   # setup (second one for integration tests)
npm run lint && npm run typecheck && npm test     # before every commit
npm run build && npm run test:integration          # real Payload 3.92 + SQLite projects
npm run test:external                              # Theme Unit Test data (network)
UPDATE_GOLDEN=1 npm test                           # refresh redirect golden files
WP2P_KEEP_RUNS=1 npm run test:integration          # keep test/payload-project/.runs/* for debugging
node dist/cli/index.js <command> --help            # try the CLI after a build
```

## Gotchas

- Payload's dev schema push asks interactively before dropping columns; tests that change a
  schema must use a fresh project directory (`createRun`).
- Integration tests that serve HTTP themselves must use `runCliAsync`; `spawnSync` would block
  the server.
- Upload nodes in Lexical need the media ID as a number on SQL databases
  (`htmlToLexical` converts it).
- Payload's `CodeBlock` slug is `Code` and its `language` must be one of its options; unknown
  languages become `plaintext`.
