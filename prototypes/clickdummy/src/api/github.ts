/*
 * The GitHub connection of the instance (WEBU-18, spec 10.2 and 11.3): one app from a manifest flow (push, PRs, merge,
 * reviews, webhooks) and the repos it is installed on. The demo plays GitHub: `connectGithub` stands for the manifest
 * flow and the installation on the chosen repos. Private keys and webhook secrets never leave the server.
 */

import type { GithubApp, GithubConnection } from '@/types';
import { requireOrgAdmin } from './access';
import { read, write } from './client';
import { cancelThread } from './runs';
import { github as seeded } from './seed/agents';

/** The connection; everybody reads it (the project settings choose a repo), only org admins change it. */
export function getGithub(): Promise<GithubConnection> {
  return read(({ db }) => db.github);
}

/** The manifest flow of the app and its installation on the chosen repos (spec 11.3). */
export function connectGithub(): Promise<GithubConnection> {
  return write(({ db, me, stamp }) => {
    requireOrgAdmin(me, 'GitHub verbinden dürfen nur Org-Admins.');
    const app: GithubApp = { ...seeded.app!, name: `${db.organization.name} werkbuch`, created_at: stamp };
    // the repos chosen at GitHub: the demo installs the app where it was before
    db.github = { app, repos: seeded.repos.map((repo) => ({ ...repo })) };
    return db.github;
  });
}

/**
 * Disconnects GitHub: the app is forgotten here (it stays at GitHub until somebody deletes it there), the
 * projects lose their repo, open strands of projects that had one pause and what runs on them is canceled (it could
 * not push any more). PR and
 * branch stay at GitHub; a strand goes on when its item is assigned to the bot again (spec 7.2).
 */
export function disconnectGithub(): Promise<GithubConnection> {
  return write((ctx) => {
    const { db, me } = ctx;
    requireOrgAdmin(me, 'GitHub trennen dürfen nur Org-Admins.');
    // only strands of projects with a repo need GitHub; a project without one works in a folder and goes on
    const withRepo = new Set(db.project_agents.filter((settings) => settings.repo !== null).map((settings) => settings.project_id));
    db.github = { app: null, repos: [] };
    for (const settings of db.project_agents) settings.repo = null;
    for (const thread of db.agent_threads) {
      const projectId = db.items.find((item) => item.id === thread.item_id)?.project_id;
      if (thread.status !== 'open' || !projectId || !withRepo.has(projectId)) continue;
      thread.status = 'paused';
      thread.pause_reason = 'github';
      cancelThread(ctx, thread.id, me.id);
    }
    return db.github;
  });
}
