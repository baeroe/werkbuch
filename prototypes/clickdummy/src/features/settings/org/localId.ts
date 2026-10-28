/*
 * Ids for things a form invents before the server has seen them: a new status needs one to be named in the
 * transitions, a new dropdown option to be picked as the default. The fake API keeps an id it is given; the real one
 * will map them when it saves.
 */

let counter = 0;

export function localId(prefix: string): string {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}
