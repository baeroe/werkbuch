/*
 * The frontend coverage of Vitest (coverage/unit) and of the Playwright suite (coverage/e2e/<project>/, written by
 * e2e/fixtures.ts) as one map over resources/js/**: `pnpm coverage:merge` writes coverage/merged/ and fails below 100 %
 * lines. The gate holds for the sum only: no Playwright project covers everything on its own (the drawer of the phone,
 * the dark theme, touch menus).
 *
 * The runs see the same files under different paths (DDEV container, CI runner, Mac): every path is cut back to
 * `resources/js/…` and resolved against the repo. The e2e data come straight from the browser, in the coordinates of
 * the built code with its source map; they are mapped back to the sources first, with the same library Vitest uses,
 * so both runs name the same lines.
 *
 * Options:
 * - `--remap-only --out <file>`: maps every file below coverage/e2e back to the sources once and writes them as one
 *   file of a few MB (a CI job of one project uploads only that); no report, no gate, and exit code 1 without a file to
 *   map. Hits add up the same before and after the mapping, as long as all runs come from the same build.
 * - `--expect-shards=<name,name,…>`: reads exactly the coverage of these projects, each from
 *   `coverage/e2e/<name>.json`, `coverage/e2e/<name>/` or a folder `coverage/e2e/<prefix>-<name>/` (as
 *   download-artifact names it), and fails naming every project that has none. Without it every file below
 *   coverage/e2e counts.
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
 *
 * `runs` may be any iterable, also a generator that reads one file per step: a full run leaves well over a thousand
 * files of about 2 MB each (every one carries the source maps), and holding them all at once ran Node out of heap.
 * Only the added-up map stays in memory, one entry per source file.
 */
export async function remapCoverage(runs) {
  const built = libCoverage.createCoverageMap({});
  for (const data of runs) built.merge(structuredClone(data));
  const mapped = await createSourceMapStore().transformCoverage(built);
  // as a file holds it: an end the source map leaves open is `Infinity` in memory and `null` in JSON, as in Vitest's
  // coverage-final.json; merged with `Infinity` the same statement would count twice, under two keys
  const data = Object.fromEntries(mapped.files().map((file) => [file, mapped.fileCoverageFor(file).toJSON()]));
  return JSON.parse(JSON.stringify(data));
}

/** The data of a coverage file; a file cut off or broken (a job stopped by its timeout) fails naming it. */
function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`Cannot read ${file}: ${error.message}`, { cause: error });
  }
}

/** The `*.json` files below `dir` at any depth, sorted; none for a folder that does not exist. */
function jsonFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => path.join(entry.parentPath, entry.name))
    .sort();
}

/**
 * Reads coverage files one at a time and returns their data for `mergeCoverage`. Entries of the built code (they carry
 * their source map) are added up and mapped once (see remapCoverage); entries already mapped (a file of
 * `--remap-only`) stay as they are: mapped once more they would add up with entries of the built code under the same
 * path, statement by statement of two different maps. `count(file, data)` hears the data of each file.
 */
async function readRuns(files, count = () => {}) {
  const mapped = [];
  const remapped = await remapCoverage(
    (function* () {
      for (const file of files) {
        const data = readJson(file);
        count(file, data);
        const built = {};
        const done = {};
        for (const [key, coverage] of Object.entries(data)) (coverage.inputSourceMap ? built : done)[key] = coverage;
        if (Object.keys(done).length > 0) mapped.push(done);
        yield built;
      }
    })(),
  );
  return [remapped, ...mapped];
}

/**
 * The files of each named project below `e2eDir`: `<name>.json`, `<name>/` or `<prefix>-<name>/`. Fails naming every
 * project with no such source, with a source without files, or with more than one source.
 */
function shardFiles(e2eDir, names) {
  const entries = fs.existsSync(e2eDir) ? fs.readdirSync(e2eDir, { withFileTypes: true }) : [];
  const problems = [];
  const shards = names.map((name) => {
    const sources = entries.filter((entry) =>
      entry.isDirectory()
        ? entry.name === name || entry.name.endsWith(`-${name}`)
        : entry.isFile() && entry.name === `${name}.json`,
    );
    if (sources.length > 1) {
      problems.push(`${name} (${sources.length} sources: ${sources.map((entry) => entry.name).join(', ')})`);
      return { name, files: [] };
    }
    const source = sources[0] && path.join(e2eDir, sources[0].name);
    const files = !source ? [] : sources[0].isFile() ? [source] : jsonFiles(source);
    if (files.length === 0) problems.push(`${name} (no coverage)`);
    return { name, files };
  });
  if (problems.length > 0) throw new Error(missingMessage(problems));
  return shards;
}

