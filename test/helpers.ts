import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { readWxr } from '../src/wxr/reader.js'
import type { WxrParseIssue, WxrRecord } from '../src/wxr/model.js'

export const fixture = (name: string): string =>
  fileURLToPath(new URL(`./fixtures/wxr/${name}`, import.meta.url))

export const collect = async (source: string | Readable) => {
  const records: WxrRecord[] = []
  const issues: WxrParseIssue[] = []
  for await (const record of readWxr(source, { onIssue: (i) => issues.push(i) })) {
    records.push(record)
  }
  return { records, issues }
}

export const fromString = (xml: string): Readable => Readable.from([xml])

/** Wraps item XML in a minimal WXR document. */
export const wxr = (body: string, channel = ''): string => `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:excerpt="http://wordpress.org/export/1.2/excerpt/" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:wp="http://wordpress.org/export/1.2/">
<channel>
<title>Test Site</title>
<link>https://site.example.com</link>
<wp:wxr_version>1.2</wp:wxr_version>
<wp:base_site_url>https://site.example.com</wp:base_site_url>
<wp:base_blog_url>https://site.example.com</wp:base_blog_url>
${channel}
${body}
</channel>
</rss>`
