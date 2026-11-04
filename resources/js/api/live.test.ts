import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockApi, type MockApi } from '@/test/api';
import { setSocketId } from './http';
import {
  AUTH_BATCH_MAX,
  connectLive,
  disconnectLive,
  isLiveConnected,
  liveStatus,
  pauseLive,
  socketId,
  subscribeLive,
  subscribeLiveStatus,
  watchItem,
  watchProjects,
  type LiveEvent,
} from './live';

/*
 * Echo stands in as a fake: it records its options and channels, and the test plays the connection (`state`) and the
 * messages of Reverb (`deliver`) through it. pusher-js never loads.
 */

const { FakeEcho } = vi.hoisted(() => {
  type Handler = (payload: unknown) => void;

  class FakeChannel {
    readonly handlers = new Map<string, Handler>();
    readonly onSubscribed: (() => void)[] = [];
    listen(event: string, handler: Handler): this {
      this.handlers.set(event, handler);
      return this;
    }
    subscribed(callback: () => void): this {
      this.onSubscribed.push(callback);
      return this;
    }
  }

  class FakeEcho {
    static instances: FakeEcho[] = [];
    readonly channels = new Map<string, FakeChannel>();
    readonly left: string[] = [];
    disconnected = false;
    socket: string | undefined = undefined;
    private readonly stateHandlers: ((change: { previous: string; current: string }) => void)[] = [];
    readonly connector = {
      pusher: {
        connection: {
          bind: (event: string, handler: (change: { previous: string; current: string }) => void) => {
            if (event === 'state_change') this.stateHandlers.push(handler);
          },
        },
      },
    };

    constructor(readonly options: Record<string, unknown>) {
      FakeEcho.instances.push(this);
    }

    private channel(name: string): FakeChannel {
      const channel = this.channels.get(name) ?? new FakeChannel();
      this.channels.set(name, channel);
      return channel;
    }

    private(name: string): FakeChannel {
      return this.channel(`private-${name}`);
    }

    join(name: string): FakeChannel {
      return this.channel(`presence-${name}`);
    }

    leave(name: string): void {
      this.left.push(name);
      this.channels.delete(`private-${name}`);
      this.channels.delete(`presence-${name}`);
    }

    socketId(): string | undefined {
      return this.socket;
    }

    disconnect(): void {
      this.disconnected = true;
    }

    /** Reverb's connection goes from `previous` to `current`. */
    state(previous: string, current: string): void {
      this.stateHandlers.forEach((handler) => handler({ previous, current }));
    }

    /** A message `live` arrives on `channel` (with its prefix). */
    deliver(channel: string, payload: unknown): void {
      this.channels.get(channel)!.handlers.get('.live')!(payload);
    }

    /** Reverb confirms the subscription of `channel` (`pusher:subscription_succeeded`, also again after a reconnect). */
    succeed(channel: string): void {
      this.channels.get(channel)!.onSubscribed.forEach((callback) => callback());
    }

    /** What `channelAuthorization.customHandler` answers for `channel`. */
    authorize(channel: string, socketId = '123.456'): Promise<{ error: Error | null; data: unknown }> {
      const { customHandler } = this.options.channelAuthorization as {
        customHandler: (params: { socketId: string; channelName: string }, callback: (error: Error | null, data: unknown) => void) => void;
      };
      return new Promise((resolve) => customHandler({ socketId, channelName: channel }, (error, data) => resolve({ error, data })));
    }
  }

  return { FakeEcho };
});

type FakeEcho = InstanceType<typeof FakeEcho>;

vi.mock('laravel-echo', () => ({ default: FakeEcho }));
vi.mock('pusher-js', () => ({ default: class FakePusher {} }));
vi.mock('./http', async (importOriginal) => ({ ...(await importOriginal<typeof import('./http')>()), setSocketId: vi.fn() }));

const CONFIG = { key: 'werkbuch-key', host: 'werkbuch.example.com', port: 6001, scheme: 'https' as const };

const echo = (): FakeEcho => FakeEcho.instances.at(-1)!;

function message(overrides: Partial<LiveEvent> = {}): LiveEvent {
  return { event_id: 'ev_1', type: 'work_item.updated', project_id: 'p_web', page_id: null, item_id: 'wi_web_47', comment_id: null, actor_id: 'u_ida', ...overrides };
}

