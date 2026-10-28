/*
 * The transition matrix of a workflow (spec 4.5): one row per status the item comes from, one column per status it
 * can move to, a cell for every allowed pair. It is a grid for the keyboard (ARIA grid pattern): the whole matrix is
 * one tab stop, the arrows move between the cells (Home and End along a row, with Ctrl to the corners), Space and
 * Enter toggle the cell under the focus. A status never leads to itself, so the diagonal is there to walk over but
 * cannot be changed. Every cell is a checkbox named "Von <Status> nach <Status>".
 */

import { ArrowDown, ArrowRight, Check, CircleAlert, Minus } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { cx } from '@/components/ui/cx';
import { StatusIcon } from '@/components/ui/StatusIcon';
import type { State, Transition } from '@/types';

export interface TransitionMatrixProps {
  /** The states in the order they are shown (rows and columns). */
  states: State[];
  transitions: Transition[];
  onChange: (next: Transition[]) => void;
  /** The start state gets a mark in its row. */
  initialStateId?: string;
  /** States that cannot be reached from the start state: their row is flagged. */
  unreachable?: ReadonlySet<string>;
  /** The cells show the transitions but do not change them. */
  readOnly?: boolean;
}

interface Position {
  row: number;
  col: number;
}

const pairKey = (from: string, to: string) => `${from}\u0000${to}`;
const cellKey = ({ row, col }: Position) => `${row}:${col}`;

/** Names the state in a header: the shape in the colour of its category, then the name. */
function StateName({ state }: { state: State }) {
  return (
    <>
      <StatusIcon icon={state.icon} category={state.category} label={state.name} aria-hidden="true" />
      <span className="min-w-0 truncate">{state.name || 'Unbenannter Status'}</span>
    </>
  );
}

