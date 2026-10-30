import { describe, expect, it } from 'vitest';
import { initI18n } from '@/lib/i18n';
import { ApiError, MAX_PER_PAGE, reasonText } from './client';

describe('ApiError', () => {
  it('carries status, reason, field errors and extensions, and takes its message from the detail', () => {
    const error = new ApiError({
      status: 422,
      reason: 'validation_failed',
      detail: 'Der Titel fehlt.',
      errors: { title: ['Pflichtfeld'] },
      extensions: { hint: 1 },
    });

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('ApiError');
    expect(error.message).toBe('Der Titel fehlt.');
    expect(error.status).toBe(422);
    expect(error.reason).toBe('validation_failed');
    expect(error.errors).toEqual({ title: ['Pflichtfeld'] });
    expect(error.extensions).toEqual({ hint: 1 });
  });

  it('has no extensions and no current state unless it is given some', () => {
    const error = new ApiError({ status: 500, reason: 'server_error', detail: 'Kaputt.' });

    expect(error.extensions).toEqual({});
    expect(error.current).toBeUndefined();
  });

  it('exposes the stored state of a conflict as current', () => {
    const current = { id: 'wi_1', title: 'Stand auf dem Server' };
    const error = new ApiError({ status: 409, reason: 'description_conflict', extensions: { current } });

    expect(error.current).toBe(current);
  });

  it('falls back to the text of the reason when there is no detail (a 404 has none)', () => {
    const error = new ApiError({ status: 404, reason: 'not_found' });

    expect(error.message).toBe('Das Item gibt es nicht oder du darfst es nicht sehen.');
  });
});

describe('reasonText', () => {
  it('gives the text of a known reason in the language of the page', () => {
    expect(reasonText('transition_not_allowed')).toBe('Der Übergang ist im Workflow nicht erlaubt.');
  });

  it('follows the language of the page', () => {
    initI18n({ locale: 'en', translations: { 'problem.reason.in_use': 'This is still in use.' } });

    expect(reasonText('in_use')).toBe('This is still in use.');
  });

  it('names the code of an unknown reason', () => {
    expect(reasonText('mystery')).toBe('Abgelehnt (mystery).');
  });
});

describe('MAX_PER_PAGE', () => {
  it('is the largest page the API serves', () => {
    expect(MAX_PER_PAGE).toBe(100);
  });
});
