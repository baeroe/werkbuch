/*
 * Live updates (spec 7.2, phase plan 8 "Live"): one connection to Reverb per tab, through Laravel Echo and pusher-js.
 *
 * - `connectLive(config, me)` connects once with the settings of the page (`features.live`, `null` without Reverb:
 *   nothing connects, the tab counts as connected and shows no banner, A285) and joins the person's own channel
 *   `user.<id>` (presence). `watchProjects(ids)` keeps the channels `project.<id>` in step with the projects the person
 *   sees, `watchItem(id)` holds `work-item.<id>` while a detail shows the item (counted per id).
 * - Every channel is authorized with the session of the page (`webPost`), all channels asked for in one task in one
 *   `POST /broadcasting/batch` (A305). A refusal (e.g. after the person lost access, A281) arrives as `live.refused`
 *   naming the project or item of the channel: the channel is left at once, the projects load again (a project the
 *   person sees again is joined anew with the list).
 *   Any other failure (a deactivated account is sent to the sign-in) means live updates stop: the tab counts as
 *   disconnected until the connection comes back and authorizes again. A failure that may pass (5xx, no answer) asks
 *   for the channel again after 5, 15 and 60 seconds (`AUTH_RETRY_MS`); the banner goes once no channel fails.
 * - `project.deleted` and `work_item.deleted` leave the channel of what was deleted, and it is never asked for again
 *   (a list from before the delete, a detail still holding the item, the next connection): it would only be refused.
 * - `disconnectLive` forgets the projects (the next person joins their own list), `pauseLive` closes the connection
 *   while signing out and answers how to open it again.
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
let me: string | null = null;

/** The pauses before a channel whose authorization failed for a while (5xx, no answer) is asked for again (T14-M3). */
export const AUTH_RETRY_MS: readonly number[] = [5_000, 15_000, 60_000];

/** Channels whose authorization failed for a while: how often they were asked again, and the timer of the next try. */
const retries = new Map<string, { tries: number; timer: ReturnType<typeof setTimeout> | null }>();

const projects = new Set<string>();
const items = new Map<string, number>();
/** The settings of the open connection, for `pauseLive` to open it again. */
let current: { config: LiveConfig; me: string } | null = null;
/** Whether `pauseLive` holds the connection closed. */
let paused = false;

/** How many deleted projects and items the tab remembers to leave their channels alone (the oldest go first). */
const GONE_MAX = 200;

/**
 * Projects and items a message said were deleted (`project.deleted`, `work_item.deleted`): their channels are left at
 * once and never asked for again, not by a list from before the delete, not by a detail that still holds the item,
 * not on the next connection. Asking would only be refused (403).
 */
const gone = new Set<string>();

function markGone(id: string): void {
  gone.delete(id);
  gone.add(id);
  if (gone.size > GONE_MAX) gone.delete(gone.values().next().value!);
}

function browserEvent(type: string): LiveEvent {
  return { event_id: null, type, project_id: null, item_id: null, comment_id: null, actor_id: null };
}

/**
 * `live.refused` for a channel, naming the project or the item it is about. The channel is left: a new connection would
 * only be refused again. A project comes back with the project list (`watchProjects`) once the person sees it again.
 */
