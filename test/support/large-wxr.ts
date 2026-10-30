import { createWriteStream } from 'node:fs'
import { once } from 'node:events'

/** Writes a synthetic WXR file of roughly `targetBytes` with posts of ~8 KB each. */
export const writeLargeWxr = async (file: string, targetBytes: number): Promise<number> => {
  const out = createWriteStream(file)
  const write = async (chunk: string) => {
    if (!out.write(chunk)) await once(out, 'drain')
  }
  await write(`<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:excerpt="http://wordpress.org/export/1.2/excerpt/" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:wp="http://wordpress.org/export/1.2/">
<channel><title>Large Example</title><link>https://large.example.com</link><wp:wxr_version>1.2</wp:wxr_version>
`)
  const paragraph = `<!-- wp:paragraph -->\n<p>${'Lorem ipsum dolor sit amet, synthetic text. '.repeat(18)}</p>\n<!-- /wp:paragraph -->\n\n`
  const body = paragraph.repeat(10)
  let written = 0
  let id = 0
  while (written < targetBytes) {
    id++
    const item = `<item><title>Post ${id}</title><link>https://large.example.com/post-${id}/</link><dc:creator><![CDATA[editor]]></dc:creator>
<content:encoded><![CDATA[${body}]]></content:encoded><wp:post_id>${id}</wp:post_id><wp:post_name>post-${id}</wp:post_name>
<wp:status>publish</wp:status><wp:post_type>post</wp:post_type><category domain="category" nicename="news"><![CDATA[News]]></category>
<wp:postmeta><wp:meta_key>_yoast_wpseo_metadesc</wp:meta_key><wp:meta_value><![CDATA[Description ${id}]]></wp:meta_value></wp:postmeta></item>
`
    await write(item)
    written += item.length
  }
  await write('</channel></rss>\n')
  out.end()
  await once(out, 'finish')
  return id
}
