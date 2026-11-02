import { describe, expect, it } from 'vitest';
import { properties } from '@/test/fixtures';
import type { Condition, Property } from '@/types';
import operatorsJson from './operators.json?raw';
import {
  CORE_FIELD_DEFS,
  dateValueLabel,
  fieldDef,
  fieldLabel,
  isComplete,
  menuOperators,
  newCondition,
  operatorFamily,
  operatorLabelKey,
  operatorsFor,
  propertyFieldDef,
  readRelative,
  relativeValue,
  valuesOf,
  withOperator,
  withValues,
  type FieldDef,
} from './fieldOps';

/** The table the server's `FilterSchemaTest` holds `Field::ops()` against (K33). */
const operators = JSON.parse(operatorsJson) as { core: Record<string, string[]>; property: Record<string, string[]> };

const property = (field_type: Property['field_type'], multiple = false): Property => ({
  id: `pr_${field_type}`,
  key: field_type,
  label: field_type,
  field_type,
  help: '',
  default_value: null,
  settings: multiple ? { multiple: true } : {},
  options: [],
});

const def = (field: string): FieldDef => fieldDef(field, properties)!;

describe('the operators of the fields', () => {
  it('offers the operators of operators.json for every core field, as the server does', () => {
    const offered = Object.fromEntries(CORE_FIELD_DEFS.map((entry) => [entry.field, operatorsFor(entry)]));
    expect(offered).toEqual(operators.core);
    // every field of the server, none more
    expect(Object.keys(offered).sort()).toEqual(Object.keys(operators.core).sort());
  });

  it('offers the operators of operators.json for every type of property, single and multiple', () => {
    const types: Property['field_type'][] = ['dropdown', 'member', 'date', 'boolean', 'number', 'text', 'url', 'rich_text'];
    const offered: Record<string, string[]> = {};
    for (const type of types) {
      offered[type] = operatorsFor(propertyFieldDef(property(type)));
      if (type === 'dropdown' || type === 'member') offered[`${type}_multiple`] = operatorsFor(propertyFieldDef(property(type, true)));
    }
    expect(offered).toEqual(operators.property);
  });

  it('offers the operators in families: one "ist" for one value or several, a list without "enthält" of its own', () => {
    expect(menuOperators(def('state'))).toEqual(['in', 'not_in']);
    expect(menuOperators(def('assignee'))).toEqual(['in', 'not_in', 'is_empty', 'is_not_empty']);
    expect(menuOperators(def('label'))).toEqual(['in', 'not_in', 'is_empty', 'is_not_empty']);
    expect(menuOperators(def('due_date'))).toEqual(['is', 'before', 'after', 'between', 'is_empty', 'is_not_empty', 'overdue']);
    expect(operatorFamily('is', 'id')).toBe('in');
    expect(operatorFamily('contains', 'list')).toBe('in');
    expect(operatorFamily('not_in', 'enum')).toBe('not_in');
    expect(operatorFamily('is_empty', 'id')).toBe('is_empty');
    // a day's "ist" stays itself
    expect(operatorFamily('is', 'date')).toBe('is');
  });

  it('names an operator by the number of its values', () => {
    expect(operatorLabelKey('in')).toBe('items.filter.op.is');
    expect(operatorLabelKey('in', 2)).toBe('items.filter.op.in');
    expect(operatorLabelKey('contains', 2)).toBe('items.filter.op.in');
    expect(operatorLabelKey('not_in', 3)).toBe('items.filter.op.not_in');
    expect(operatorLabelKey('not_in', 1)).toBe('items.filter.op.is_not');
    expect(operatorLabelKey('gt')).toBe('items.filter.op.gt');
  });
});