function refused(channel: string): LiveEvent {
  const project = /^private-project\.(.+)$/.exec(channel)?.[1] ?? null;
  const item = /^private-work-item\.(.+)$/.exec(channel)?.[1] ?? null;
  if (project !== null) leaveProject(project);
  if (item !== null) {
    items.delete(item);
    echo?.leave(`work-item.${item}`);
  }
  return { ...browserEvent('live.refused'), project_id: project, item_id: item };
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
    // every channel is authorized anew with the connection
    stopRetries();
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

/** A failure that may pass: a server error or no answer at all (a refusal or the sign-in page does not). */
function isPassing(error: unknown): boolean {
  return !(error instanceof ApiError) || error.status >= 500;
}

function stopRetries(): void {
  retries.forEach((retry) => {
    if (retry.timer !== null) clearTimeout(retry.timer);
  });
  retries.clear();
}

/** Asks for the channel again after the next pause of AUTH_RETRY_MS; after the last one it waits for a new connection. */
function retryLater(channel: string): void {
  const retry = retries.get(channel) ?? { tries: 0, timer: null };
  retries.set(channel, retry);
  const wait = AUTH_RETRY_MS[retry.tries];
  if (wait === undefined || retry.timer !== null) return;
  retry.tries += 1;
  retry.timer = setTimeout(() => {
    retry.timer = null;
    resubscribe(channel);
  }, wait);
}

/** Leaves the channel and joins it again (Echo then authorizes it anew), if the tab still holds it. */
function resubscribe(channel: string): void {
  // a timer of a closed connection was stopped with it (`close`)
  const live = echo!;
  const project = /^private-project\.(.+)$/.exec(channel)?.[1];
  const item = /^private-work-item\.(.+)$/.exec(channel)?.[1];
  if (project !== undefined && projects.has(project)) {
    live.leave(`project.${project}`);
    joinProject(project);
  } else if (item !== undefined && items.has(item)) {
    live.leave(`work-item.${item}`);
    joinItem(item);
  } else if (me !== null && channel === `presence-user.${me}`) {
    live.leave(`user.${me}`);
    live.join(`user.${me}`).listen(MESSAGE, deliver);
  } else {
    retries.delete(channel);
  }
}

function isAuthAnswer(value: unknown): value is { auth: string } {
  return typeof value === 'object' && value !== null && typeof (value as { auth?: unknown }).auth === 'string';
}

/** The most channels one `/broadcasting/batch` authorizes (`ChannelBatchController::MAX`); more go in several. */
export const AUTH_BATCH_MAX = 100;

type AuthCallback = (error: Error | null, data: { auth: string; channel_data?: string } | null) => void;

/** The channels Pusher asked for in the running task, sent together once it ends (`flushAuthorizations`). */
let queued: { socketId: string; channelName: string; callback: AuthCallback }[] = [];

/**
 * Authorizes a channel over the web route with the session of the page (A305): Pusher asks for each channel on its
 * own, one after the other in the same task (the connection opens, a list of projects arrives), and every channel
 * that asks before the task ends goes in one `POST /broadcasting/batch` (per socket, `AUTH_BATCH_MAX` at most). One
 * request per channel held up every other request of the page for seconds when the person sees many projects.
 */
function authorize({ socketId, channelName }: { socketId: string; channelName: string }, callback: AuthCallback): void {
  queued.push({ socketId, channelName, callback });
  if (queued.length === 1) queueMicrotask(flushAuthorizations);
}

function flushAuthorizations(): void {
  const waiting = queued;
  queued = [];
  const bySocket = new Map<string, typeof waiting>();
  waiting.forEach((entry) => bySocket.set(entry.socketId, [...(bySocket.get(entry.socketId) ?? []), entry]));
  bySocket.forEach((entries, socketId) => {
    for (let start = 0; start < entries.length; start += AUTH_BATCH_MAX) sendBatch(socketId, entries.slice(start, start + AUTH_BATCH_MAX));
  });
}

function channelAnswers(answer: unknown): Record<string, unknown> {
  const channels = typeof answer === 'object' && answer !== null ? (answer as { channels?: unknown }).channels : undefined;
  return typeof channels === 'object' && channels !== null ? (channels as Record<string, unknown>) : {};
}

function isRefusal(value: unknown): value is { refused: true } {
  return typeof value === 'object' && value !== null && (value as { refused?: unknown }).refused === true;
}

/**
 * A refusal of a channel (A281: e.g. after the person lost access) arrives as `live.refused`; anything else that is no
 * signature (the HTML of the sign-in after a redirect, a server error) means live updates stopped.
 */
function sendBatch(socketId: string, entries: { channelName: string; callback: AuthCallback }[]): void {
  const names = [...new Set(entries.map((entry) => entry.channelName))];
  webPost<unknown>('/broadcasting/batch', { socket_id: socketId, channel_names: names }).then(
    (answer) => {
      const answers = channelAnswers(answer);
      entries.forEach(({ channelName, callback }) => {
        const own = answers[channelName];
        if (isAuthAnswer(own)) {
          // a channel that failed for a while works again: once none is failing, the banner goes
          if (retries.delete(channelName) && retries.size === 0 && status === 'connected') setDown(false);
          callback(null, own as { auth: string; channel_data?: string });
        } else if (isRefusal(own)) {
          emit(refused(channelName));
          callback(new Error('live: the channel was refused'), null);
        } else {
          setDown(true);
          callback(new Error('live: the authorization answered no signature'), null);
        }
      });
    },
    (error: unknown) => {
      const failure = error instanceof Error ? error : new Error(String(error));
      entries.forEach(({ channelName, callback }) => {
        // a 403 of the whole request (a body of another form) refuses its channels
        if (error instanceof ApiError && error.status === 403) {
          emit(refused(channelName));
        } else {
          setDown(true);
          if (isPassing(error)) retryLater(channelName);
        }
        callback(failure, null);
      });
    },
  );
}

function deliver(payload: unknown): void {
  const event = payload as LiveEvent;
  if (event.type === 'project.deleted' && event.project_id !== null) {
    markGone(event.project_id);
    leaveProject(event.project_id);
  }
  if (event.type === 'work_item.deleted' && event.item_id !== null) {
    markGone(event.item_id);
    echo?.leave(`work-item.${event.item_id}`);
  }
  emit(event);
}

function leaveProject(id: string): void {
  projects.delete(id);
  echo?.leave(`project.${id}`);
}

function joinProject(id: string): void {
  if (!gone.has(id)) echo?.private(`project.${id}`).listen(MESSAGE, deliver);
}

function joinItem(id: string): void {
  if (!gone.has(id)) echo?.private(`work-item.${id}`).listen(MESSAGE, deliver);
}

/**
 * Connects the tab to Reverb with the settings of the page, once (a second call with a connection open does nothing).
 * Answers the function that closes it again (the cleanup of the shell's effect).
 */
export function connectLive(config: LiveConfig | null, me: string): () => void {
  if (config === null || echo !== null) return disconnectLive;
  current = { config, me };
  if (paused) return disconnectLive;
  open(config, me);
  return disconnectLive;
}

function open(config: LiveConfig, person: string): void {
  me = person;
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
    channelAuthorization: { endpoint: '/broadcasting/batch', transport: 'ajax', customHandler: authorize },
  });
  echo.connector.pusher.connection.bind('state_change', ({ current }: { current: string }) => onState(current));
  echo.join(`user.${person}`).listen(MESSAGE, deliver);
  projects.forEach(joinProject);
  items.forEach((_count, id) => joinItem(id));
  startTimer();
  notifyStatus();
}

function close(): void {
  stopTimer();
  stopRetries();
  if (echo !== null) {
    echo.disconnect();
    echo = null;
    setSocket(null);
  }
  status = 'connecting';
  interrupted = false;
  setDown(false);
}

/**
 * Closes the connection and forgets the projects (the next person, or the next connection of the shell, joins its
 * own list) and what was deleted; the item channels the screens still hold are joined again by the next `connectLive`.
 */
export function disconnectLive(): void {
  close();
  current = null;
  paused = false;
  projects.clear();
  gone.clear();
}

/**
 * Closes the connection for a while, e.g. while signing out: no message arrives that would load something with a
 * session that is ending. Answers the function that opens it again with the same settings and channels (once; a
 * `disconnectLive` meanwhile wins).
 */
export function pauseLive(): () => void {
  if (current === null) return () => {};
  paused = true;
  close();
  let resumed = false;
  return () => {
    if (resumed || !paused) return;
    resumed = true;
    paused = false;
    if (current !== null) open(current.config, current.me);
  };
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
