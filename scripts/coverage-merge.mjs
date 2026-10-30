/*
 * The frontend coverage of Vitest (coverage/unit) and of the Playwright suite (coverage/e2e, written by e2e/fixtures.ts)
 * as one map over resources/js/**: `pnpm coverage:merge` writes coverage/merged/ and fails below 100 % lines.
 *
 * The runs see the same files under different paths (DDEV container, CI runner, Mac): every path is cut back to
 * `resources/js/…` and resolved against the repo. The e2e data come straight from the browser, in the coordinates of
 * the built code with its source map; they are mapped back to the sources first, with the same library Vitest uses,
 * so both runs name the same lines.
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createSourceMapStore } from '@vitest/istanbul-lib-source-maps';
import libCoverage from 'istanbul-lib-coverage';
import libReport from 'istanbul-lib-report';
import reports from 'istanbul-reports';

/** `…/resources/js/<rest>` as `<root>/resources/js/<rest>`; `null` for files outside it and for tests. */
export function normalizePath(file, root) {
  const relative = /(?:^|\/)(resources\/js\/.+)$/.exec(file.split('?')[0].replaceAll('\\', '/'))?.[1];
  if (!relative || /\.test\.[cm]?[jt]sx?$/.test(relative) || relative.startsWith('resources/js/test/')) return null;
  return path.resolve(root, relative);
}

/** One map from the unit run and the e2e runs, paths normalized against `root`; hits of the same spot add up. */
export function mergeCoverage(unit, e2e, root) {
  const map = libCoverage.createCoverageMap({});
  for (const data of [unit, ...e2e]) {
    for (const [key, coverage] of Object.entries(data)) {
      const file = normalizePath(coverage.path ?? key, root);
      if (file === null) continue;
      // a copy: merging writes into the file coverage it starts from
      const { inputSourceMap: _map, ...rest } = structuredClone(coverage);
      map.addFileCoverage({ ...rest, path: file });
    }
  }
  return map;
}

/**
 * Coverage data of the built code mapped back to the sources through the source maps they carry. The runs of one build
 * share their maps, so their hits are added up first and mapped once.
 */
export async function remapCoverage(runs) {
  const built = libCoverage.createCoverageMap({});
  for (const data of runs) built.merge(structuredClone(data));
  const mapped = await createSourceMapStore().transformCoverage(built);
  return Object.fromEntries(mapped.files().map((file) => [file, mapped.fileCoverageFor(file).toJSON()]));
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** Reads coverage/unit/coverage-final.json and every coverage/e2e/*.json below `root` and merges them. */
export async function loadCoverage(root) {
  const unitFile = path.join(root, 'coverage/unit/coverage-final.json');
  if (!fs.existsSync(unitFile)) throw new Error('No unit coverage: run `ddev exec pnpm test:coverage` first.');
  const e2eDir = path.join(root, 'coverage/e2e');
  const e2eFiles = fs.existsSync(e2eDir) ? fs.readdirSync(e2eDir).filter((name) => name.endsWith('.json')).sort() : [];
  const e2e = await remapCoverage(e2eFiles.map((name) => readJson(path.join(e2eDir, name))));
  return mergeCoverage(readJson(unitFile), [e2e], root);
}

/** The files with lines nobody ran, relative to `root`, with those lines. */
export function uncovered(map, root) {
  return map
    .files()
    .sort()
    .map((file) => ({
      file: path.relative(root, file),
      lines: map
        .fileCoverageFor(file)
        .getUncoveredLines()
        .map(Number)
        .sort((a, b) => a - b),
    }))
    .filter(({ lines }) => lines.length > 0);
}

async function main() {
  const root = path.resolve(import.meta.dirname, '..');
  let map;
  try {
    map = await loadCoverage(root);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }

  const out = path.join(root, 'coverage/merged');
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'coverage-final.json'), JSON.stringify(map.toJSON()));
  reports.create('text-summary').execute(libReport.createContext({ dir: out, coverageMap: map }));
  reports.create('html').execute(libReport.createContext({ dir: path.join(out, 'html'), coverageMap: map, defaultSummarizer: 'nested' }));

  const missing = uncovered(map, root);
  if (missing.length > 0) {
    console.error('\nLines without coverage (Vitest and Playwright together):');
    for (const { file, lines } of missing) console.error(`  ${file}: ${lines.join(', ')}`);
    console.error('\nFrontend coverage is below 100 % lines.');
    process.exit(1);
  }
  console.log('\nFrontend coverage: 100 % lines (Vitest and Playwright together).');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
