/*
 * Seed: the organisation, the people and bots, the three projects with their members, and the API tokens.
 */

import type { Organization, Project, ProjectMember, Token, User } from '@/types';
import { at, ZONE } from './helpers';

export const organization: Organization = {
  id: 'org_feldwerk',
  name: 'Feldwerk',
  locale: 'de',
  timezone: ZONE,
  week_start: 1,
  logo_url: null,
};

function person(id: string, name: string, handle: string, orgRole: User['org_role'] = 'member', disabledAt: string | null = null): User {
  return {
    id,
    type: 'person',
    name,
    handle,
    email: `${handle}@feldwerk.example.com`,
    org_role: orgRole,
    is_default_bot: false,
    owner_id: null,
    disabled_at: disabledAt,
    avatar_url: null,
    locale: 'de',
    timezone: ZONE,
  };
}

/** People first, then the bots. */
export const users: User[] = [
  person('u_mara', 'Mara Lindqvist', 'mara', 'admin'),
  person('u_jonas', 'Jonas Feld', 'jonas'),
  person('u_ida', 'Ida Brenner', 'ida'),
  person('u_theo', 'Theo Okafor', 'theo'),
  person('u_lene', 'Lene Vogt', 'lene'),
  person('u_sven', 'Sven Albers', 'sven', 'member', at('09-18 17:00')),
  {
    id: 'u_automation',
    type: 'bot',
    name: 'Automation',
    handle: 'automation',
    email: null,
    org_role: 'admin',
    is_default_bot: true,
    owner_id: null,
    description: 'Der Standard-Bot: Automatisierungen und Zeitpläne von Vorlagen handeln in seinem Namen.',
    disabled_at: null,
    avatar_url: null,
    locale: 'de',
    timezone: ZONE,
  },
  {
    id: 'u_kira',
    type: 'bot',
    name: 'Kira',
    handle: 'kira',
    email: null,
    org_role: 'member',
    is_default_bot: false,
    owner_id: 'u_mara',
    description: 'Agent von Mara. Arbeitet per MCP an Items, die ihr zugewiesen sind.',
    disabled_at: null,
    avatar_url: null,
    locale: 'de',
    timezone: ZONE,
  },
];

export const projects: Project[] = [
  {
    id: 'p_web',
    identifier: 'WEB',
    name: 'Website-Relaunch',
    description: 'Neuer Webauftritt: Struktur, Gestaltung, Technik und der Umzug auf den neuen Server.',
    image_url: null,
    lead_id: 'u_ida',
    visibility: 'public',
    workflow_id: 'wf_standard',
    enabled_type_ids: ['t_task', 't_bug', 't_epic'],
    default_type_id: 't_task',
    archived_at: null,
  },
  {
    id: 'p_app',
    identifier: 'APP',
    name: 'Kunden-App',
    description: 'Die App für Bestellungen und Rückfragen. Version 2.0 ist in der Beta.',
    image_url: null,
    lead_id: 'u_theo',
    visibility: 'public',
    workflow_id: 'wf_agency',
    enabled_type_ids: ['t_task', 't_bug', 't_epic', 't_wish'],
    default_type_id: 't_task',
    archived_at: null,
  },
  {
    id: 'p_ops',
    identifier: 'OPS',
    name: 'Infrastruktur',
    description: 'Server, Betrieb und Backups. Nur für das Technik-Team.',
    image_url: null,
    lead_id: 'u_jonas',
    visibility: 'private',
    workflow_id: 'wf_standard',
    enabled_type_ids: ['t_task', 't_bug', 't_epic'],
    default_type_id: 't_task',
    archived_at: null,
  },
];

/** Ida and Theo are not in OPS, which is private: that is what the visibility tests rely on. */
export const projectMembers: ProjectMember[] = [
  { project_id: 'p_web', user_id: 'u_mara', role: 'admin' },
  { project_id: 'p_web', user_id: 'u_ida', role: 'admin' },
  { project_id: 'p_web', user_id: 'u_jonas', role: 'member' },
  { project_id: 'p_web', user_id: 'u_lene', role: 'member' },
  { project_id: 'p_web', user_id: 'u_kira', role: 'member' },
  { project_id: 'p_web', user_id: 'u_theo', role: 'viewer' },
  { project_id: 'p_app', user_id: 'u_theo', role: 'admin' },
  { project_id: 'p_app', user_id: 'u_mara', role: 'member' },
  { project_id: 'p_app', user_id: 'u_jonas', role: 'member' },
  { project_id: 'p_app', user_id: 'u_lene', role: 'member' },
  { project_id: 'p_ops', user_id: 'u_jonas', role: 'admin' },
  { project_id: 'p_ops', user_id: 'u_mara', role: 'member' },
  { project_id: 'p_ops', user_id: 'u_kira', role: 'member' },
];

export const tokens: Token[] = [
  {
    id: 'tok_mara_claude',
    user_id: 'u_mara',
    name: 'Claude Code',
    abilities: ['read', 'write', 'mcp'],
    expires_at: null,
    last_used_at: at('10-28 09:05'),
    created_at: at('10-02 11:00'),
  },
  {
    id: 'tok_mara_ci',
    user_id: 'u_mara',
    name: 'CI-Skript',
    abilities: ['read'],
    expires_at: at('09-30 23:59'),
    last_used_at: at('09-29 22:15'),
    created_at: at('06-30 10:00'),
  },
  {
    id: 'tok_kira_agent',
    user_id: 'u_kira',
    name: 'Agent',
    abilities: ['read', 'write', 'mcp'],
    expires_at: null,
    last_used_at: at('10-27 09:41'),
    created_at: at('10-05 14:30'),
  },
];