export function TransitionMatrix({ states, transitions, onChange, initialStateId, unreachable, readOnly = false }: TransitionMatrixProps) {
  const size = states.length;
  const [focus, setFocus] = useState<Position>({ row: 0, col: 0 });
  const [hover, setHover] = useState<Position | null>(null);
  const [inside, setInside] = useState(false);
  const cells = useRef(new Map<string, HTMLDivElement>());
  const allowed = useMemo(() => new Set(transitions.map(([from, to]) => pairKey(from, to))), [transitions]);

  // states come and go while the matrix stays; the tab stop has to stay inside the grid
  const stop: Position = { row: Math.min(focus.row, Math.max(size - 1, 0)), col: Math.min(focus.col, Math.max(size - 1, 0)) };
  useEffect(() => {
    if (stop.row !== focus.row || stop.col !== focus.col) setFocus(stop);
  }, [stop.row, stop.col, focus.row, focus.col]);

  if (size === 0) return null;

  function moveTo(next: Position) {
    setFocus(next);
    cells.current.get(cellKey(next))?.focus();
  }

  function toggle(row: number, col: number) {
    if (readOnly || row === col) return;
    const from = states[row].id;
    const to = states[col].id;
    onChange(allowed.has(pairKey(from, to)) ? transitions.filter(([a, b]) => !(a === from && b === to)) : [...transitions, [from, to]]);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>, row: number, col: number) {
    // browser and system shortcuts keep their keys
    if (event.altKey || event.metaKey) return;
    const last = size - 1;
    switch (event.key) {
      case 'ArrowRight':
        moveTo({ row, col: Math.min(col + 1, last) });
        break;
      case 'ArrowLeft':
        moveTo({ row, col: Math.max(col - 1, 0) });
        break;
      case 'ArrowDown':
        moveTo({ row: Math.min(row + 1, last), col });
        break;
      case 'ArrowUp':
        moveTo({ row: Math.max(row - 1, 0), col });
        break;
      case 'Home':
        moveTo({ row: event.ctrlKey ? 0 : row, col: 0 });
        break;
      case 'End':
        moveTo({ row: event.ctrlKey ? last : row, col: last });
        break;
      case ' ':
      case 'Enter':
        toggle(row, col);
        break;
      default:
        return;
    }
    // the arrows must not scroll the page and Space must not either
    event.preventDefault();
  }

  // the row and column of the cell under the pointer or the focus stand out in the headers
  const mark = hover ?? (inside ? stop : null);

  return (
    <div className="overflow-x-auto overscroll-x-contain">
      <table
        role="grid"
        aria-label="Erlaubte Übergänge"
        aria-readonly={readOnly || undefined}
        onFocus={() => setInside(true)}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setInside(false);
        }}
        onMouseLeave={() => setHover(null)}
        className="border-separate border-spacing-0"
      >
        <thead>
          <tr>
            <th scope="col" className="sticky left-0 z-10 min-w-36 bg-surface px-3 pb-1 align-bottom">
              <span className="flex items-center justify-between gap-2 text-sm font-medium text-muted">
                <span className="inline-flex items-center gap-1">
                  Von
                  <ArrowDown className="size-3" aria-hidden="true" />
                </span>
                <span className="inline-flex items-center gap-1">
                  Nach
                  <ArrowRight className="size-3" aria-hidden="true" />
                </span>
              </span>
            </th>
            {states.map((state, col) => (
              <th key={state.id} scope="col" title={state.name} className="h-36 w-11 p-0.5 align-bottom md:w-9">
                <span className="mx-auto flex h-full flex-col items-center justify-end gap-1.5 pb-1">
                  <span
                    className={cx(
                      'max-h-28 overflow-hidden text-ui text-ellipsis whitespace-nowrap [writing-mode:vertical-rl] rotate-180',
                      mark?.col === col ? 'font-semibold text-ink' : 'font-medium text-muted',
                    )}
                  >
                    {state.name || 'Unbenannter Status'}
                  </span>
                  <StatusIcon icon={state.icon} category={state.category} label={state.name} aria-hidden="true" />
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {states.map((from, row) => (
            <tr key={from.id}>
              <th scope="row" className="sticky left-0 z-10 bg-surface py-0.5 pr-3 pl-3 text-left align-middle font-normal">
                <span className={cx('flex items-center gap-2 text-ui', mark?.row === row ? 'font-semibold text-ink' : 'font-medium text-ink')}>
                  <StateName state={from} />
                  {from.id === initialStateId && <span className="shrink-0 rounded-chip border border-line px-1 text-xs font-medium text-muted">Start</span>}
                  {unreachable?.has(from.id) && (
                    <>
                      <CircleAlert className="size-3.5 shrink-0 text-danger" aria-hidden="true" />
                      <span className="sr-only">Vom Startstatus aus nicht erreichbar</span>
                    </>
                  )}
                </span>
              </th>
              {states.map((to, col) => {
                const diagonal = row === col;
                const on = !diagonal && allowed.has(pairKey(from.id, to.id));
                const tabStop = stop.row === row && stop.col === col;
                return (
                  <td key={to.id} role="gridcell" className="p-0.5 text-center">
                    <div
                      ref={(element) => {
                        if (element) cells.current.set(cellKey({ row, col }), element);
                        else cells.current.delete(cellKey({ row, col }));
                      }}
                      role="checkbox"
                      aria-checked={on}
                      aria-disabled={diagonal || undefined}
                      aria-readonly={readOnly || undefined}
                      aria-label={`Von ${from.name || 'Unbenannter Status'} nach ${to.name || 'Unbenannter Status'}`}
                      tabIndex={tabStop ? 0 : -1}
                      onKeyDown={(event) => onKeyDown(event, row, col)}
                      onFocus={() => setFocus({ row, col })}
                      onMouseEnter={() => setHover({ row, col })}
                      onClick={() => {
                        setFocus({ row, col });
                        toggle(row, col);
                      }}
                      className={cx(
                        'mx-auto flex size-11 items-center justify-center rounded-ctl border transition-colors duration-120 select-none md:size-8',
                        diagonal
                          ? 'cursor-not-allowed border-transparent bg-sunken text-faint'
                          : on
                            ? cx('border-accent bg-accent text-on-accent', !readOnly && 'cursor-pointer hover:bg-accent-hover')
                            : cx('border-line bg-surface', !readOnly && 'cursor-pointer hover:border-line-input hover:bg-hover'),
                        readOnly && !diagonal && 'cursor-default',
                      )}
                    >
                      {diagonal ? <Minus className="size-3.5" aria-hidden="true" /> : on && <Check className="size-4" strokeWidth={3} aria-hidden="true" />}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
