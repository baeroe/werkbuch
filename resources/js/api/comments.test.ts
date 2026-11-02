import { afterEach, describe, expect, it } from 'vitest';
import { mockApi, type MockApi } from '@/test/api';
import { list, makeComment, web47Comments } from '@/test/fixtures';
import { textDoc } from '@/lib/richtext';
import { addComment, deleteComment, editComment, listComments, toggleReaction } from './comments';

let api: MockApi;

afterEach(() => api.restore());

const sent = () => api.calls.map(({ method, url }) => `${method} ${url}`);

describe('comments', () => {
  it('lists a page of the comments of an item by its key or id, oldest first', async () => {
    api = mockApi({ 'GET /api/v1/work-items/WEB-47/comments': () => ({ body: { ...list(web47Comments, 3), meta: { next_cursor: 'c2', total: 3 } } }) });

    expect(await listComments('WEB-47', { cursor: 'c1', per_page: 2 })).toEqual({ items: web47Comments, next_cursor: 'c2', total: 3 });
    expect(sent()).toEqual(['GET /api/v1/work-items/WEB-47/comments?cursor=c1&per_page=2']);
  });

  it('adds a comment with its text as body_json and answers the comment', async () => {
    const body = textDoc('Sehe ich auch.');
    const comment = makeComment({ id: 'c_new', body: 'Sehe ich auch.', body_json: body });
    api = mockApi({ 'POST /api/v1/work-items/wi_web_47/comments': () => ({ status: 201, body: { data: comment } }) });

    expect(await addComment('wi_web_47', body)).toEqual(comment);
    expect(api.calls[0]).toEqual({ method: 'POST', url: '/api/v1/work-items/wi_web_47/comments', body: { body_json: body } });
  });

  it('refuses an empty comment with the sentence of the server at body_json', async () => {
    api = mockApi({
      'POST /api/v1/work-items/wi_web_47/comments': () => ({ status: 422, body: { reason: 'validation_failed', errors: { body_json: ['Der Kommentar ist leer.'] } } }),
    });

    await expect(addComment('wi_web_47', textDoc(''))).rejects.toMatchObject({ status: 422, errors: { body_json: ['Der Kommentar ist leer.'] } });
  });

  it('edits a comment with a PATCH and answers it marked as edited', async () => {
    const body = textDoc('Nur unter iOS 18.1.');
    const edited = makeComment({ body_json: body, edited_at: '2026-10-28T10:00:00.000Z' });
    api = mockApi({ 'PATCH /api/v1/comments/c_1': () => ({ body: { data: edited } }) });

    expect(await editComment('c_1', body)).toEqual(edited);
    expect(api.calls[0]).toEqual({ method: 'PATCH', url: '/api/v1/comments/c_1', body: { body_json: body } });
  });

  it('deletes a comment', async () => {
    api = mockApi({ 'DELETE /api/v1/comments/c_1': () => ({ status: 204 }) });

    await expect(deleteComment('c_1')).resolves.toBeUndefined();
    expect(sent()).toEqual(['DELETE /api/v1/comments/c_1']);
  });

  it('adds the own reaction with a PUT and takes it back with a DELETE, both answering the comment (A242)', async () => {
    const reacted = makeComment({ reactions: [{ emoji: '👍🏽', user_ids: ['u_mara'] }] });
    api = mockApi({
      'PUT /api/v1/comments/c_1/reactions': () => ({ body: { data: reacted } }),
      'DELETE /api/v1/comments/c_1/reactions': () => ({ body: { data: makeComment() } }),
    });

    expect(await toggleReaction('c_1', '👍🏽', true)).toEqual(reacted);
    expect(await toggleReaction('c_1', '👍🏽', false)).toEqual(makeComment());
    expect(api.calls).toEqual([
      { method: 'PUT', url: '/api/v1/comments/c_1/reactions', body: { emoji: '👍🏽' } },
      { method: 'DELETE', url: `/api/v1/comments/c_1/reactions?emoji=${encodeURIComponent('👍🏽')}`, body: undefined },
    ]);
  });
});
