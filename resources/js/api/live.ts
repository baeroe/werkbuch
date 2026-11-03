/*
 * Live updates (spec 7.2, phase plan 8 "Live"): one connection to Reverb per tab, through Laravel Echo and pusher-js.
 *
 * - `connectLive(config, me)` connects once with the settings of the page (`features.live`, `null` without Reverb:
 *   nothing connects, the tab counts as connected and shows no banner, A285) and joins the person's own channel
 *   `user.<id>` (presence). `watchProjects(ids)` keeps the channels `project.<id>` in step with the projects the person
 *   sees, `watchItem(id)` holds `work-item.<id>` while a detail shows the item (counted per id).
 * - Every channel is authorized over `/broadcasting/auth` with the session of the page (`webPost`). A refusal (403,
 *   e.g. after the person lost access, A281) arrives as `live.refused`: the projects load again and the channel goes
 *   with them. Any other failure (a deactivated account is sent to the sign-in) means live updates stop: the tab
 *   counts as disconnected until the connection comes back and authorizes again.
 * - A message carries IDs and the type only (A279). The tab that made a change never gets it: the HTTP layer names
 *   the socket of the connection in every call (`X-Socket-ID`, `setSocketId`, A282).
 * - Status: `connecting` (also while the page loads), `connected`, `unavailable`. The banner (`isLiveConnected()`
 *   false) comes only after three seconds without a connection. After an interruption the subscribers get
 *   `live.reconnected` and load again what they show.
 */

import Echo from 'laravel-echo';
import Pusher from 'pusher-js';
import { ApiError } from './client';
import { setSocketId, webPost } from './http';

/** What the page says about Reverb (`features.live` of the shared props). */
export interface LiveConfig {
  key: string;
  host: string;
  port: number;
  scheme: 'http' | 'https';
}

/**
 * A live message: what happened, never what it says (A279). `notifications.changed` and the messages of the browser
 * itself (`live.reconnected`, `live.refused`) have no event behind them (`event_id` null).
 */
export interface LiveEvent {
  event_id: string | null;
  type: string;
  project_id: string | null;
  item_id: string | null;
  comment_id: string | null;
  actor_id: string | null;
  /** Only on `notifications.changed`. */
  unread_changed?: boolean;
}

export type LiveStatus = 'connecting' | 'connected' | 'unavailable';

/** How long the tab may go without a connection before the banner says so. */
export const DISCONNECTED_AFTER_MS = 3_000;

/** The name of the message on every channel (`LiveMessage::broadcastAs`); Echo needs the dot for a name of its own. */
const MESSAGE = '.live';

type Listener = (event: LiveEvent) => void;

const listeners = new Set<Listener>();
const statusListeners = new Set<() => void>();

let echo: Echo<'reverb'> | null = null;
let status: LiveStatus = 'connecting';
/** Whether the banner shows: three seconds without a connection, or an authorization that failed. */
let down = false;
/** Whether the connection was up once and went away: its return is announced. */
let interrupted = false;
let downTimer: ReturnType<typeof setTimeout> | null = null;
let currentSocket: string | null = null;

const projects = new Set<string>();
const items = new Map<string, number>();

function browserEvent(type: string): LiveEvent {
  return { event_id: null, type, project_id: null, item_id: null, comment_id: null, actor_id: null };
}

function emit(event: LiveEvent): void {
  [...listeners].forEach((listener) => listener(event));
}

function notifyStatus(): void {
  [...statusListeners].forEach((listener) => listener());
}

function setDown(value: boolean): void {
  if (down === value) return;
  down = value;
  notifyStatus();
}

function setSocket(id: string | null): void {
  currentSocket = id;
  setSocketId(id);
}

function stopTimer(): void {
  if (downTimer !== null) clearTimeout(downTimer);
  downTimer = null;
}

/** Starts the three seconds after which a missing connection shows the banner (once per gap). */
function startTimer(): void {
  if (downTimer !== null || down) return;
  downTimer = setTimeout(() => {
    downTimer = null;
    setDown(true);
  }, DISCONNECTED_AFTER_MS);
}

function onState(current: string): void {
  if (echo === null) return;
  if (current === 'connected') {
    stopTimer();
    setSocket(echo.socketId() ?? null);
    status = 'connected';
    setDown(false);
    notifyStatus();
    if (interrupted) {
      interrupted = false;
      emit(browserEvent('live.reconnected'));
    }
    return;
  }
  if (status === 'connected') {
    setSocket(null);
    interrupted = true;
  }
  status = current === 'connecting' || current === 'initialized' ? 'connecting' : 'unavailable';
  notifyStatus();
  startTimer();
}

