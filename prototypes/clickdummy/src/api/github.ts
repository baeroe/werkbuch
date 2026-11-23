/*
 * The GitHub connection of the instance (WEBU-18, spec 10.2 and 11.3): two apps from manifest flows, the agent app
 * (push, PRs, merge, webhooks) and the review app (approves only), and the repos both are installed on. The demo
 * plays GitHub: `connectGithubApp` stands for the manifest flow and the installation on the chosen repos. Private keys
 * and webhook secrets never leave the server, so nothing here holds them.
 */

import type { GithubApp, GithubConnection } from '@/types';
import { requireOrgAdmin } from './access';
import { conflict, read, write } from './client';
import { cancelThread } from './runs';
import { github as seeded } from './seed/agents';

export type AppKind = 'agent' | 'review';

/** The connection; everybody reads it (the project settings choose a repo), only org admins change it. */
export function getGithub(): Promise<GithubConnection> {
  return read(({ db }) => db.github);
}

/** The manifest flow of one app, and its installation; the review app only after the agent app. */
export function connectGithubApp(kind: AppKind): Promise<GithubConnection> {
  return write(({ db, me, stamp }) => {
    requireOrgAdmin(me, 'GitHub verbinden dürfen nur Org-Admins.');
    const org = db.organization.name;
    if (kind === 'review' && db.github.agent_app === null) throw conflict('agent_app_first', 'Lege zuerst die Agenten-App an.');
    const template = kind === 'agent' ? seeded.agent_app! : seeded.review_app!;
    const app: GithubApp = { ...template, name: kind === 'agent' ? `${org} werkbuch` : `${org} werkbuch review`, created_at: stamp };
    if (kind === 'agent') db.github.agent_app = app;
    else db.github.review_app = app;
    // the repos chosen at GitHub: the demo installs both apps where they were before
    db.github.repos = seeded.repos.map((repo) => ({ ...repo, agent_app: db.github.agent_app !== null && repo.agent_app, review_app: db.github.review_app !== null && repo.review_app }));
    return db.github;
  });
}

/**
 * Disconnects GitHub: both apps are forgotten here (they stay at GitHub until somebody deletes them there), the
 * projects lose their repo, open strands pause and what runs on them is canceled (it could not push any more). PR and
 * branch stay at GitHub; a strand goes on when its item is assigned to the bot again (spec 7.2).
 */
export function disconnectGithub(): Promise<GithubConnection> {
  return write((ctx) => {
    const { db, me } = ctx;
    requireOrgAdmin(me, 'GitHub trennen dürfen nur Org-Admins.');
    db.github = { agent_app: null, review_app: null, repos: [] };
    for (const settings of db.project_agents) settings.repo = null;
    for (const thread of db.agent_threads) {
      if (thread.status !== 'open') continue;
      thread.status = 'paused';
      thread.pause_reason = 'github';
      cancelThread(ctx, thread.id, me.id);
    }
    return db.github;
  });
}
