import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadCoverage, mergeCoverage, normalizePath, parseArgs, remapCoverage, remapOnly, uncovered } from './coverage-merge.mjs';

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
  const built = (hits, mappings = 'AAEA,SAAS') => ({
    '/var/www/html/resources/js/x.ts': {
      path: '/var/www/html/resources/js/x.ts',
      statementMap: { 0: { start: { line: 1, column: 0 }, end: { line: 1, column: 9 } } },
      s: { 0: hits },
      fnMap: {},
      f: {},
      branchMap: {},
      b: {},
      // generated 1:0 → original 3:0 and 1:9 → 3:9
      inputSourceMap: { version: 3, sources: ['x.ts'], names: [], mappings },
    },
  });

  it('maps the runs of the built code back to the source lines and adds their hits', async () => {
    const mapped = await remapCoverage([built(1), built(2)]);

    const map = mergeCoverage(unit, [mapped], '/repo');
    expect(map.fileCoverageFor('/repo/resources/js/x.ts').getLineCoverage()).toEqual({ 3: 4, 5: 0, 7: 0 });
    expect(Object.values(mapped)[0].inputSourceMap).toBeUndefined();
  });

  it('adds up runs that a generator reads one at a time', async () => {
    let read = 0;
    const runs = (function* () {
      for (const hits of [1, 2, 3]) {
        read += 1;
        yield built(hits);
      }
    })();

    const mapped = await remapCoverage(runs);

    expect(read).toBe(3);
    expect(mergeCoverage({}, [mapped], '/repo').fileCoverageFor('/repo/resources/js/x.ts').getLineCoverage()).toEqual({ 3: 6 });
  });

  describe('per project', () => {
    const roots = [];
    afterEach(() => {
      for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
    });

    /** A repo with the unit coverage of x.ts and the given files below coverage/e2e (path → content). */
    const repo = (files, unitData = unit) => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'coverage-merge-'));
      roots.push(root);
      const write = (relative, data) => {
        fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
        fs.writeFileSync(path.join(root, relative), JSON.stringify(data));
      };
      write('coverage/unit/coverage-final.json', unitData);
      for (const [relative, data] of Object.entries(files)) {
        if (data === null) fs.mkdirSync(path.join(root, 'coverage/e2e', relative), { recursive: true });
        else write(`coverage/e2e/${relative}`, data);
      }
      return root;
    };
    const lines = (map, root) => map.fileCoverageFor(path.join(root, 'resources/js/x.ts')).getLineCoverage();
    const PROJECTS = ['desktop-light', 'desktop-dark', 'phone-light', 'phone-dark'];

    it('reads the files of every project recursively', async () => {
      const root = repo({
        'setup/a-0.json': built(1),
        'desktop-light/b-0.json': built(2),
        'phone-dark/deeper/c-0.json': built(4),
      });

      expect(lines(await loadCoverage(root), root)).toEqual({ 3: 8, 5: 0, 7: 0 });
    });

    it('needs the coverage of every project by name', async () => {
      const root = repo({
        'desktop-light/a-0.json': built(1),
        'desktop-dark/a-0.json': built(1),
        'phone-light': null,
        'phone-dark/a-0.json': built(1),
      });
      await expect(loadCoverage(root, { shards: PROJECTS })).rejects.toThrow(/phone-light/);

      fs.writeFileSync(path.join(root, 'coverage/e2e/phone-light/a-0.json'), JSON.stringify(built(1)));
      expect(lines(await loadCoverage(root, { shards: PROJECTS }), root)).toEqual({ 3: 5, 5: 0, 7: 0 });

      fs.rmSync(path.join(root, 'coverage/e2e/desktop-dark'), { recursive: true });
      const error = await loadCoverage(root, { shards: PROJECTS }).then(
        () => null,
        (reason) => reason,
      );
      expect(error.message).toContain('desktop-dark');
      expect(error.message).not.toContain('desktop-light');
    });

    it('reads only the projects it names', async () => {
      const root = repo({ 'desktop-light/a-0.json': built(1), 'stale/a-0.json': built(5) });

      expect(lines(await loadCoverage(root, { shards: ['desktop-light'] }), root)).toEqual({ 3: 2, 5: 0, 7: 0 });
    });

    it('finds a project in a folder named after its artifact', async () => {
      const root = repo({ 'e2e-coverage-phone-dark/e2e-phone-dark.json': built(3), 'desktop-light.json': built(1) });

      const map = await loadCoverage(root, { shards: ['phone-dark', 'desktop-light'] });
      expect(lines(map, root)).toEqual({ 3: 5, 5: 0, 7: 0 });
    });

    it('refuses a name two sources could stand for', async () => {
      const root = repo({
        'phone-dark/a-0.json': built(1),
        'e2e-coverage-phone-dark/e2e-phone-dark.json': built(1),
      });

      await expect(loadCoverage(root, { shards: ['phone-dark'] })).rejects.toThrow(/phone-dark \(2 sources/);
    });

    it('counts a file without coverage as missing', async () => {
      const root = repo({ 'desktop-light.json': {} });

      await expect(loadCoverage(root, { shards: ['desktop-light'] })).rejects.toThrow(/desktop-light/);
    });

    it('counts a file with entries outside resources/js only as missing', async () => {
      const outside = (where) => ({ [where]: { ...built(1)['/var/www/html/resources/js/x.ts'], path: where } });
      const root = repo({
        'desktop-light/a-0.json': outside('/var/www/html/node_modules/x/index.js'),
        'desktop-dark/a-0.json': outside('/var/www/html/resources/js/x.test.ts'),
        'phone-dark/a-0.json': built(1),
      });

      const error = await loadCoverage(root, { shards: ['desktop-light', 'desktop-dark', 'phone-dark'] }).then(
        () => null,
        (reason) => reason,
      );
      expect(error.message).toContain('desktop-light (no coverage)');
      expect(error.message).toContain('desktop-dark (no coverage)');
      expect(error.message).not.toContain('phone-dark');
    });

    it('names the file it cannot read', async () => {
      const root = repo({ 'desktop-light/a-0.json': built(1) });
      fs.writeFileSync(path.join(root, 'coverage/e2e/desktop-light/a-1.json'), '{"cut off');

      await expect(loadCoverage(root, { shards: ['desktop-light'] })).rejects.toThrow(/desktop-light\/a-1\.json/);
      await expect(remapOnly(root, path.join(root, 'coverage/e2e-desktop-light.json'))).rejects.toThrow(/a-1\.json/);
    });

    it('writes nothing when there is no coverage to remap', async () => {
      const root = repo({ setup: null });
      const out = path.join(root, 'coverage/e2e-desktop-light.json');

      await expect(remapOnly(root, out)).rejects.toThrow(/No e2e coverage/);
      expect(fs.existsSync(out)).toBe(false);
    });

    it('gives the same lines whether runs are remapped one by one or together', async () => {
      const together = repo({
        'setup/a-0.json': built(1),
        'desktop-light/b-0.json': built(2),
        'phone-dark/c-0.json': built(4),
      });

      // each project job sees its own run and the sign-in of the setup project
      const light = repo({ 'setup/a-0.json': built(1), 'desktop-light/b-0.json': built(2) });
      const dark = repo({ 'setup/a-0.json': built(1), 'phone-dark/c-0.json': built(4) });
      const merged = repo({});
      for (const [job, name] of [[light, 'desktop-light'], [dark, 'phone-dark']]) {
        const out = path.join(job, `coverage/e2e-${name}.json`);
        await remapOnly(job, out);
        const artifact = path.join(merged, `coverage/e2e/e2e-coverage-${name}`);
        fs.mkdirSync(artifact, { recursive: true });
        fs.copyFileSync(out, path.join(artifact, `e2e-${name}.json`));
      }

      // the setup project ran in both jobs: its hits count twice, as in two runs of it
      const one = lines(await loadCoverage(merged, { shards: ['desktop-light', 'phone-dark'] }), merged);
      fs.writeFileSync(path.join(together, 'coverage/e2e/setup/a-1.json'), JSON.stringify(built(1)));
      expect(one).toEqual(lines(await loadCoverage(together), together));
      expect(one).toEqual({ 3: 9, 5: 0, 7: 0 });
    });

    it('gives the same statements whether runs are remapped one by one or together', async () => {
      // a source map that ends nowhere leaves the end column open: Infinity in memory, null in every file (Vitest's too)
      const open = (hits) => built(hits, 'AAEA');
      const vitest = {
        '/var/www/html/resources/js/x.ts': {
          ...file({ 0: 1 }),
          statementMap: { 0: { start: { line: 3, column: 0 }, end: { line: 3, column: null } } },
        },
      };
      const together = repo({ 'desktop-light/a-0.json': open(2) }, vitest);
      const job = repo({ 'desktop-light/a-0.json': open(2) }, vitest);
      await remapOnly(job, path.join(job, 'coverage/e2e/desktop-light.json'));
      fs.rmSync(path.join(job, 'coverage/e2e/desktop-light'), { recursive: true });

      const statements = async (root, options) => {
        const coverage = (await loadCoverage(root, options)).fileCoverageFor(path.join(root, 'resources/js/x.ts'));
        return { map: coverage.statementMap, hits: coverage.s };
      };
      const one = await statements(job, { shards: ['desktop-light'] });
      expect(await statements(together)).toEqual(one);
      expect(one.hits).toEqual({ 0: 3 });
    });

    it('keeps a remapped file apart from the runs of the built code', async () => {
      const job = repo({ 'phone-dark/a-0.json': built(4) });
      await remapOnly(job, path.join(job, 'coverage/e2e-phone-dark.json'));
      const root = repo({ 'desktop-light/a-0.json': built(2) });
      fs.copyFileSync(path.join(job, 'coverage/e2e-phone-dark.json'), path.join(root, 'coverage/e2e/phone-dark.json'));

      expect(lines(await loadCoverage(root), root)).toEqual({ 3: 7, 5: 0, 7: 0 });
    });

    it('writes one mapped file without the source maps and never reads its own output again', async () => {
      const root = repo({ 'desktop-light/a-0.json': built(2) });
      const out = path.join(root, 'coverage/e2e/desktop-light.json');

      await remapOnly(root, out);
      await remapOnly(root, out);

      const written = JSON.parse(fs.readFileSync(out, 'utf8'));
      expect(Object.values(written).map((coverage) => coverage.inputSourceMap)).toEqual([undefined]);
      const map = mergeCoverage({}, [written], '/repo');
      expect(map.fileCoverageFor('/repo/resources/js/x.ts').getLineCoverage()).toEqual({ 3: 2 });
    });

    it('reads its options', () => {
      expect(parseArgs([])).toEqual({ remapOnly: false, out: null, shards: null });
      expect(parseArgs(['--remap-only', '--out', 'coverage/e2e-phone-dark.json'])).toEqual({
        remapOnly: true,
        out: 'coverage/e2e-phone-dark.json',
        shards: null,
      });
      expect(parseArgs(['--out=x.json', '--remap-only'])).toEqual({ remapOnly: true, out: 'x.json', shards: null });
      expect(parseArgs(['--expect-shards=desktop-light, phone-dark,desktop-light'])).toEqual({
        remapOnly: false,
        out: null,
        shards: ['desktop-light', 'phone-dark'],
      });
      expect(() => parseArgs(['--remap-only'])).toThrow(/--out/);
      expect(() => parseArgs(['--out', 'x.json'])).toThrow(/--out goes with --remap-only/);
      expect(() => parseArgs(['--remap-only', '--out='])).toThrow(/--out needs a file/);
      expect(() => parseArgs(['--remap-only', '--out'])).toThrow(/--out needs a file/);
      expect(() => parseArgs(['--expect-shards='])).toThrow(/--expect-shards/);
      expect(() => parseArgs(['--expect-shards=a', '--remap-only', '--out', 'x.json'])).toThrow(/--expect-shards/);
      expect(() => parseArgs(['--shards=4'])).toThrow(/--shards=4/);
    });
  });
});

