import type { Plugin } from 'vite';

/** One line per package link at the top of node_modules (`name -> target`) and per folder of `.pnpm`, sorted. */
export function dependencyLayout(root: string): string;
export function dependencyLayoutKey(root: string): string;
/** A Vite plugin for vitest.config.ts: adds the layout key of `root` to the key of every module Vitest caches. */
export function fsModuleCacheFollowsDependencies(root: string): Plugin;
