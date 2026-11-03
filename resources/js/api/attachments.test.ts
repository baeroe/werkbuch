import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockApi, type MockApi } from '@/test/api';
import { makeAttachment } from '@/test/fixtures';
import { FakeXhr, installFakeXhr, restoreFakeXhr } from '@/test/xhr';
import { ApiError } from './client';
import { attachmentUrl, deleteAttachment, getAttachment, setAttachmentLimit, uploadAttachment } from './attachments';

let api: MockApi | undefined;

beforeEach(() => installFakeXhr());

afterEach(() => {
  api?.restore();
  api = undefined;
  restoreFakeXhr();
});

const file = (name = 'screenshot.png', type = 'image/png') => new File(['png'], name, { type });

describe('attachments', () => {
  it('reads one attachment by its id', async () => {
    const attachment = makeAttachment();
    api = mockApi({ 'GET /api/v1/attachments/att_1': () => ({ body: { data: attachment } }) });

    expect(await getAttachment('att_1')).toEqual(attachment);
  });

  it('uploads a picture for a text without an owner, reports the progress and answers the attachment (A232)', async () => {
    const attachment = makeAttachment();
    const onProgress = vi.fn();
    const picture = file();

    const call = uploadAttachment('p_web', picture, { type: 'work_item', id: 'wi_web_47' }, 'inline', { onProgress });
    const xhr = FakeXhr.last;
    xhr.progress(24, 48);
    xhr.answer(201, { data: attachment });

    expect(await call).toEqual(attachment);
    expect(onProgress).toHaveBeenCalledWith(0.5);
    expect(xhr.opened).toEqual(['POST', '/api/v1/attachments']);
    expect(Object.fromEntries(xhr.sent!.entries())).toEqual({ project_id: 'p_web', kind: 'inline', file: picture });
  });

  it('uploads a file for the file list of an item with the item as its owner', async () => {
    const attachment = makeAttachment({ kind: 'file', filename: 'log.txt', owner: { type: 'work_item', id: 'wi_web_47' } });
    const log = file('log.txt', 'text/plain');

    const call = uploadAttachment('p_web', log, { type: 'work_item', id: 'wi_web_47' }, 'file');
    FakeXhr.last.answer(201, { data: attachment });

    expect(await call).toEqual(attachment);
    expect(Object.fromEntries(FakeXhr.last.sent!.entries())).toEqual({ project_id: 'p_web', kind: 'file', work_item_id: 'wi_web_47', file: log });
  });

  it('turns a file that is too large into an ApiError payload_too_large', async () => {
    const call = uploadAttachment('p_web', file(), null, 'inline');
    FakeXhr.last.answer(413, { reason: 'payload_too_large', detail: '„screenshot.png“ ist größer als 25 MB.' });

    const error = await call.then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 413, reason: 'payload_too_large', message: '„screenshot.png“ ist größer als 25 MB.' });
  });

  it('refuses a file over the limit before it goes out, and names the limit in any 413 (F29)', async () => {
    setAttachmentLimit(1);
    try {
      const big = new File([new Uint8Array(1024 * 1024 + 1)], 'gross.png', { type: 'image/png' });
      await expect(uploadAttachment('p_web', big, null, 'inline')).rejects.toMatchObject({ status: 413, reason: 'payload_too_large', message: 'Uploads können höchstens 1 MB groß sein.' });
      expect(FakeXhr.all).toEqual([]);

      // under the limit it goes; a web server in front refuses it without a problem document: the sentence names the limit
      const call = uploadAttachment('p_web', file(), null, 'inline');
      FakeXhr.last.answer(413, '<html>413</html>', 'text/html');
      await expect(call).rejects.toMatchObject({ status: 413, message: 'Uploads können höchstens 1 MB groß sein.' });
    } finally {
      setAttachmentLimit(null);
    }
  });

  it('stops an upload when the signal aborts', async () => {
    const controller = new AbortController();
    const call = uploadAttachment('p_web', file(), null, 'inline', { signal: controller.signal });
    controller.abort();

    await expect(call).rejects.toMatchObject({ name: 'AbortError' });
    expect(FakeXhr.last.abort).toHaveBeenCalledTimes(1);
  });

  it('deletes an attachment', async () => {
    api = mockApi({ 'DELETE /api/v1/attachments/att_1': () => ({ status: 204 }) });

    await expect(deleteAttachment('att_1')).resolves.toBeUndefined();
    expect(api.calls.map(({ method, url }) => `${method} ${url}`)).toEqual(['DELETE /api/v1/attachments/att_1']);
  });

  it('gives the address of the file, of its preview when there is one, and of a download', () => {
    const plain = makeAttachment();
    const previewed = makeAttachment({ preview_url: '/attachments/att_1/preview' });

    expect(attachmentUrl(plain)).toBe('/attachments/att_1');
    expect(attachmentUrl(plain, { preview: true })).toBe('/attachments/att_1');
    expect(attachmentUrl(previewed, { preview: true })).toBe('/attachments/att_1/preview');
    expect(attachmentUrl(previewed, { download: true })).toBe('/attachments/att_1?download=1');
  });
});
