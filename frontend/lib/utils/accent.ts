// Deterministic accent color from a stable id (e.g. a group's uuid).
// The hash is cheap, but the function is called per card per render on lists
// that can be 50+ rows long, so we memoize the result by id at the module
// level. The cache is unbounded but each entry is ~8 bytes; the universe of
// group/user ids per session is tiny.

const ACCENT_TILES = [
  '#0B617E', // teal
  '#2A8AA5', // aqua
  '#C08A5E', // sand
  '#D89E3A', // amber
  '#D26A4A', // coral
  '#C95F76', // rose
  '#8B5470', // plum
  '#7A8740', // olive
] as const;

const cache = new Map<string, string>();

export function accentForId(id: string): string {
  const cached = cache.get(id);
  if (cached !== undefined) return cached;

  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = ((hash << 5) - hash) + id.charCodeAt(i);
    hash |= 0;
  }
  const color = ACCENT_TILES[Math.abs(hash) % ACCENT_TILES.length]!;
  cache.set(id, color);
  return color;
}