function isAuthAnswer(value: unknown): value is { auth: string } {
  return typeof value === 'object' && value !== null && typeof (value as { auth?: unknown }).auth === 'string';
}

/**
 * Authorizes a channel over the web route with the session of the page. A 403 is a refusal of this channel; anything
 * else (no signature, the HTML of the sign-in after a redirect, a server error) means live updates stopped.
 */
function authorize(
  { socketId, channelName }: { socketId: string; channelName: string },
  callback: (error: Error | null, data: { auth: string; channel_data?: string } | null) => void,
): void {
  webPost<unknown>('/broadcasting/auth', { socket_id: socketId, channel_name: channelName }).then(
    (answer) => {
      if (isAuthAnswer(answer)) {
        callback(null, answer);
        return;
      }
      setDown(true);
      callback(new Error('live: the authorization answered no signature'), null);
    },
    (error: unknown) => {
      const failure = error instanceof Error ? error : new Error(String(error));
      if (error instanceof ApiError && error.status === 403) {
        emit(browserEvent('live.refused'));
      } else {
        setDown(true);
      }
      callback(failure, null);
    },
  );
}

function deliver(payload: unknown): void {
  emit(payload as LiveEvent);
}

function joinProject(id: string): void {
  echo?.private(`project.${id}`).listen(MESSAGE, deliver);
}

function joinItem(id: string): void {
  echo?.private(`work-item.${id}`).listen(MESSAGE, deliver);
}

/**
 * Connects the tab to Reverb with the settings of the page, once (a second call with a connection open does nothing).
 * Answers the function that closes it again (the cleanup of the shell's effect).
 */
export function connectLive(config: LiveConfig | null, me: string): () => void {
  if (config === null || echo !== null) return disconnectLive;

  status = 'connecting';
  echo = new Echo({
    broadcaster: 'reverb',
    Pusher,
    key: config.key,
    wsHost: config.host,
    wsPort: config.port,
    wssPort: config.port,
    forceTLS: config.scheme === 'https',
    enabledTransports: ['ws', 'wss'],
    channelAuthorization: { endpoint: '/broadcasting/auth', transport: 'ajax', customHandler: authorize },
  });
  echo.connector.pusher.connection.bind('state_change', ({ current }: { current: string }) => onState(current));
  echo.join(`user.${me}`).listen(MESSAGE, deliver);
  projects.forEach(joinProject);
  items.forEach((_count, id) => joinItem(id));
  startTimer();
  notifyStatus();

  return disconnectLive;
}

/** Closes the connection; the channels the screens hold are joined again by the next `connectLive`. */
export function disconnectLive(): void {
  stopTimer();
  if (echo !== null) {
    echo.disconnect();
    echo = null;
    setSocket(null);
  }
  status = 'connecting';
  interrupted = false;
  setDown(false);
}

/** Calls `callback` for every live message until the returned function is called. */
export function subscribeLive(callback: Listener): () => void {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

/** False while the banner shows: no connection for three seconds, or the channels could not be authorized. */
export function isLiveConnected(): boolean {
  return !down;
}

/** The state of the connection right now; `connecting` also before `connectLive`. */
export function liveStatus(): LiveStatus {
  return status;
}

/** For `useSyncExternalStore`: called when the status or the banner changes. */
export function subscribeLiveStatus(callback: () => void): () => void {
  statusListeners.add(callback);
  return () => {
    statusListeners.delete(callback);
  };
}

/** The channels `project.<id>` follow `ids`: new ones are joined, missing ones left. */
export function watchProjects(ids: readonly string[]): void {
  const next = new Set(ids);
  for (const id of [...projects]) {
    if (next.has(id)) continue;
    projects.delete(id);
    echo?.leave(`project.${id}`);
  }
  for (const id of next) {
    if (projects.has(id)) continue;
    projects.add(id);
    joinProject(id);
  }
}

/** Holds `work-item.<id>` until the returned function is called; the channel goes when nobody holds it. */
export function watchItem(id: string): () => void {
  const count = items.get(id) ?? 0;
  items.set(id, count + 1);
  if (count === 0) joinItem(id);

  let released = false;
  return () => {
    if (released) return;
    released = true;
    const left = (items.get(id) ?? 1) - 1;
    if (left > 0) {
      items.set(id, left);
      return;
    }
    items.delete(id);
    echo?.leave(`work-item.${id}`);
  };
}

/** The socket of this tab's connection, or null while there is none. */
export function socketId(): string | null {
  return currentSocket;
}