function missingMessage(problems) {
  return (
    `E2e coverage missing for: ${problems.join(', ')}. ` +
    'Expected coverage/e2e/<name>.json, coverage/e2e/<name>/ or coverage/e2e/<prefix>-<name>/ with coverage in it.'
  );
}

/**
 * Reads coverage/unit/coverage-final.json and the e2e coverage below `root` and merges them: with `shards` the
 * coverage of exactly these projects (see shardFiles; a project whose files hold no entry fails as well), otherwise
 * every `*.json` below coverage/e2e at any depth.
 */
export async function loadCoverage(root, { shards = null } = {}) {
  const unitFile = path.join(root, 'coverage/unit/coverage-final.json');
  if (!fs.existsSync(unitFile)) throw new Error('No unit coverage: run `ddev exec pnpm test:coverage` first.');
  const e2eDir = path.join(root, 'coverage/e2e');
  if (shards === null) return mergeCoverage(readJson(unitFile), await readRuns(jsonFiles(e2eDir)), root);

  const found = shardFiles(e2eDir, shards);
  const shardOf = new Map(found.flatMap(({ name, files }) => files.map((file) => [file, name])));
  const entries = new Map(shards.map((name) => [name, 0]));
  // only entries the merge keeps count: a file of node_modules or of tests alone leaves the project without coverage
  const kept = (data) =>
    Object.entries(data).filter(([key, coverage]) => normalizePath(coverage.path ?? key, root) !== null).length;
  const e2e = await readRuns(
    found.flatMap(({ files }) => files),
    (file, data) => entries.set(shardOf.get(file), entries.get(shardOf.get(file)) + kept(data)),
  );
  const empty = shards.filter((name) => entries.get(name) === 0);
  if (empty.length > 0) throw new Error(missingMessage(empty.map((name) => `${name} (no coverage)`)));
  return mergeCoverage(readJson(unitFile), e2e, root);
}

/**
 * `--remap-only`: every file below coverage/e2e (but `out` itself) mapped back to the sources once and written to `out`
 * as one coverage file. Returns the number of files read; with none it fails and writes nothing (the merge would refuse
 * the empty file later, with a cause further away).
 */
export async function remapOnly(root, out) {
  const target = path.resolve(root, out);
  const files = jsonFiles(path.join(root, 'coverage/e2e')).filter((file) => path.resolve(file) !== target);
  if (files.length === 0) throw new Error('No e2e coverage below coverage/e2e to remap: did the tests run?');
  const map = libCoverage.createCoverageMap({});
  for (const data of await readRuns(files)) map.merge(data);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(map.toJSON()));
  return files.length;
}

/** The options of the command line (see the head of this file). */
export function parseArgs(argv) {
  const options = { remapOnly: false, out: null, shards: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--remap-only') options.remapOnly = true;
    else if (arg === '--out' || arg.startsWith('--out=')) {
      options.out = arg === '--out' ? (argv[(index += 1)] ?? '') : arg.slice('--out='.length);
      if (options.out === '') throw new Error('--out needs a file.');
    } else if (arg.startsWith('--expect-shards=')) {
      const names = arg
        .slice('--expect-shards='.length)
        .split(',')
        .map((name) => name.trim())
        .filter(Boolean);
      options.shards = [...new Set(names)];
      if (options.shards.length === 0) throw new Error('--expect-shards needs the names of the projects.');
    } else throw new Error(`Unknown option ${arg}.`);
  }
  if (options.remapOnly && options.out === null) throw new Error('--remap-only needs --out <file>.');
  if (!options.remapOnly && options.out !== null) throw new Error('--out goes with --remap-only only.');
  if (options.remapOnly && options.shards !== null) {
    throw new Error('--expect-shards goes with the merge, not with --remap-only.');
  }
  return options;
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
    const options = parseArgs(process.argv.slice(2));
    if (options.remapOnly) {
      const read = await remapOnly(root, options.out);
      console.log(`Remapped ${read} coverage files of coverage/e2e to ${options.out}.`);
      return;
    }
    map = await loadCoverage(root, { shards: options.shards });
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