/** What `/broadcasting/batch` answers when it signs every channel it is asked for. */
function signed(body: unknown) {
  const names = (body as { channel_names: string[] }).channel_names;
  return { body: { channels: Object.fromEntries(names.map((name) => [name, { auth: `werkbuch-key:${name}` }])) } };
}

/** What `/broadcasting/batch` answers when it refuses every channel it is asked for. */
function refusedAll(body: unknown) {
  const names = (body as { channel_names: string[] }).channel_names;
  return { body: { channels: Object.fromEntries(names.map((name) => [name, { refused: true }])) } };
}

let api: MockApi | null = null;

beforeEach(() => {
  FakeEcho.instances = [];
});

afterEach(() => {
  disconnectLive();
  watchProjects([]);
  api?.restore();
  api = null;
  vi.useRealTimers();
  vi.mocked(setSocketId).mockClear();
});

describe('connectLive', () => {
  it('connects with the settings of the page and authorizes over the web route', async () => {
    api = mockApi({ 'POST /broadcasting/batch': signed });
    connectLive(CONFIG, 'u_mara');

    expect(echo().options).toMatchObject({
      broadcaster: 'reverb',
      key: 'werkbuch-key',
      wsHost: 'werkbuch.example.com',
      wsPort: 6001,
      wssPort: 6001,
      forceTLS: true,
      enabledTransports: ['ws', 'wss'],
      channelAuthorization: { endpoint: '/broadcasting/batch', transport: 'ajax' },
    });
    expect(echo().options.Pusher).toBeTypeOf('function');
    // the person's own channel at once
    expect([...echo().channels.keys()]).toEqual(['presence-user.u_mara']);

    const answer = await echo().authorize('private-project.p_web');

    expect(answer).toEqual({ error: null, data: { auth: 'werkbuch-key:private-project.p_web' } });
    expect(api.calls).toEqual([{ method: 'POST', url: '/broadcasting/batch', body: { socket_id: '123.456', channel_names: ['private-project.p_web'] } }]);
  });

  it('speaks plain ws when the page says http', () => {
    connectLive({ ...CONFIG, scheme: 'http', port: 8080 }, 'u_mara');

    expect(echo().options).toMatchObject({ wsPort: 8080, wssPort: 8080, forceTLS: false });
  });

  it('does nothing without live settings: no connection, no banner (A285)', () => {
    vi.useFakeTimers();
    const onStatus = vi.fn();
    const stop = subscribeLiveStatus(onStatus);
    connectLive(null, 'u_mara');
    vi.advanceTimersByTime(10_000);

    expect(FakeEcho.instances).toEqual([]);
    expect(isLiveConnected()).toBe(true);
    expect(onStatus).not.toHaveBeenCalled();
    stop();
  });

  it('connects once, however often the shell asks', () => {
    connectLive(CONFIG, 'u_mara');
    connectLive(CONFIG, 'u_mara');

    expect(FakeEcho.instances).toHaveLength(1);
  });

  it('closes the connection on disconnectLive and opens a new one afterwards', () => {
    const stop = connectLive(CONFIG, 'u_mara');
    const first = echo();
    stop();

    expect(first.disconnected).toBe(true);
    connectLive(CONFIG, 'u_mara');
    expect(FakeEcho.instances).toHaveLength(2);
  });
});