describe('the fields', () => {
  it('knows the core fields, the properties of the catalog, and not a property that is gone', () => {
    expect(fieldLabel(def('epic'))).toBe('Ist ein Epic');
    expect(fieldLabel(def('subscribed'))).toBe('Beobachtet');
    expect(def('property:customer')).toMatchObject({ kind: 'id', source: 'option', nullable: true });
    expect(fieldLabel(def('property:customer'))).toBe('Kunde');
    expect(fieldDef('property:gone', properties)).toBeNull();
    expect(fieldDef('nonsense', properties)).toBeNull();
  });

  it('files every type of property by its kind; people take "me", yes or no is never empty', () => {
    expect(propertyFieldDef(property('member'))).toMatchObject({ kind: 'id', source: 'member', acceptsMe: true });
    expect(propertyFieldDef(property('member', true))).toMatchObject({ kind: 'list', source: 'member' });
    expect(propertyFieldDef(property('dropdown', true))).toMatchObject({ kind: 'list', source: 'option' });
    expect(propertyFieldDef(property('boolean'))).toMatchObject({ kind: 'flag', nullable: false });
    expect(propertyFieldDef(property('date')).kind).toBe('date');
    expect(propertyFieldDef(property('number')).kind).toBe('number');
    expect(propertyFieldDef(property('url')).kind).toBe('text');
    expect(propertyFieldDef(property('rich_text')).kind).toBe('rich');
    expect(def('assignee').acceptsMe).toBe(true);
    expect(def('created_by').acceptsMe).toBe(true);
    expect(def('parent').acceptsMe).toBe(false);
  });
});

describe('conditions', () => {
  it('starts a condition the way the menu adds it', () => {
    expect(newCondition(def('blocked'))).toEqual({ field: 'blocked', op: 'is', value: true });
    expect(newCondition(def('state'))).toEqual({ field: 'state', op: 'in', value: [] });
    expect(newCondition(def('title'))).toEqual({ field: 'title', op: 'contains', value: '' });
    expect(newCondition(def('due_date'))).toEqual({ field: 'due_date', op: 'is' });
    expect(newCondition(def('property:effort'))).toEqual({ field: 'property:effort', op: 'is' });
  });

  it('is complete once it has the values its operator needs', () => {
    const complete = (condition: Condition) => isComplete(condition);
    expect(complete({ field: 'state', op: 'in', value: [] })).toBe(false);
    expect(complete({ field: 'state', op: 'is', value: 'std_todo' })).toBe(true);
    expect(complete({ field: 'blocked', op: 'is', value: false })).toBe(true);
    expect(complete({ field: 'assignee', op: 'is_empty' })).toBe(true);
    expect(complete({ field: 'due_date', op: 'overdue' })).toBe(true);
    expect(complete({ field: 'due_date', op: 'is' })).toBe(false);
    expect(complete({ field: 'due_date', op: 'is', value: 'today' })).toBe(true);
    expect(complete({ field: 'due_date', op: 'between', value: ['today', null] })).toBe(false);
    expect(complete({ field: 'due_date', op: 'between', value: 'today' })).toBe(false);
    expect(complete({ field: 'due_date', op: 'between', value: ['today', 'this_month'] })).toBe(true);
    expect(complete({ field: 'title', op: 'contains', value: '  ' })).toBe(false);
    expect(complete({ field: 'title', op: 'contains', value: 'Logo' })).toBe(true);
    expect(complete({ field: 'label', op: 'contains', value: [] })).toBe(false);
    expect(complete({ field: 'label', op: 'contains', value: ['lb_ux'] })).toBe(true);
    expect(complete({ field: 'property:effort', op: 'gt', value: '' })).toBe(false);
    expect(complete({ field: 'property:effort', op: 'gt', value: 0 })).toBe(true);
  });

  it('stores one value as is or is_not, several or none as in or not_in', () => {
    const state: Condition = { field: 'state', op: 'in', value: [] };
    expect(withValues(state, ['std_todo'])).toEqual({ field: 'state', op: 'is', value: 'std_todo' });
    expect(withValues(state, ['std_todo', 'std_done'])).toEqual({ field: 'state', op: 'in', value: ['std_todo', 'std_done'] });
    expect(withValues({ field: 'state', op: 'is_not', value: 'std_done' }, [])).toEqual({ field: 'state', op: 'not_in', value: [] });
    expect(valuesOf({ field: 'state', op: 'is', value: 'std_todo' })).toEqual(['std_todo']);
    expect(valuesOf({ field: 'state', op: 'is', value: null })).toEqual([]);
    expect(valuesOf({ field: 'state', op: 'is' })).toEqual([]);
  });

  it('keeps the values that still fit when the operator changes', () => {
    const state = def('state');
    expect(withOperator({ field: 'state', op: 'in', value: ['a', 'b'] }, 'not_in', state)).toEqual({ field: 'state', op: 'not_in', value: ['a', 'b'] });
    expect(withOperator({ field: 'state', op: 'is_not', value: 'a' }, 'in', state)).toEqual({ field: 'state', op: 'is', value: 'a' });
    expect(withOperator({ field: 'assignee', op: 'is_empty' }, 'in', def('assignee'))).toEqual({ field: 'assignee', op: 'in', value: [] });
    expect(withOperator({ field: 'assignee', op: 'is', value: 'me' }, 'is_empty', def('assignee'))).toEqual({ field: 'assignee', op: 'is_empty' });

    const due = def('due_date');
    expect(withOperator({ field: 'due_date', op: 'is', value: 'today' }, 'between', due)).toEqual({ field: 'due_date', op: 'between', value: ['today', 'today'] });
    expect(withOperator({ field: 'due_date', op: 'between', value: ['today', 'this_month'] }, 'before', due)).toEqual({ field: 'due_date', op: 'before', value: 'today' });
    expect(withOperator({ field: 'due_date', op: 'between', value: [null, null] }, 'after', due)).toEqual({ field: 'due_date', op: 'after' });
    expect(withOperator({ field: 'due_date', op: 'overdue' }, 'between', due)).toEqual({ field: 'due_date', op: 'between', value: [null, null] });
    expect(withOperator({ field: 'due_date', op: 'overdue' }, 'is', due)).toEqual({ field: 'due_date', op: 'is' });
    expect(withOperator({ field: 'due_date', op: 'is' }, 'between', due)).toEqual({ field: 'due_date', op: 'between', value: [null, null] });

    expect(withOperator({ field: 'blocked', op: 'is', value: false }, 'is', def('blocked'))).toEqual({ field: 'blocked', op: 'is', value: false });
    expect(withOperator({ field: 'blocked', op: 'is' }, 'is', def('blocked'))).toEqual({ field: 'blocked', op: 'is', value: true });

    const effort = def('property:effort');
    expect(withOperator({ field: 'property:effort', op: 'is', value: 3 }, 'gt', effort)).toEqual({ field: 'property:effort', op: 'gt', value: 3 });
  });
});

