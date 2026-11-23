/*
 * The catalog of MCP servers (WEBU-18, spec 8.7): names, write-only values, deleting names the projects, and a run
 * that fails at once on a runner that misses a server of its project. Also: going on after GitHub was disconnected.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { now } from '@/lib/clock';
import { asUser, failure, resetApi } from '@/test/api';
import { getProjectAgents, saveProjectAgents } from './agents';
import { getDb, saveDb } from './db';
import { connectGithubApp, disconnectGithub } from './github';
import { deleteMcpServer, listMcpServers, saveMcpServer } from './mcp';
import { listRunners } from './runners';
import { advance, getItemAgents, resumeThread, retryRun, START_DELAY_MS } from './runs';

beforeEach(resetApi);

const SECRET = 'ctx7sk-demo-0000-feldwerk';

describe('the catalog of MCP servers', () => {
  it('lists the servers with the projects that use them and the runners that miss them, never a value', async () => {
    const servers = (await listMcpServers()).items;
    expect(servers.map((server) => server.name)).toEqual(['context7', 'playwright', 'sequential-thinking']);
    const context7 = servers.find((server) => server.name === 'context7')!;
    expect(context7.env).toEqual([{ name: 'CONTEXT7_API_KEY', set: true }]);
    expect(context7.projects.map((project) => project.identifier)).toEqual(['WEB']);
    expect(context7.missing_on.map((runner) => runner.name)).toEqual(['mac-mini-alt']);
    expect(JSON.stringify(servers)).not.toContain(SECRET);
  });

  it('takes a name of small letters, digits and -, unique, never werkbuch, and a command without arguments', async () => {
    for (const [name, message] of [
      ['werkbuch', 'werkbuch bekommt jeder Agent schon'],
      ['Playwright', 'Kleinbuchstaben'],
      ['mein server', 'Kleinbuchstaben'],
      ['playwright', 'gibt es schon'],
    ]) {
      const refused = await failure(saveMcpServer({ name, command: 'npx', args: [], env: [] }));
      expect(refused.errors?.name?.[0]).toContain(message);
    }
    expect((await failure(saveMcpServer({ name: 'github-docs', command: 'npx -y docs', args: [], env: [] }))).errors?.command?.[0]).toContain('Argumente stehen darunter');
    const saved = await saveMcpServer({ name: 'github-docs', command: 'npx', args: ['-y', ' docs-mcp ', ''], env: [{ name: 'DOCS_TOKEN', value: 'geheim' }] });
    expect(saved).toMatchObject({ name: 'github-docs', args: ['-y', 'docs-mcp'], env: [{ name: 'DOCS_TOKEN', set: true }], projects: [] });
    expect(JSON.stringify(saved)).not.toContain('geheim');
  });

  it('keeps a stored value unless a new one comes, and needs a value for a new variable', async () => {
    const id = 'mcp_context7';
    const kept = await saveMcpServer({ id, name: 'context7', command: 'npx', args: ['-y', '@upstash/context7-mcp'], env: [{ name: 'CONTEXT7_API_KEY', value: null }] });
    expect(kept.env).toEqual([{ name: 'CONTEXT7_API_KEY', set: true }]);
    expect(getDb().mcp_servers.find((server) => server.id === id)?.env[0].value).toBe(SECRET);
    await saveMcpServer({ id, name: 'context7', command: 'npx', args: [], env: [{ name: 'CONTEXT7_API_KEY', value: 'neu' }] });
    expect(getDb().mcp_servers.find((server) => server.id === id)?.env[0].value).toBe('neu');
    expect((await failure(saveMcpServer({ id, name: 'context7', command: 'npx', args: [], env: [{ name: 'OTHER', value: null }] }))).errors?.['env.0.value']?.[0]).toBe('Gib einen Wert an.');
  });

  it('is changed by org admins only', async () => {
    asUser('u_jonas');
    expect((await listMcpServers()).items).toHaveLength(3);
    expect((await failure(saveMcpServer({ name: 'x', command: 'npx', args: [], env: [] }))).status).toBe(403);
    expect((await failure(deleteMcpServer('mcp_playwright'))).status).toBe(403);
  });

  it('says which projects lose a deleted server, and takes it out of them', async () => {
    expect(await deleteMcpServer('mcp_playwright')).toEqual({ projects: ['WEB'] });
    expect((await getProjectAgents('p_web')).mcp_server_ids).toEqual(['mcp_context7']);
    expect((await listRunners()).items.find((runner) => runner.name === 'mac-mini-alt')?.missing_mcp.map((server) => server.name)).toEqual(['context7', 'sequential-thinking']);
    expect(await deleteMcpServer('mcp_sequential')).toEqual({ projects: [] });
  });

  it('is ticked per project only from the catalog', async () => {
    const settings = await getProjectAgents('p_web');
    expect((await failure(saveProjectAgents({ ...settings, mcp_server_ids: ['mcp_gone'] }))).errors?.['mcp_server_ids.0']?.[0]).toContain('gibt es nicht mehr');
  });
});

describe('a run on a runner that misses a server of its project', () => {
  it('fails at once, before the CLI, and names the servers (WEB-54 on mac-mini-alt)', async () => {
    const seeded = (await getItemAgents('WEB-54')).runs[0];
    expect(seeded).toMatchObject({ status: 'failed', runner_name: 'mac-mini-alt' });
    expect(seeded.error).toContain('„playwright“, „context7“ fehlen auf mac-mini-alt');

    // the old Mac comes back online and the run starts again: it fails again at once
    getDb().runners.find((runner) => runner.id === 'rn_mini')!.online = true;
    saveDb();
    await retryRun('run_web54_task');
    advance(getDb(), new Date(now().getTime() + START_DELAY_MS + 100));
    saveDb();
    const again = (await getItemAgents('WEB-54')).runs.at(-1)!;
    expect(again).toMatchObject({ status: 'failed', attempt: 2, started_at: again.finished_at });
    expect(again.error).toContain('bevor Claude Code startete');
  });
});

describe('going on after GitHub was disconnected', () => {
  it('waits for a repo, then queues a correction on the same strand', async () => {
    await disconnectGithub();
    expect((await failure(resumeThread('WEB-51'))).reason).toBe('no_repo');
    await connectGithubApp('agent');
    await connectGithubApp('review');
    await saveProjectAgents({ ...(await getProjectAgents('p_web')), repo: 'feldwerk/website' });
    const run = await resumeThread('WEB-51');
    expect(run).toMatchObject({ type: 'correction', status: 'queued', thread_id: 'th_web51' });
    expect((await getItemAgents('WEB-51')).thread).toMatchObject({ status: 'open', corrections: 1 });
    expect((await failure(resumeThread('WEB-51'))).reason).toBe('nothing_to_resume');
  });
});