describe('the status of the connection', () => {
  it('says disconnected only after three seconds', () => {
    vi.useFakeTimers();
    const onStatus = vi.fn();
    const stop = subscribeLiveStatus(onStatus);
    connectLive(CONFIG, 'u_mara');

    // loading the page counts as connecting
    expect(liveStatus()).toBe('connecting');
    expect(isLiveConnected()).toBe(true);
    echo().state('connecting', 'unavailable');
    expect(liveStatus()).toBe('unavailable');
    vi.advanceTimersByTime(2_999);
    expect(isLiveConnected()).toBe(true);

    vi.advanceTimersByTime(1);
    expect(isLiveConnected()).toBe(false);
    expect(onStatus).toHaveBeenCalled();

    echo().socket = '1.2';
    echo().state('unavailable', 'connected');
    expect(liveStatus()).toBe('connected');
    expect(isLiveConnected()).toBe(true);
    stop();
  });

  it('shows no banner when the connection comes within three seconds', () => {
    vi.useFakeTimers();
    connectLive(CONFIG, 'u_mara');
    vi.advanceTimersByTime(2_000);
    echo().state('connecting', 'connected');
    vi.advanceTimersByTime(5_000);

    expect(isLiveConnected()).toBe(true);
  });

  it('announces reconnected after an interruption, not on the first connection', () => {
    vi.useFakeTimers();
    const events: LiveEvent[] = [];
    const stop = subscribeLive((event) => events.push(event));
    connectLive(CONFIG, 'u_mara');
    echo().state('connecting', 'connected');

    expect(events).toEqual([]);
    echo().state('connected', 'connecting');
    // a short gap: no banner, but the screens load what they missed
    expect(isLiveConnected()).toBe(true);
    echo().state('connecting', 'connected');

    expect(events).toEqual([{ event_id: null, type: 'live.reconnected', project_id: null, page_id: null, item_id: null, comment_id: null, actor_id: null }]);
    echo().state('connected', 'connected');
    expect(events).toHaveLength(1);
    stop();
  });

  it('sets and clears the socket id', () => {
    connectLive(CONFIG, 'u_mara');
    echo().socket = '123.456';
    echo().state('connecting', 'connected');

    expect(setSocketId).toHaveBeenLastCalledWith('123.456');
    expect(socketId()).toBe('123.456');

    echo().state('connected', 'unavailable');
    expect(setSocketId).toHaveBeenLastCalledWith(null);
    expect(socketId()).toBeNull();

    echo().state('unavailable', 'connected');
    disconnectLive();
    expect(setSocketId).toHaveBeenLastCalledWith(null);
  });

  it('counts as disconnected at once when the authorization is no refusal, e.g. a deactivated account sent to the sign-in', async () => {
    // the web route redirects a deactivated account: fetch follows to the HTML of the sign-in
    api = mockApi({ 'POST /broadcasting/batch': () => ({ status: 200, body: '<!DOCTYPE html><title>Sign in</title>' }) });
    connectLive(CONFIG, 'u_mara');
    echo().state('connecting', 'connected');

    const answer = await echo().authorize('presence-user.u_mara');

    expect(answer.error).toBeInstanceOf(Error);
    expect(isLiveConnected()).toBe(false);
    // a connection that comes back authorizes every channel again
    echo().state('connected', 'connecting');
    echo().state('connecting', 'connected');
    expect(isLiveConnected()).toBe(true);
  });

  it('counts as disconnected when the authorization fails on the server', async () => {
    api = mockApi({ 'POST /broadcasting/batch': () => ({ status: 500, body: { reason: 'server_error' } }) });
    connectLive(CONFIG, 'u_mara');
    echo().state('connecting', 'connected');

    const answer = await echo().authorize('private-project.p_web');

    expect(answer).toEqual({ error: expect.any(Error), data: null });
    expect(isLiveConnected()).toBe(false);
  });

  it('passes a refusal of a channel on as live.refused, so the projects load again (A281)', async () => {
    api = mockApi({ 'POST /broadcasting/batch': refusedAll });
    const events: LiveEvent[] = [];
    const stop = subscribeLive((event) => events.push(event));
    connectLive(CONFIG, 'u_mara');

    const answer = await echo().authorize('private-project.p_ops');

    expect(answer.error).toBeInstanceOf(Error);
    expect(events).toEqual([{ event_id: null, type: 'live.refused', project_id: 'p_ops', page_id: null, item_id: null, comment_id: null, actor_id: null }]);
    await echo().authorize('private-work-item.wi_ops_12');
    await echo().authorize('presence-user.u_mara');
    expect(events.slice(1).map((event) => [event.project_id, event.item_id])).toEqual([
      [null, 'wi_ops_12'],
      [null, null],
    ]);
    // a refusal is no lost connection
    expect(isLiveConnected()).toBe(true);
    stop();
  });

  it('asks for the channels of one task in one request, per socket and at most AUTH_BATCH_MAX at a time (A305)', async () => {
    api = mockApi({ 'POST /broadcasting/batch': signed });
    connectLive(CONFIG, 'u_mara');
    const projects = Array.from({ length: AUTH_BATCH_MAX + 1 }, (_, n) => `private-project.p_${n}`);

    // what Pusher does when the connection opens: one channel after the other, in the same task
    const answers = await Promise.all([
      echo().authorize('presence-user.u_mara'),
      ...projects.map((channel) => echo().authorize(channel)),
      echo().authorize('private-project.p_web', '789.012'),
      echo().authorize('private-project.p_web', '789.012'),
    ]);

    expect(answers.every((answer) => answer.error === null)).toBe(true);
    expect(answers.at(-1)).toEqual({ error: null, data: { auth: 'werkbuch-key:private-project.p_web' } });
    expect(api.calls.map((call) => call.body)).toEqual([
      { socket_id: '123.456', channel_names: ['presence-user.u_mara', ...projects.slice(0, AUTH_BATCH_MAX - 1)] },
      { socket_id: '123.456', channel_names: projects.slice(AUTH_BATCH_MAX - 1) },
      // the same channel twice in one batch is asked for once, and both get the answer
      { socket_id: '789.012', channel_names: ['private-project.p_web'] },
    ]);

    // a later task asks again
    await echo().authorize('private-work-item.wi_web_47');
    expect(api.calls).toHaveLength(4);
  });

  it('counts a channel the answer leaves out as no signature', async () => {
    api = mockApi({ 'POST /broadcasting/batch': () => ({ body: { channels: [] } }) });
    connectLive(CONFIG, 'u_mara');
    echo().state('connecting', 'connected');

    const answer = await echo().authorize('private-project.p_web');

    expect(answer).toEqual({ error: expect.any(Error), data: null });
    expect(isLiveConnected()).toBe(false);
  });
});

