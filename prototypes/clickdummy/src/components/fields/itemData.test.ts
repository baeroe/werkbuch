import { describe, expect, it } from 'vitest';
import { projectMembers, users } from '@/api/seed/people';
import type { ProjectMember, User } from '@/types';
import { projectPeople } from './itemData';

const names = (people: User[]) => people.map((user) => user.name);
/** The seed's memberships without Mara in APP: she stays an org admin. */
const withoutMaraInApp: ProjectMember[] = projectMembers.filter((member) => !(member.project_id === 'p_app' && member.user_id === 'u_mara'));

describe('projectPeople (spec 4.8, 4.16, 4.2)', () => {
  it('offers the active members of the project, people first and bots after them, each by name', () => {
    // Sven is deactivated, Theo only reads WEB but is a member there
    expect(names(projectPeople(users, projectMembers, 'p_web'))).toEqual(['Ida Brenner', 'Jonas Feld', 'Lene Vogt', 'Mara Lindqvist', 'Theo Okafor', 'Kira']);
  });

  it('offers an org admin who is no member, since admins have access to every project', () => {
    expect(names(projectPeople(users, withoutMaraInApp, 'p_app'))).toContain('Mara Lindqvist');
  });

  it('offers the default bot only where it is a member itself, although it is an org admin', () => {
    expect(names(projectPeople(users, projectMembers, 'p_web'))).not.toContain('Automation');
    const automationInWeb: ProjectMember[] = [...projectMembers, { project_id: 'p_web', user_id: 'u_automation', role: 'member' }];
    expect(names(projectPeople(users, automationInWeb, 'p_web'))).toContain('Automation');
  });
});
