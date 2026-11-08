/*
 * Vitest's module cache on disk (`fsModuleCache`, on by default, node_modules/.vitest-cache) keeps every transformed
 * module with its imports already resolved to the pnpm folder of the package it uses:
 * `__vite_ssr_import__("/node_modules/.pnpm/@inertiajs+react@3.9.1_…/dist/index.js")`. Its key covers the module's own
 * text and the config, and Vitest throws the cache away only when the lockfile changes. When node_modules is relinked
 * without a change of the lockfile (an install outside it, as on 2026-11-08 from the Mac) and the new link does not
 * resolve (its folder not or no longer there), a cached `lib/links.ts` still imports the old folder while
 * `vi.mock('@inertiajs/react')` of its test resolves the package anew and fails: the mock misses, the real `usePage`
 * runs, and the tests fail with "usePage must be used within the Inertia component" instead of the true cause.
 *
 * The plugin puts the layout of node_modules into every cache key: the target of each package link at the top and the
 * folders of `.pnpm`. A run that starts on another layout than the run before uses other keys, so it never takes a
 * module cached for the old one. The layout is read once, when the run starts (about a thousand directory entries): a
 * change of node_modules in the middle of a run, as on 2026-11-08, still breaks that run, and the next one is clean.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

function entries(directory) {
  try {
    return fs.readdirSync(directory).sort();
  } catch {
    return [];
  }
}

/** One line per package link at the top of node_modules (`name -> target`) and per folder of `.pnpm`, sorted. */
export function dependencyLayout(root) {
  const modules = path.join(root, 'node_modules');
  const lines = [];
  const link = (name) => {
    try {
      lines.push(`${name} -> ${fs.readlinkSync(path.join(modules, name))}`);
    } catch {
      // a file or a folder of its own, no link: nothing a cached module resolved through
    }
  };

  for (const entry of entries(modules)) {
    if (entry.startsWith('.')) continue;
    if (entry.startsWith('@')) entries(path.join(modules, entry)).forEach((name) => link(`${entry}/${name}`));
    else link(entry);
  }
  entries(path.join(modules, '.pnpm')).forEach((folder) => lines.push(`.pnpm/${folder}`));

  return lines.sort().join('\n');
}

export function dependencyLayoutKey(root) {
  return createHash('sha1').update(dependencyLayout(root)).digest('hex');
}

/** A Vite plugin for vitest.config.ts: adds the layout key of `root` to the key of every module Vitest caches. */
export function fsModuleCacheFollowsDependencies(root) {
  return {
    name: 'werkbuch:fs-module-cache-follows-dependencies',
    configureVitest({ defineCacheKeyGenerator }) {
      const key = dependencyLayoutKey(root);
      defineCacheKeyGenerator(() => key);
    },
  };
}
