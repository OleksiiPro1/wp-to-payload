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

| Code                 | Meaning                                                                                                                                    | What to do                                                                                                   |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `FIELD_MISSING`      | The target collection has no field for this data (reported once per field).                                                                | Add the field, or map it in `wp-to-payload.config.json` under `fields`.                                      |
| `COLLECTION_MISSING` | The Payload project has no collection for a step, so its media, terms, authors or items were not imported (reported once per collection).  | Run `scaffold export.xml`, or map the type to a collection under `collections`, `postTypes` or `taxonomies`. |
| `TYPE_SKIPPED`       | Items of a plugin's post type were not imported: form definitions and submissions, page builder templates, ACF settings, WooCommerce data. | Rebuild what you need in Payload. To import such a type anyway, name it under `postTypes`.                   |
| `REFERENCE_MISSING`  | A related item, such as a parent page or the item, term or file of an ACF field, was not imported.                                         | Import it (check `--only` and `--limit`).                                                                    |
| `SLUG_CHANGED`       | Two posts had the same slug; the second got its WordPress ID appended.                                                                     | Choose a better slug if you like.                                                                            |
| `REDIRECT_CONFLICT`  | Two items would get the same new URL, or an old URL is another item's new URL. The redirect was left out.                                  | Adjust the path patterns.                                                                                    |
| `XML_ERROR`          | The export file has XML errors; the broken parts were skipped.                                                                             | Run `analyze` to see the line numbers.                                                                       |

## Languages

| Code                  | Meaning                                                                                                                                                                                     | What to do                                                                                                 |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `LANGUAGE_SKIPPED`    | Items and terms in a language were not imported: Payload has no locale for it, or no localization at all (then only the default language is imported).                                      | Add the locale to `localization` in `payload.config.ts`, or map the language under `localization.locales`. |
| `TRANSLATION_DRAFT`   | A language version is not public in WordPress (draft, pending, private, password protected) while another one is. Payload publishes all locales of a document together, so it was left out. | Translate it in Payload, or publish it in WordPress and import again.                                      |
| `FIELD_NOT_LOCALIZED` | A field holds translations in WordPress, but is not localized in Payload, so only the default language's value was kept (reported once per field).                                          | Set `localized: true` on the field and import again.                                                       |

## Custom fields (ACF)

| Code                | Meaning                                                                                                                                                                                                                       | What to do                                                                                                    |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `ACF_FIELD_SKIPPED` | An ACF field is not imported: clone, Google map, user and password fields, tabs, messages and other fields that only arrange the editor, field types of other plugins, or a Payload field of another type with the same name. | Rebuild what you need in Payload; the message says how many items have a value. Passwords are never imported. |
| `ACF_FIELD_RENAMED` | An ACF field has the name of a field the collection has already (or a name Payload does not allow), so it was imported under another name, such as `acf_excerpt`.                                                             | Rename it in your collection if you like, and keep the import's name or map it in your code.                  |
| `ACF_FIELD_UNKNOWN` | Items store values of ACF fields that no field group in the export defines, so they were not imported. The theme registers those groups in code.                                                                              | Pass the theme's `acf-json` folder, or a JSON file from ACF's export tool, with `--acf-json` (or `acfJson`).  |
| `ACF_VALUE_INVALID` | A value does not fit its field: a choice that is not defined, a number or date that is not one, a row of flexible content whose layout is gone, a page link to an archive. It was left out.                                   | Fix the value in Payload, or in WordPress and import again.                                                   |