describe('a channel whose authorization fails for a while (T14-M3)', () => {
  it('asks again after 5, 15 and 60 seconds, and the banner goes once it works', async () => {
    vi.useFakeTimers();
    let answer: { status: number; body: unknown } = { status: 502, body: { reason: 'http_error' } };
    api = mockApi({ 'POST /broadcasting/batch': () => answer });
    connectLive(CONFIG, 'u_mara');
    echo().state('connecting', 'connected');
    watchProjects(['p_web']);

    await echo().authorize('private-project.p_web');
    expect(isLiveConnected()).toBe(false);
    for (const [wait, left] of [[5_000, 1], [15_000, 2], [60_000, 3]] as const) {
      vi.advanceTimersByTime(wait - 1);
      expect(echo().left).toHaveLength(left - 1);
      vi.advanceTimersByTime(1);
      // left and joined again: Echo authorizes the new subscription
      expect(echo().left).toEqual(Array.from({ length: left }, () => 'project.p_web'));
      expect(echo().channels.has('private-project.p_web')).toBe(true);
      if (left < 3) await echo().authorize('private-project.p_web');
    }
    // three tries, then it waits for the next connection
    answer = { status: 200, body: { channels: { 'private-project.p_web': { auth: 'werkbuch-key:signature' } } } };
    await echo().authorize('private-project.p_web');
    expect(isLiveConnected()).toBe(true);
    vi.advanceTimersByTime(120_000);
    expect(echo().left).toHaveLength(3);
  });

  it('asks the own channel again after a lost answer, and leaves nothing it no longer watches', async () => {
    vi.useFakeTimers();
    api = mockApi({ 'POST /broadcasting/batch': () => ({ status: 503, body: { reason: 'service_unavailable' } }) });
    connectLive(CONFIG, 'u_mara');
    echo().state('connecting', 'connected');
    watchProjects(['p_web']);

    await echo().authorize('presence-user.u_mara');
    await echo().authorize('private-project.p_web');
    watchProjects([]);
    vi.advanceTimersByTime(5_000);

    // the own channel again; the project is gone from the list: it stays left
    expect(echo().left).toEqual(['project.p_web', 'user.u_mara']);
    expect([...echo().channels.keys()]).toEqual(['presence-user.u_mara']);
  });

  it('asks nothing again after a refusal or a redirect to the sign-in', async () => {
    vi.useFakeTimers();
    let answer: { status: number; body: unknown } = { status: 403, body: { reason: 'forbidden' } };
    api = mockApi({ 'POST /broadcasting/batch': () => answer });
    connectLive(CONFIG, 'u_mara');
    echo().state('connecting', 'connected');

    await echo().authorize('presence-user.u_mara');
    answer = { status: 200, body: '<!DOCTYPE html><title>Sign in</title>' };
    await echo().authorize('presence-user.u_mara');
    vi.advanceTimersByTime(120_000);

    expect(echo().left).toEqual([]);
    expect(isLiveConnected()).toBe(false);
  });
});

