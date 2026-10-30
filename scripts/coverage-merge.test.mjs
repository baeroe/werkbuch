import { describe, expect, it } from 'vitest';
import { mergeCoverage, normalizePath, remapCoverage, uncovered } from './coverage-merge.mjs';

// one file, three statements on lines 3, 5 and 7, as Istanbul writes it
const file = (hits) => ({
  path: '/var/www/html/resources/js/x.ts',
  statementMap: {
    0: { start: { line: 3, column: 0 }, end: { line: 3, column: 9 } },
    1: { start: { line: 5, column: 0 }, end: { line: 5, column: 9 } },
    2: { start: { line: 7, column: 0 }, end: { line: 7, column: 9 } },
  },
  s: hits,
  fnMap: {},
  f: {},
  branchMap: {},
  b: {},
});
const unit = { '/var/www/html/resources/js/x.ts': file({ 0: 1, 1: 0, 2: 0 }) };
const e2e = {
  '/home/runner/work/werkbuch/werkbuch/resources/js/x.ts': { ...file({ 0: 0, 1: 2, 2: 0 }), path: '/home/runner/work/werkbuch/werkbuch/resources/js/x.ts' },
};

describe('coverage-merge', () => {
  it('normalizes container, runner and Mac paths to the repo', () => {
    expect(normalizePath('/var/www/html/resources/js/lib/i18n.ts', '/repo')).toBe('/repo/resources/js/lib/i18n.ts');
    expect(normalizePath('/home/runner/work/werkbuch/werkbuch/resources/js/app.tsx', '/repo')).toBe('/repo/resources/js/app.tsx');
    expect(normalizePath('/repo/resources/js/lib/i18n.test.ts', '/repo')).toBeNull();
    expect(normalizePath('/repo/node_modules/x/index.js', '/repo')).toBeNull();
  });

  it('adds the hits of unit and e2e runs per line', () => {
    const map = mergeCoverage(unit, [e2e], '/repo');
    expect(map.files()).toEqual(['/repo/resources/js/x.ts']);
    expect(map.fileCoverageFor('/repo/resources/js/x.ts').getLineCoverage()).toEqual({ 3: 1, 5: 2, 7: 0 });
  });

  it('lists the lines nobody ran', () => {
    expect(uncovered(mergeCoverage(unit, [e2e], '/repo'), '/repo')).toEqual([{ file: 'resources/js/x.ts', lines: [7] }]);
  });

  // the browser's view of x.ts: one statement on line 1 of the built code, which its source map puts on line 3
  const built = (hits) => ({
    '/var/www/html/resources/js/x.ts': {
      path: '/var/www/html/resources/js/x.ts',
      statementMap: { 0: { start: { line: 1, column: 0 }, end: { line: 1, column: 9 } } },
      s: { 0: hits },
      fnMap: {},
      f: {},
      branchMap: {},
      b: {},
      // generated 1:0 → original 3:0 and 1:9 → 3:9
      inputSourceMap: { version: 3, sources: ['x.ts'], names: [], mappings: 'AAEA,SAAS' },
    },
  });

  it('maps the runs of the built code back to the source lines and adds their hits', async () => {
    const mapped = await remapCoverage([built(1), built(2)]);

    const map = mergeCoverage(unit, [mapped], '/repo');
    expect(map.fileCoverageFor('/repo/resources/js/x.ts').getLineCoverage()).toEqual({ 3: 4, 5: 0, 7: 0 });
    expect(Object.values(mapped)[0].inputSourceMap).toBeUndefined();
  });
});
