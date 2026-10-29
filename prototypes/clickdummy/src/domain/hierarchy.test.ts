import { describe, expect, it } from 'vitest';
import { types } from '@/api/seed/config';
import type { WorkItemType } from '@/types';
import { canHaveChildren, canHaveParent, childTypeId, typeChangeRefusal } from './hierarchy';

const typeNamed = (name: string) => types.find((type) => type.name === name)!;

describe('two levels: epics have children, everything else has a parent', () => {
  it('goes by the Epic mark of the type, never by its name', () => {
    expect(canHaveChildren(typeNamed('Epic'))).toBe(true);
    expect(canHaveParent(typeNamed('Epic'))).toBe(false);
    expect(canHaveChildren(typeNamed('Task'))).toBe(false);
    expect(canHaveParent(typeNamed('Task'))).toBe(true);

    // a type called "Epic" without the mark is a plain type, a type with the mark is an epic under any name
    const unmarked: WorkItemType = { ...typeNamed('Epic'), is_epic: false };
    const initiative: WorkItemType = { ...typeNamed('Kundenwunsch'), name: 'Initiative', is_epic: true };
    expect(canHaveChildren(unmarked)).toBe(false);
    expect(canHaveParent(unmarked)).toBe(true);
    expect(canHaveChildren(initiative)).toBe(true);
    expect(canHaveParent(initiative)).toBe(false);
  });

  it('says why a type change would break the two levels, in the words the API and the screens share', () => {
    expect(typeChangeRefusal('WEB-30', { hasChildren: true, hasParent: false }, typeNamed('Task'))).toBe('WEB-30 hat Kind-Items. Nur Epics können Kind-Items haben.');
    expect(typeChangeRefusal('WEB-48', { hasChildren: false, hasParent: true }, typeNamed('Epic'))).toBe('WEB-48 hat ein Eltern-Item. Epics haben kein Eltern-Item.');
    // what keeps the two levels
    expect(typeChangeRefusal('WEB-30', { hasChildren: true, hasParent: false }, typeNamed('Epic'))).toBeNull();
    expect(typeChangeRefusal('WEB-48', { hasChildren: false, hasParent: true }, typeNamed('Bug'))).toBeNull();
    expect(typeChangeRefusal('WEB-50', { hasChildren: false, hasParent: false }, typeNamed('Epic'))).toBeNull();
  });

  it('an unknown type has no children, and nothing says it cannot have a parent', () => {
    expect(canHaveChildren(undefined)).toBe(false);
    expect(canHaveParent(undefined)).toBe(true);
  });
});

describe('the type of a new child item', () => {
  // the organisation lists its types as Task, Bug, Epic, Kundenwunsch
  const project = (default_type_id: string, enabled_type_ids: string[]) => ({ default_type_id, enabled_type_ids });

  it('is the default type of the project when that may have a parent', () => {
    expect(childTypeId(project('t_bug', ['t_task', 't_bug', 't_epic']), types)).toBe('t_bug');
  });

  it('falls back in the order of the organisation, not of the project, when the default is an epic', () => {
    expect(childTypeId(project('t_epic', ['t_wish', 't_bug', 't_epic']), types)).toBe('t_bug');
  });

  it('passes over an archived default type, and a default the project does not enable', () => {
    const archivedTask = types.map((type) => (type.id === 't_task' ? { ...type, archived_at: '2026-10-01T09:00:00.000Z' } : type));
    expect(childTypeId(project('t_task', ['t_task', 't_bug', 't_epic']), archivedTask)).toBe('t_bug');
    expect(childTypeId(project('t_wish', ['t_task', 't_bug', 't_epic']), types)).toBe('t_task');
  });

  it('is null when no enabled type may have a parent', () => {
    expect(childTypeId(project('t_epic', ['t_epic']), types)).toBeNull();
  });
});
