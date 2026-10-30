/** Turns a title into a URL slug: lowercase ASCII words joined by hyphens. */
export const slugify = (text: string): string =>
  text
    .replace(/ß/g, 'ss')
    .replace(/[äÄ]/g, 'ae')
    .replace(/[öÖ]/g, 'oe')
    .replace(/[üÜ]/g, 'ue')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&[a-z0-9#]+;/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
