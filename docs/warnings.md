# Warning codes

`import` lists everything it could not move exactly as it was in
`wp-to-payload-report/import-report.json` and `import-report.md`. Each warning has a code,
a message, and usually the WordPress ID and type of the item (`wpId`, `wpType`) and the
block, shortcode, URL or field it is about (`subject`).

Warnings never stop the import. Errors do not stop it either: a document that Payload
rejects is listed under `errors`, the import carries on with the next one, and the command
exits with code 1.

## Content

| Code                 | Meaning                                                                                                                                                             | What to do                                                         |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `BLOCK_REMOVED`      | A block without stored content was removed: dynamic blocks (latest posts, query loops, navigation, …), reusable blocks, or plugin blocks that render on the server. | Rebuild the feature in your front end if you still need it.        |
| `BLOCK_UNKNOWN`      | A block without a converter; its saved HTML was converted as it is.                                                                                                 | Check the result; plugin blocks often need a custom Payload block. |
| `BLOCK_PARTIAL`      | A block was converted with loss (cover, media & text, pullquote, verse, details, audio, video, file).                                                               | Check layout-heavy posts.                                          |
| `SHORTCODE_REMOVED`  | A plugin shortcode was removed. Text between its opening and closing tag was kept.                                                                                  | Replace forms, sliders and the like with Payload blocks.           |
| `BUILDER_MARKUP`     | The item was made with a page builder. Text and images were kept, the layout was not.                                                                               | Rebuild the layout with Payload blocks.                            |
| `IMAGE_NOT_FOUND`    | An image in the content is not in the export's media library, or was not imported. It became a link.                                                                | Import the missing file and run the import again.                  |
| `IFRAME_REMOVED`     | An iframe other than YouTube or Vimeo became a link.                                                                                                                | Use an embed block if you need it.                                 |
| `EMBED_AS_LINK`      | An embed or a media player became a link, because the editor has no `embed` block or the element was a player.                                                      | Add the scaffolded `embed` block to the editor.                    |
| `CODE_AS_TEXT`       | A code block became inline code, because the editor has no code block.                                                                                              | Add Payload's `CodeBlock` to the editor (scaffold does).           |
| `TABLE_FLATTENED`    | A table became one paragraph per row, because the editor has no table feature.                                                                                      | Add `EXPERIMENTAL_TableFeature` (scaffold does).                   |
| `ELEMENT_REMOVED`    | Scripts, forms or embedded objects were removed.                                                                                                                    | Rebuild what they did in your front end.                           |
| `PASSWORD_PROTECTED` | The post was password protected in WordPress and was imported as a draft.                                                                                           | Decide whether to publish it or protect it in Payload.             |

## SEO

| Code            | Meaning                                                                                                                      | What to do                                                       |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `SEO_VARIABLE`  | A Yoast or Rank Math template variable depends on the live request (page number, current date, search term) and was removed. | Check the SEO title or description.                              |
| `SEO_CANONICAL` | The item has a canonical URL pointing elsewhere, and the `meta` group has no `canonical` field.                              | Add a `canonical` text field to `meta` and run the import again. |

## Media

| Code            | Meaning                                                                                    | What to do                                                                          |
| --------------- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| `MEDIA_FAILED`  | A file could not be downloaded (HTTP error, timeout, network).                             | Use `--uploads-dir` with a copy of `wp-content/uploads`, or run again.              |
| `MEDIA_SKIPPED` | A file was not downloaded: its host is not allowed, it is too large, or downloads are off. | Allow the host with `--media-host`, raise `--max-media-mb`, or use `--uploads-dir`. |

## Structure

| Code                | Meaning                                                                                                   | What to do                                                              |
| ------------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `FIELD_MISSING`     | The target collection has no field for this data (reported once per field).                               | Add the field, or map it in `wp-to-payload.config.json` under `fields`. |
| `REFERENCE_MISSING` | A related item, such as a parent page, was not imported.                                                  | Import it (check `--only` and `--limit`).                               |
| `SLUG_CHANGED`      | Two posts had the same slug; the second got its WordPress ID appended.                                    | Choose a better slug if you like.                                       |
| `REDIRECT_CONFLICT` | Two items would get the same new URL, or an old URL is another item's new URL. The redirect was left out. | Adjust the path patterns.                                               |
| `XML_ERROR`         | The export file has XML errors; the broken parts were skipped.                                            | Run `analyze` to see the line numbers.                                  |