describe('channels', () => {
  it('delivers the messages of the person and of the projects to every subscriber until it unsubscribes', () => {
    const events: LiveEvent[] = [];
    const stop = subscribeLive((event) => events.push(event));
    connectLive(CONFIG, 'u_mara');
    watchProjects(['p_web']);

    echo().deliver('presence-user.u_mara', message({ event_id: null, type: 'notifications.changed', project_id: null, item_id: null, actor_id: null }));
    echo().deliver('private-project.p_web', message());
    stop();
    echo().deliver('private-project.p_web', message({ event_id: 'ev_2' }));

    expect(events.map((event) => event.type)).toEqual(['notifications.changed', 'work_item.updated']);
  });

  it('announces every channel once Reverb holds it, also again after a reconnect: what loaded before may miss a message', () => {
    const events: LiveEvent[] = [];
    const stop = subscribeLive((event) => events.push(event));
    watchProjects(['p_web']);
    connectLive(CONFIG, 'u_mara');
    const release = watchItem('wi_web_47');

    // asked for, not held yet: nothing
    expect(events).toEqual([]);
    echo().succeed('presence-user.u_mara');
    echo().succeed('private-project.p_web');
    echo().succeed('private-work-item.wi_web_47');
    echo().succeed('private-project.p_web');
    release();
    stop();

    const held = (project_id: string | null, item_id: string | null): LiveEvent => ({ event_id: null, type: 'live.subscribed', project_id, page_id: null, item_id, comment_id: null, actor_id: null });
    expect(events).toEqual([held(null, null), held('p_web', null), held(null, 'wi_web_47'), held('p_web', null)]);
  });

  it('joins and leaves project channels as the list changes', () => {
    watchProjects(['p_web']);
    connectLive(CONFIG, 'u_mara');

    // the list that came before the connection is joined with it
    expect([...echo().channels.keys()]).toEqual(['presence-user.u_mara', 'private-project.p_web']);

    watchProjects(['p_web', 'p_app']);
    watchProjects(['p_app', 'p_ops']);

    expect([...echo().channels.keys()]).toEqual(['presence-user.u_mara', 'private-project.p_app', 'private-project.p_ops']);
    expect(echo().left).toEqual(['project.p_web']);
  });

  it('counts watchers of an item channel', () => {
    connectLive(CONFIG, 'u_mara');
    const page = watchItem('wi_web_47');
    const peek = watchItem('wi_web_47');

    expect(echo().channels.has('private-work-item.wi_web_47')).toBe(true);
    page();
    expect(echo().channels.has('private-work-item.wi_web_47')).toBe(true);
    // a second call of the same release counts once
    page();
    expect(echo().left).toEqual([]);
    peek();
    expect(echo().left).toEqual(['work-item.wi_web_47']);
  });

  it('joins item channels watched before the connection, and nothing while there is none', () => {
    const stop = watchItem('wi_web_47');
    stop();
    const again = watchItem('wi_web_30');
    connectLive(CONFIG, 'u_mara');

    expect([...echo().channels.keys()]).toEqual(['presence-user.u_mara', 'private-work-item.wi_web_30']);
    again();
  });
});

describe('deleted and refused channels', () => {
  it('leaves the channel of a deleted project and never joins it again, not even on the next connection', () => {
    connectLive(CONFIG, 'u_mara');
    watchProjects(['p_web', 'p_app']);

    echo().deliver('private-project.p_web', message({ type: 'project.deleted', item_id: null }));
    expect(echo().left).toEqual(['project.p_web']);

    // a list from before the delete still names it: no authorization that would be refused
    watchProjects(['p_app']);
    watchProjects(['p_web', 'p_app']);
    expect([...echo().channels.keys()]).toEqual(['presence-user.u_mara', 'private-project.p_app']);
    echo().state('connected', 'connecting');
    pauseLive()();
    expect([...echo().channels.keys()]).toEqual(['presence-user.u_mara', 'private-project.p_app']);
  });

  it('leaves the channel of a deleted item and joins it no more while a detail still holds it', () => {
    connectLive(CONFIG, 'u_mara');
    const page = watchItem('wi_web_47');

    echo().deliver('private-work-item.wi_web_47', message({ type: 'work_item.deleted' }));
    expect(echo().left).toEqual(['work-item.wi_web_47']);
    const peek = watchItem('wi_web_47');
    pauseLive()();

    expect([...echo().channels.keys()]).toEqual(['presence-user.u_mara']);
    page();
    peek();
  });

  it('leaves a refused channel, so a new connection does not ask for it again', async () => {
    // refused as a whole (a body of another form) as well as one by one
    api = mockApi({ 'POST /broadcasting/batch': () => ({ status: 403, body: { reason: 'forbidden' } }) });
    connectLive(CONFIG, 'u_mara');
    watchProjects(['p_ops']);
    const item = watchItem('wi_ops_12');

    await echo().authorize('private-project.p_ops');
    await echo().authorize('private-work-item.wi_ops_12');
    expect(echo().left).toEqual(['project.p_ops', 'work-item.wi_ops_12']);
    pauseLive()();
    expect([...echo().channels.keys()]).toEqual(['presence-user.u_mara']);

    // the project list that comes again with it joins it anew: access may be back
    watchProjects([]);
    watchProjects(['p_ops']);
    expect([...echo().channels.keys()]).toEqual(['presence-user.u_mara', 'private-project.p_ops']);
    item();
  });
});

