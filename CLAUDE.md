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
- Node.js 22.12+, TypeScript strict, ESM. Runtime dependencies are only `sax` and `jsdom`;
  ask before adding one. CLI parsing, colours and HTTP use Node built-ins.
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
- Work on a branch, small logical commits with conventional messages. Do not push to `main`.

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
