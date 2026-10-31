/*
 * Ids for things a form invents before the server has seen them: a new status needs one to be named in the
 * transitions, a new dropdown option to be picked as the default. The server keeps the ids of the rows it is given and
 * maps them to its own when it saves (P3).
 */

let counter = 0;

export function localId(prefix: string): string {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}