describe('dates', () => {
  it('reads and writes a distance from today', () => {
    expect(readRelative({ relative: '+7d' })).toEqual({ amount: 7, unit: 'd' });
    expect(readRelative({ relative: '-2w' })).toEqual({ amount: -2, unit: 'w' });
    expect(readRelative({ relative: '3d' })).toEqual({ amount: 3, unit: 'd' });
    expect(readRelative({ relative: '+7m' })).toBeNull();
    expect(readRelative({ relative: 7 })).toBeNull();
    expect(readRelative('today')).toBeNull();
    expect(readRelative(null)).toBeNull();
    expect(relativeValue(7, 'd')).toEqual({ relative: '+7d' });
    expect(relativeValue(-2, 'w')).toEqual({ relative: '-2w' });
  });

  it('says a date value in words', () => {
    expect(dateValueLabel('today')).toBe('heute');
    expect(dateValueLabel('this_week')).toBe('diese Woche');
    expect(dateValueLabel('this_month')).toBe('dieser Monat');
    expect(dateValueLabel('2026-10-31')).toBe('31.10.2026');
    expect(dateValueLabel({ relative: '+0d' })).toBe('heute');
    expect(dateValueLabel({ relative: '+1d' })).toBe('heute + 1 Tag');
    expect(dateValueLabel({ relative: '+7d' })).toBe('heute + 7 Tage');
    expect(dateValueLabel({ relative: '-1w' })).toBe('heute − 1 Woche');
    expect(dateValueLabel({ relative: '-3d' })).toBe('heute − 3 Tage');
    expect(dateValueLabel({ relative: '+2w' })).toBe('heute + 2 Wochen');
    expect(dateValueLabel(undefined)).toBe('Datum wählen …');
  });
});
