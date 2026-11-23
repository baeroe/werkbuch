/*
 * The catalog of MCP servers of the organization (WEBU-18, spec 8.7 and 10.7): stdio servers that projects give their
 * agents, besides werkbuch's own. Only org admins change it. The values of the environment are write-only: no answer
 * gives them out, a reader learns which names are set. A save keeps a stored value unless it sends a new one.
 */

import type { McpServer, McpServerInput } from '@/types';
import { requireOrgAdmin } from './access';
import { FieldErrors, newId, notFound, paginate, read, write, type Page } from './client';
import type { Db } from './db';
import type { StoredMcpServer } from './seed/agents';

/** Small letters, digits and `-`, starting with a letter or digit (spec 8.7). */
export const MCP_NAME = /^[a-z0-9][a-z0-9-]{0,39}$/;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

/** A server as a reader gets it: env names with „set“, never a value; the projects that use it; runners that miss it. */
export function mcpView(db: Db, server: StoredMcpServer): McpServer {
  const { env, ...rest } = server;
  return {
    ...rest,
    args: [...server.args],
    env: env.map((entry) => ({ name: entry.name, set: entry.value !== '' })),
    projects: db.project_agents
      .filter((settings) => settings.mcp_server_ids.includes(server.id))
      .map((settings) => ({ id: settings.project_id, identifier: db.projects.find((project) => project.id === settings.project_id)?.identifier ?? '' })),
    missing_on: db.runners.filter((runner) => runner.missing_mcp.includes(server.id)).map((runner) => ({ id: runner.id, name: runner.name })),
  };
}

/** The catalog by name. Every account reads it (the project settings tick servers); values never leave. */
export function listMcpServers(): Promise<Page<McpServer>> {
  return read(({ db }) => paginate([...db.mcp_servers].sort((a, b) => a.name.localeCompare(b.name, 'de')).map((server) => mcpView(db, server))));
}

/** Creates or changes a server. An env value that is not sent (null, undefined) keeps the stored one. */
export function saveMcpServer(input: McpServerInput): Promise<McpServer> {
  return write(({ db, me, stamp }) => {
    requireOrgAdmin(me, 'MCP-Server verwalten nur Org-Admins.');
    const existing = input.id ? db.mcp_servers.find((server) => server.id === input.id) : undefined;
    if (input.id && !existing) throw notFound('Der MCP-Server');
    const errors = new FieldErrors();
    const name = input.name.trim();
    if (name === '') errors.add('name', 'Gib dem Server einen Namen, etwa playwright.');
    else if (name === 'werkbuch') errors.add('name', 'werkbuch bekommt jeder Agent schon, mit dem Token seines Auftrags.');
    else if (!MCP_NAME.test(name)) errors.add('name', 'Kleinbuchstaben, Ziffern und -, ohne Leerzeichen.');
    else if (db.mcp_servers.some((server) => server.id !== existing?.id && server.name === name)) errors.add('name', `Einen Server „${name}“ gibt es schon.`);
    if (input.command.trim() === '') errors.add('command', 'Gib den Befehl an, der den Server über stdio startet, etwa npx.');
    else if (/\s/.test(input.command.trim())) errors.add('command', 'Nur der Befehl; Argumente stehen darunter, eins je Zeile.');
    const seen = new Set<string>();
    const env = input.env.map((entry, index) => {
      const envName = entry.name.trim();
      if (!ENV_NAME.test(envName)) errors.add(`env.${index}.name`, 'Buchstaben, Ziffern und _, nicht mit einer Ziffer vorn.');
      else if (seen.has(envName)) errors.add(`env.${index}.name`, 'Diese Variable steht schon darüber.');
      seen.add(envName);
      const stored = existing?.env.find((candidate) => candidate.name === envName)?.value;
      const value = entry.value ?? stored ?? '';
      if (value === '') errors.add(`env.${index}.value`, 'Gib einen Wert an.');
      return { name: envName, value };
    });
    errors.throwIfAny();
    const server: StoredMcpServer = {
      id: existing?.id ?? newId('mcp'),
      name,
      command: input.command.trim(),
      args: input.args.map((arg) => arg.trim()).filter((arg) => arg !== ''),
      env,
      created_at: existing?.created_at ?? stamp,
    };
    if (existing) db.mcp_servers[db.mcp_servers.indexOf(existing)] = server;
    else db.mcp_servers.push(server);
    return mcpView(db, server);
  });
}

/** Deletes a server; the projects that used it lose it (the question named them). Answers which projects those were. */
export function deleteMcpServer(id: string): Promise<{ projects: string[] }> {
  return write(({ db, me }) => {
    requireOrgAdmin(me, 'MCP-Server verwalten nur Org-Admins.');
    const server = db.mcp_servers.find((entry) => entry.id === id);
    if (!server) throw notFound('Der MCP-Server');
    const projects = mcpView(db, server).projects.map((project) => project.identifier);
    db.mcp_servers = db.mcp_servers.filter((entry) => entry.id !== id);
    for (const settings of db.project_agents) settings.mcp_server_ids = settings.mcp_server_ids.filter((serverId) => serverId !== id);
    for (const runner of db.runners) runner.missing_mcp = runner.missing_mcp.filter((serverId) => serverId !== id);
    return { projects };
  });
}
