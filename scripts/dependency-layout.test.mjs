import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import config from '../vitest.config';
import { dependencyLayout, dependencyLayoutKey, fsModuleCacheFollowsDependencies } from './dependency-layout.mjs';

let root;

const linkPackage = (name, folder) => {
  const at = path.join(root, 'node_modules', name);
  fs.mkdirSync(path.dirname(at), { recursive: true });
  fs.mkdirSync(path.join(root, 'node_modules', '.pnpm', folder), { recursive: true });
  fs.rmSync(at, { force: true });
  fs.symlinkSync(path.join(name.startsWith('@') ? '../.pnpm' : '.pnpm', folder, 'node_modules', name), at);
};

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'layout-'));
  linkPackage('@inertiajs/react', '@inertiajs+react@3.9.1_react@19.3.1');
  linkPackage('vite', 'vite@8.3.5');
});

afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('dependency layout', () => {
  it('names the target of each package link and each folder of .pnpm, and nothing else', () => {
    fs.mkdirSync(path.join(root, 'node_modules', '.bin'));
    fs.mkdirSync(path.join(root, 'node_modules', 'own-folder'));

    expect(dependencyLayout(root).split('\n')).toEqual([
      '.pnpm/@inertiajs+react@3.9.1_react@19.3.1',
      '.pnpm/vite@8.3.5',
      '@inertiajs/react -> ../.pnpm/@inertiajs+react@3.9.1_react@19.3.1/node_modules/@inertiajs/react',
      'vite -> .pnpm/vite@8.3.5/node_modules/vite',
    ]);
  });

  it('gives another key when a package is relinked without a change of the lockfile', () => {
    const before = dependencyLayoutKey(root);
    expect(dependencyLayoutKey(root)).toBe(before);

    linkPackage('@inertiajs/react', '@inertiajs+react@3.11.0_react@19.3.1');
    const relinked = dependencyLayoutKey(root);
    expect(relinked).not.toBe(before);

    // back to the lockfile: the folder of the other version stays, the key still differs from both
    linkPackage('@inertiajs/react', '@inertiajs+react@3.9.1_react@19.3.1');
    expect(dependencyLayoutKey(root)).not.toBe(before);
    expect(dependencyLayoutKey(root)).not.toBe(relinked);
  });

  it('adds the key to the key of every module Vitest caches', () => {
    const generators = [];
    fsModuleCacheFollowsDependencies(root).configureVitest({ defineCacheKeyGenerator: (generator) => generators.push(generator) });

    expect(generators).toHaveLength(1);
    expect(generators[0]({ id: '/resources/js/lib/links.ts', sourceCode: '' })).toBe(dependencyLayoutKey(root));
  });

  it('is a plugin of the config of this repository', () => {
    expect((config.plugins ?? []).map((plugin) => plugin.name)).toContain('werkbuch:fs-module-cache-follows-dependencies');
  });
});
