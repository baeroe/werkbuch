/*
 * The event tree's pure rules: the catalog is the server's (`EventType::webhook()`, read from the PHP file), a group
 * ticked completely is stored as `group.*`, single events by their names, and every name reads like a person would say it.
 */

import { describe, expect, it } from 'vitest';
import eventTypePhp from '/app/Events/EventType.php?raw';
import { EVENT_GROUPS, eventLabel, groupLabel } from './catalog';
import { countEvents, eventsOf, selectionOf } from './events';

/** The names of `EventType::webhook()` in the order of its match arm. */
function serverCatalog(): string[] {
  const values = new Map([...eventTypePhp.matchAll(/case (\w+) = '([a-z_.]+)';/g)].map((match) => [match[1], match[2]]));
  const arm = /function webhook\(\): bool[\s\S]*?match \(\$this\) \{([\s\S]*?)=> true/.exec(eventTypePhp)![1];
  return [...arm.matchAll(/self::(\w+)/g)].map((match) => values.get(match[1])!);
}

describe('the catalog of webhook events', () => {
  it('names exactly the events the server sends, group by group, in its order', () => {
    const catalog = serverCatalog();
    expect(catalog.length).toBeGreaterThan(20);
    expect(EVENT_GROUPS.flatMap((group) => group.events.map((event) => `${group.group}.${event}`))).toEqual(catalog);
  });

  it('reads every event, group and wildcard by its name', () => {
    expect(eventLabel('work_item.state_changed')).toBe('Status geändert');
    expect(eventLabel('project.restored')).toBe('Projekt wiederhergestellt');
    expect(eventLabel('bot.*')).toBe('Alle Bots');
    expect(eventLabel('ping')).toBe('Test-Ping');
    expect(groupLabel('page')).toBe('Wiki-Seiten');
    // what the catalog does not know reads as it is stored
    expect(eventLabel('robot.*')).toBe('robot.*');
    expect(eventLabel('bot.waved')).toBe('bot.waved');
    // every event has a text of its own, never the stored name
    for (const group of EVENT_GROUPS) for (const event of group.events) expect(eventLabel(`${group.group}.${event}`)).not.toContain('.');
  });
});

describe('the selection of events', () => {
  it('stores a whole group as its wildcard and single events by name', () => {
    expect(eventsOf(selectionOf(['work_item.*', 'bot.assigned']))).toEqual(['work_item.*', 'bot.assigned']);
    // all events of a group, ticked one by one, are the wildcard
    expect(eventsOf(selectionOf(['bot.mentioned', 'bot.assigned']))).toEqual(['bot.*']);
    expect(selectionOf(['comment.*']).comment).toEqual(['created', 'updated', 'deleted']);
    expect(eventsOf({ comment: ['deleted', 'created'] })).toEqual(['comment.created', 'comment.deleted']);
    expect(eventsOf({})).toEqual([]);
    // a name the catalog does not know ticks nothing
    expect(selectionOf(['robot.*', 'bot.waved'])).toEqual({});
  });

  it('counts what a stored list stands for', () => {
    expect(countEvents(['work_item.*', 'bot.assigned'])).toBe(10);
    expect(countEvents(['project.*'])).toBe(7);
    expect(countEvents([])).toBe(0);
  });
});
