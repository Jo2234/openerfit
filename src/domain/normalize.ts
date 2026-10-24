/** §5.2 identity key; never use it as a display name. */
export function normalize(value: string): string {
  return value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/&/g, ' and ').replace(/[^\p{L}\p{N} ]/gu, '')
    .replace(/\s+/g, ' ').trim().replace(/^the /, '');
}
