# Security

## Reporting a vulnerability

Please report vulnerabilities privately through
[GitHub security advisories](https://github.com/oleksiipro1/wp-to-payload/security/advisories/new),
not in public issues. You will get an answer within a week.

## How wp-to-payload handles data

- It runs on your machine and sends nothing anywhere: no telemetry, no external service.
- The only network requests are media downloads during `import`, and only from the old site's
  hosts and the hosts you allow with `--media-host`. Files are size-limited, and `--offline`
  turns downloads off.
- With `--uploads-dir`, files are only read from inside that directory, whatever paths the
  export contains.
- Passwords, roles and post passwords are never imported. Password-protected posts are
  imported as drafts. Author e-mail addresses are only imported when you enable it.
- Scripts, forms and unknown iframes are removed from content before it is written.
- Reports (`wp-to-payload-report/`) contain titles, URLs and excerpts of your content. Do
  not publish them if the site's content is not public.
