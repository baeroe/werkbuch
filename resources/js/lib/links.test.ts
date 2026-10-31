import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { appUrl, instanceOrigin, paths, useActivePath, useSearchParam } from './links';

let currentUrl = '/';

vi.mock('@inertiajs/react', () => ({ usePage: () => ({ url: currentUrl }) }));

beforeEach(() => {
  currentUrl = '/';
});

describe('paths', () => {
  it('are the routes of the app', () => {
    expect(paths.home()).toBe('/');
    expect(paths.myItems()).toBe('/my-items');
    expect(paths.created()).toBe('/created');
    expect(paths.subscribed()).toBe('/subscribed');
    expect(paths.inbox()).toBe('/inbox');
    expect(paths.views()).toBe('/views');
    expect(paths.view('v_roadmap')).toBe('/views/v_roadmap');
    expect(paths.projects()).toBe('/projects');
    expect(paths.newProject()).toBe('/projects?create=1');
    expect(paths.item('WEB-47')).toBe('/items/WEB-47');
    expect(paths.login()).toBe('/login');
    expect(paths.logout()).toBe('/logout');
    expect(paths.forgotPassword()).toBe('/forgot-password');
    expect(paths.invitation('abc')).toBe('/invitations/abc');
  });

  it('name a project with an optional layout', () => {
    expect(paths.project('WEB')).toBe('/projects/WEB');
    expect(paths.project('WEB', 'board')).toBe('/projects/WEB?layout=board');
    expect(paths.project('WEB', 'timeline')).toBe('/projects/WEB?layout=timeline');
  });

  it('name the areas of a project with an optional page, template or section', () => {
    expect(paths.wiki('WEB')).toBe('/projects/WEB/wiki');
    expect(paths.wiki('WEB', 'pg_web_structure')).toBe('/projects/WEB/wiki/pg_web_structure');
    expect(paths.templates('APP')).toBe('/projects/APP/templates');
    expect(paths.templates('APP', 'tpl_app_report')).toBe('/projects/APP/templates/tpl_app_report');
    expect(paths.projectSettings('OPS')).toBe('/projects/OPS/settings');
    expect(paths.projectSettings('OPS', 'members')).toBe('/projects/OPS/settings/members');
  });

  it('name the settings of the organisation and of the person with an optional section', () => {
    expect(paths.settings()).toBe('/settings');
    expect(paths.settings('relation-types')).toBe('/settings/relation-types');
    expect(paths.me()).toBe('/me');
    expect(paths.me('security')).toBe('/me/security');
  });

  it('name the editor of a workflow as a view of the workflows section', () => {
    expect(paths.workflow('01jbworkflow')).toBe('/settings/workflows?workflow=01jbworkflow');
    expect(paths.workflow('a&b')).toBe('/settings/workflows?workflow=a%26b');
    expect(paths.newWorkflow()).toBe('/settings/workflows?workflow=new');
    expect(paths.newWorkflow('wf_agency')).toBe('/settings/workflows?workflow=new&from=wf_agency');
  });

  it('encode what a person or a mail brings along', () => {
    expect(paths.resetPassword('t', 'a+b@example.com')).toBe('/reset-password/t?email=a%2Bb%40example.com');
    expect(paths.item('a/b')).toBe('/items/a%2Fb');
  });
});

describe('addresses', () => {
  it('appUrl puts the origin of the page before the path', () => {
    expect(appUrl('/items/WEB-47')).toBe(`${window.location.origin}/items/WEB-47`);
  });

  it('instanceOrigin is the origin of the page', () => {
    expect(instanceOrigin()).toBe(window.location.origin);
  });
});

describe('useActivePath', () => {
  const active = (to: string, end?: boolean, also?: string[]) => renderHook(() => useActivePath(to, end, also)).result.current;

  it('is true on exactly the path', () => {
    currentUrl = '/inbox';

    expect(active('/inbox', true)).toBe(true);
    expect(active('/inbox')).toBe(true);
  });

  it('counts the paths below as active, unless it is told to end there', () => {
    currentUrl = '/projects/WEB/wiki';

    expect(active('/projects')).toBe(true);
    expect(active('/projects', true)).toBe(false);
    expect(active('/proj')).toBe(false);
  });

  it('is true on one of the further paths', () => {
    currentUrl = '/created';

    expect(active('/my-items', true)).toBe(false);
    expect(active('/my-items', true, ['/created', '/subscribed'])).toBe(true);
  });

  it('ignores the query, the hash and a trailing slash', () => {
    currentUrl = '/projects/WEB/?layout=board#top';

    expect(active('/projects/WEB', true)).toBe(true);
  });

  it('keeps the root path', () => {
    currentUrl = '/';

    expect(active('/', true)).toBe(true);
  });
});

describe('useSearchParam', () => {
  const param = (name: string) => renderHook(() => useSearchParam(name)).result.current;

  it('reads one parameter of the query of the page', () => {
    currentUrl = '/settings/workflows?workflow=new&from=wf_agency';

    expect(param('workflow')).toBe('new');
    expect(param('from')).toBe('wf_agency');
  });

  it('is null when the parameter is not there', () => {
    currentUrl = '/settings/workflows';

    expect(param('workflow')).toBeNull();
  });

  it('decodes what the path encoded', () => {
    currentUrl = paths.workflow('a&b');

    expect(param('workflow')).toBe('a&b');
  });
});
