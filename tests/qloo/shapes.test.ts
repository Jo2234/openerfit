import { expect, it } from 'vitest';
import { describeResponseShape, SHAPE_LIMITS } from '../../scripts/qloo-shapes';

it('smoke shape paths include nested and flattened affinity without response values', () => {
  const diagnostic = describeResponseShape({results: {entities: [
    {entity_id: 'fx-nested', name: 'PRIVATE-ENTITY-NAME', query: {affinity: 0.9127}},
    {entity_id: 'fx-flat', affinity: 0.8032},
  ]}});
  expect(diagnostic.paths).toContain('body.results.entities[].query.affinity:number');
  expect(diagnostic.paths).toContain('body.results.entities[].affinity:number');
  expect(diagnostic.truncated).toBe(false);
  for (const value of ['PRIVATE-ENTITY-NAME', 'fx-nested', 'fx-flat', '0.9127', '0.8032']) {
    expect(JSON.stringify(diagnostic)).not.toContain(value);
  }
});

it('shape traversal caps depth, breadth, array sampling, path/key size and output', () => {
  const wide = Object.fromEntries(Array.from({length: 2000}, (_, i) => [`field${i}`, i]));
  const deep: Record<string, unknown> = {};
  let cursor = deep;
  for (let i = 0; i < 100; i++) { const next = {}; cursor.next = next; cursor = next; }
  for (const body of [wide, deep, Array.from({length: 2000}, () => wide), {["x".repeat(1000)]: 'PRIVATE-VALUE'}]) {
    const diagnostic = describeResponseShape(body);
    expect(diagnostic.truncated).toBe(true);
    expect(diagnostic.paths.length).toBeLessThanOrEqual(SHAPE_LIMITS.lines);
    expect(diagnostic.paths.every(p => p.length <= SHAPE_LIMITS.pathChars + 10)).toBe(true);
    expect(JSON.stringify(diagnostic)).not.toContain('PRIVATE-VALUE');
  }
  // Cyclic inputs cannot escape the depth/node limits, even outside JSON transport.
  const cycle: Record<string, unknown> = {}; cycle.self = cycle;
  expect(describeResponseShape(cycle).truncated).toBe(true);
});
