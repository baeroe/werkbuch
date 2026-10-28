import { afterEach, describe, expect, it, vi } from 'vitest';
import { listCommands, registerCommand, type CommandDef } from './commands';

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((off) => off()));

const command = (id: string, label: string): CommandDef => ({ id, label, group: 'Aktionen', run: vi.fn() });

describe('command registry', () => {
  it('keeps the place of a command that registers again, so the palette does not reorder', () => {
    const offSidebar = registerCommand(command('sidebar', 'Seitenleiste einklappen'));
    cleanups.push(registerCommand(command('help', 'Alle Tastaturkürzel')));

    // the label follows the state: the command registers again
    offSidebar();
    cleanups.push(registerCommand(command('sidebar', 'Seitenleiste ausklappen')));

    expect(listCommands().map((entry) => entry.label)).toEqual(['Seitenleiste ausklappen', 'Alle Tastaturkürzel']);
  });

  it('replaces a command registered again under its id, and the old handle no longer removes it', () => {
    const offFirst = registerCommand(command('theme', 'Theme wechseln …'));
    cleanups.push(registerCommand(command('theme', 'Farbschema wechseln …')));

    offFirst();

    expect(listCommands().map((entry) => entry.label)).toEqual(['Farbschema wechseln …']);
  });
});