describe('disconnectLive and pauseLive', () => {
  it('forgets the projects of the person on disconnectLive: the next person never asks for them', () => {
    connectLive(CONFIG, 'u_mara');
    watchProjects(['p_web']);
    disconnectLive();
    connectLive(CONFIG, 'u_ida');

    expect([...echo().channels.keys()]).toEqual(['presence-user.u_ida']);
  });

  it('closes the connection while paused and opens it again with the same settings and channels', () => {
    connectLive(CONFIG, 'u_mara');
    watchProjects(['p_web']);
    const first = echo();
    const resume = pauseLive();

    expect(first.disconnected).toBe(true);
    expect(socketId()).toBeNull();
    // nothing joins while paused
    watchProjects(['p_web', 'p_app']);
    expect(FakeEcho.instances).toHaveLength(1);

    resume();
    expect(FakeEcho.instances).toHaveLength(2);
    expect(echo().options).toMatchObject({ key: 'werkbuch-key' });
    expect([...echo().channels.keys()]).toEqual(['presence-user.u_mara', 'private-project.p_web', 'private-project.p_app']);
    // a second resume does nothing
    resume();
    expect(FakeEcho.instances).toHaveLength(2);
  });

  it('pauses nothing without a connection', () => {
    pauseLive()();

    expect(FakeEcho.instances).toEqual([]);
  });
});

describe('the edges of the live connection', () => {
  it('forgets the oldest of more than 200 deleted projects', () => {
    connectLive(CONFIG, 'u_mara');
    watchProjects(['p_0']);
    for (let n = 0; n <= 200; n += 1) {
      watchProjects([`p_${n}`]);
      echo().deliver(`private-project.p_${n}`, message({ type: 'project.deleted', project_id: `p_${n}`, item_id: null }));
    }

    // p_0 fell out: a list that names it joins it again, p_1 stays left
    watchProjects(['p_0', 'p_1']);
    expect([...echo().channels.keys()]).toEqual(['presence-user.u_mara', 'private-project.p_0']);
  });

  it('passes over the states of a connection that was closed, and connects nothing while paused', () => {
    connectLive(CONFIG, 'u_mara');
    const first = echo();
    const resume = pauseLive();
    first.state('connecting', 'connected');
    expect(liveStatus()).toBe('connecting');

    // the shell asking again while paused opens nothing; the resume does
    connectLive(CONFIG, 'u_mara');
    expect(FakeEcho.instances).toHaveLength(1);
    resume();
    expect(FakeEcho.instances).toHaveLength(2);
  });

  it('asks an item channel again after a failure, once for two failures in a row', async () => {
    vi.useFakeTimers();
    api = mockApi({ 'POST /broadcasting/batch': () => ({ status: 500, body: { reason: 'server_error' } }) });
    connectLive(CONFIG, 'u_mara');
    echo().state('connecting', 'connected');
    const release = watchItem('wi_web_47');

    await echo().authorize('private-work-item.wi_web_47');
    await echo().authorize('private-work-item.wi_web_47');
    vi.advanceTimersByTime(5_000);

    expect(echo().left).toEqual(['work-item.wi_web_47']);
    expect(echo().channels.has('private-work-item.wi_web_47')).toBe(true);
    release();
  });
});

