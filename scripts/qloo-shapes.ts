// Paths and primitive types only: response values never enter the diagnostic.
// Sample heterogeneous arrays, while bounding both traversal and printed output.
export const SHAPE_LIMITS = {
  depth: 8, nodes: 256, lines: 64, keysPerObject: 32,
  keyChars: 64, pathChars: 512, arraySamples: 3,
} as const;
export function describeResponseShape(body: unknown): {paths: string[]; truncated: boolean} {
  const paths = new Set<string>();
  let nodes = 0, truncated = false;
  function visit(value: unknown, path: string, depth: number): void {
    if (depth > SHAPE_LIMITS.depth || nodes >= SHAPE_LIMITS.nodes || paths.size >= SHAPE_LIMITS.lines || path.length > SHAPE_LIMITS.pathChars) {
      truncated = true;
      return;
    }
    nodes++;
    if (Array.isArray(value)) {
      paths.add(`${path}:array`);
      const samples = Math.min(value.length, SHAPE_LIMITS.arraySamples);
      if (samples < value.length) truncated = true;
      for (let i = 0; i < samples; i++) visit(value[i], `${path}[]`, depth + 1);
    } else if (value !== null && typeof value === 'object') {
      let count = 0;
      for (const key in value) {
        if (!Object.hasOwn(value, key)) continue;
        if (count++ >= SHAPE_LIMITS.keysPerObject || nodes >= SHAPE_LIMITS.nodes || paths.size >= SHAPE_LIMITS.lines) {
          truncated = true;
          break;
        }
        // Skip oversized property names instead of echoing arbitrary long keys.
        if (key.length > SHAPE_LIMITS.keyChars) { truncated = true; continue; }
        visit((value as Record<string, unknown>)[key], `${path}.${key}`, depth + 1);
      }
    } else {
      paths.add(`${path}:${value === null ? 'null' : typeof value}`);
    }
  }
  visit(body, 'body', 0);
  return {paths: [...paths], truncated};
}
