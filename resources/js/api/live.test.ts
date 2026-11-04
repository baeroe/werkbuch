import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockApi, type MockApi } from '@/test/api';
import { setSocketId } from './http';
import {
  connectLive,
  disconnectLive,
  isLiveConnected,
  liveStatus,
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
    listen(event: string, handler: Handler): this {
      this.handlers.set(event, handler);
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

    /** What `channelAuthorization.customHandler` answers for `channel`. */
    authorize(channel: string): Promise<{ error: Error | null; data: unknown }> {
      const { customHandler } = this.options.channelAuthorization as {
        customHandler: (params: { socketId: string; channelName: string }, callback: (error: Error | null, data: unknown) => void) => void;
      };
      return new Promise((resolve) => customHandler({ socketId: '123.456', channelName: channel }, (error, data) => resolve({ error, data })));
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
  return { event_id: 'ev_1', type: 'work_item.updated', project_id: 'p_web', item_id: 'wi_web_47', comment_id: null, actor_id: 'u_ida', ...overrides };
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
    api = mockApi({ 'POST /broadcasting/auth': () => ({ body: { auth: 'werkbuch-key:signature' } }) });
    connectLive(CONFIG, 'u_mara');

    expect(echo().options).toMatchObject({
      broadcaster: 'reverb',
      key: 'werkbuch-key',
      wsHost: 'werkbuch.example.com',
      wsPort: 6001,
      wssPort: 6001,
      forceTLS: true,
      enabledTransports: ['ws', 'wss'],
      channelAuthorization: { endpoint: '/broadcasting/auth', transport: 'ajax' },
    });
    expect(echo().options.Pusher).toBeTypeOf('function');
    // the person's own channel at once
    expect([...echo().channels.keys()]).toEqual(['presence-user.u_mara']);

    const answer = await echo().authorize('private-project.p_web');

    expect(answer).toEqual({ error: null, data: { auth: 'werkbuch-key:signature' } });
    expect(api.calls).toEqual([{ method: 'POST', url: '/broadcasting/auth', body: { socket_id: '123.456', channel_name: 'private-project.p_web' } }]);
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

    expect(events).toEqual([{ event_id: null, type: 'live.reconnected', project_id: null, item_id: null, comment_id: null, actor_id: null }]);
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
    api = mockApi({ 'POST /broadcasting/auth': () => ({ status: 200, body: '<!DOCTYPE html><title>Sign in</title>' }) });
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
    api = mockApi({ 'POST /broadcasting/auth': () => ({ status: 500, body: { reason: 'server_error' } }) });
    connectLive(CONFIG, 'u_mara');
    echo().state('connecting', 'connected');

    const answer = await echo().authorize('private-project.p_web');

    expect(answer).toEqual({ error: expect.any(Error), data: null });
    expect(isLiveConnected()).toBe(false);
  });

  it('passes a refusal of a channel on as live.refused, so the projects load again (A281)', async () => {
    api = mockApi({ 'POST /broadcasting/auth': () => ({ status: 403, body: { reason: 'forbidden' } }) });
    const events: LiveEvent[] = [];
    const stop = subscribeLive((event) => events.push(event));
    connectLive(CONFIG, 'u_mara');

    const answer = await echo().authorize('private-project.p_ops');

    expect(answer.error).toBeInstanceOf(Error);
    expect(events).toEqual([{ event_id: null, type: 'live.refused', project_id: 'p_ops', item_id: null, comment_id: null, actor_id: null }]);
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
