/*
 * Organisation → Betrieb → MCP-Server (WEBU-18, spec 8.7 and 10.7): the catalog of stdio servers projects can give
 * their agents, besides werkbuch's own. Each row says which projects use the server and on which runners its command
 * is missing. The values of the environment are write-only: after saving, a variable reads „gesetzt“ with „ersetzen“,
 * and nothing ever shows the value again. Deleting asks first and names the projects that lose the server.
 */

import { Pencil, Plug, Plus, Trash2, TriangleAlert, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { AlertDialog } from '@/components/ui/AlertDialog';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { IconButton } from '@/components/ui/IconButton';
import { Input } from '@/components/ui/Input';
import { labelClass } from '@/components/ui/styles';
import { Textarea } from '@/components/ui/Textarea';
import { toast } from '@/components/ui/toast';
import { useDeleteMcpServer, useMcpServers, useSaveMcpServer } from '@/hooks/agents';
import { useSettle } from '@/hooks/mutation';
import { notifyError } from '@/lib/errors';
import type { McpServer } from '@/types';
import { fieldMessage, noticeOf } from './errors';
import { focusSoon, neighbourOf } from './focus';
import { FormDialog } from './FormDialog';
import { Badge, Loaded, Panel, Row, Rows, RowsSkeleton, SectionHeader } from './parts';
import type { SectionProps } from './sections';
import { useDialogRound } from './useDialogRound';

interface EnvRow {
  key: string;
  name: string;
  /** Stored on the server: the value stays unless „ersetzen“ opens a field. */
  stored: boolean;
  /** Null: keep the stored value; a text: the new one. */
  value: string | null;
}

let envSequence = 0;
const envKey = () => `env_${(envSequence += 1)}`;

/** The list of names in words: „WEB und APP“. */
const listed = (names: string[]) => new Intl.ListFormat('de', { type: 'conjunction' }).format(names);

function ServerDialog({ server, open, onOpenChange }: { server: McpServer | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  const settle = useSettle();
  const save = useSaveMcpServer();
  const [name, setName] = useState(server?.name ?? '');
  const [command, setCommand] = useState(server?.command ?? '');
  const [args, setArgs] = useState(server?.args.join('\n') ?? '');
  const [env, setEnv] = useState<EnvRow[]>(() => (server?.env ?? []).map((entry) => ({ key: envKey(), name: entry.name, stored: entry.set, value: null })));
  const list = useRef<HTMLUListElement>(null);
  const error = (path: string) => fieldMessage(save.error, path);

  function patch(key: string, change: Partial<EnvRow>) {
    setEnv((rows) => rows.map((row) => (row.key === key ? { ...row, ...change } : row)));
  }

  function submit() {
    const input = {
      id: server?.id,
      name,
      command,
      args: args.split('\n'),
      env: env.map((row) => ({ name: row.name, value: row.value })),
    };
    settle(save.mutateAsync(input), {
      onSuccess: (saved) => {
        onOpenChange(false);
        toast({ title: server ? `„${saved.name}“ gespeichert` : `„${saved.name}“ ist im Katalog`, description: server ? undefined : 'Projekte haken ihn unter Projekteinstellungen → Agenten an.', tone: 'success' });
      },
    });
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={server ? `„${server.name}“ bearbeiten` : 'MCP-Server anlegen'}
      description="Ein Server, den der Runner über stdio startet. Werte der Umgebung liegen verschlüsselt in werkbuch und erreichen nur den Runner, für die Dauer eines Auftrags."
      submitLabel={server ? 'Speichern' : 'Anlegen'}
      pending={save.isPending}
      notice={noticeOf(save.error, ['name', 'command', ...env.flatMap((_, index) => [`env.${index}.name`, `env.${index}.value`])])}
      onSubmit={submit}
    >
      <Input label="Name" name="mcp_name" autoComplete="off" autoCapitalize="none" spellCheck={false} translate="no" placeholder="playwright" hint="Kleinbuchstaben, Ziffern und -. Nicht werkbuch: den bekommt jeder Agent schon." value={name} error={error('name')} onChange={(event) => setName(event.target.value)} />
      <Input label="Befehl" name="mcp_command" autoComplete="off" autoCapitalize="none" spellCheck={false} translate="no" placeholder="npx" hint="Muss auf jedem Runner im PATH liegen; fehlt er, scheitert ein Auftrag dort sofort." value={command} error={error('command')} onChange={(event) => setCommand(event.target.value)} />
      <Textarea label="Argumente" name="mcp_args" rows={3} spellCheck={false} translate="no" autoCapitalize="none" placeholder={'@playwright/mcp\n--headless'} hint="Eins je Zeile." value={args} onChange={(event) => setArgs(event.target.value)} />
      <div className="flex flex-col gap-2">
        <p className={labelClass}>Umgebungsvariablen</p>
        {env.length === 0 ? (
          <p className="text-sm text-muted">Keine. API-Schlüssel und Ähnliches gehören hierher, nicht in die Argumente.</p>
        ) : (
          <ul ref={list} aria-label="Umgebungsvariablen" className="flex flex-col gap-2">
            {env.map((row, index) => (
              <li key={row.key} className="flex flex-wrap items-start gap-2 sm:flex-nowrap">
                <Input
                  aria-label={`Name der Variable ${index + 1}`}
                  className="min-w-0 flex-1 basis-40"
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  translate="no"
                  placeholder="API_KEY"
                  value={row.name}
                  error={error(`env.${index}.name`)}
                  onChange={(event) => patch(row.key, { name: event.target.value })}
                />
                {row.stored && row.value === null ? (
                  <span className="flex min-w-0 flex-1 basis-48 items-center gap-2">
                    <Badge tone="quiet">gesetzt</Badge>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(event) => {
                        const item = event.currentTarget.closest('li');
                        patch(row.key, { value: '' });
                        requestAnimationFrame(() => item?.querySelector<HTMLInputElement>('input[type="password"]')?.focus());
                      }}
                    >
                      Ersetzen <span className="sr-only">{row.name}</span>
                    </Button>
                  </span>
                ) : (
                  <Input
                    aria-label={`Wert von ${row.name || `Variable ${index + 1}`}`}
                    className="min-w-0 flex-1 basis-48"
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder={row.stored ? 'neuer Wert' : 'Wert'}
                    value={row.value ?? ''}
                    error={error(`env.${index}.value`)}
                    onChange={(event) => patch(row.key, { value: event.target.value })}
                  />
                )}
                {row.stored && row.value !== null && (
                  <IconButton icon={X} label={`Ersetzen abbrechen: ${row.name}`} onClick={() => patch(row.key, { value: null })} />
                )}
                <IconButton
                  icon={Trash2}
                  label={`Variable ${row.name || index + 1} entfernen`}
                  onClick={(event) => {
                    const next = neighbourOf(event.currentTarget);
                    focusSoon(next && next.id !== 'main' ? next : document.getElementById('add-env'));
                    setEnv((rows) => rows.filter((entry) => entry.key !== row.key));
                  }}
                />
              </li>
            ))}
          </ul>
        )}
        <div>
          <Button
            id="add-env"
            variant="secondary"
            size="sm"
            icon={Plus}
            onClick={() => {
              setEnv((rows) => [...rows, { key: envKey(), name: '', stored: false, value: '' }]);
              requestAnimationFrame(() => list.current?.querySelector<HTMLInputElement>('li:last-child input')?.focus() ?? document.querySelector<HTMLInputElement>('[aria-label^="Name der Variable"]')?.focus());
            }}
          >
            Variable hinzufügen
          </Button>
        </div>
      </div>
    </FormDialog>
  );
}

function ServerRow({ server, onEdit, onDelete }: { server: McpServer; onEdit: () => void; onDelete: () => void }) {
  return (
    <Row className="items-start">
      <div className="min-w-0 flex-1 basis-72">
        <h3 className="flex flex-wrap items-center gap-2 text-ui font-semibold text-ink">
          <span translate="no">{server.name}</span>
          {server.env.length > 0 && <Badge tone="quiet">{`${server.env.length} ${server.env.length === 1 ? 'Variable' : 'Variablen'} gesetzt`}</Badge>}
        </h3>
        <p className="mt-0.5 text-sm break-words text-muted" translate="no">
          {[server.command, ...server.args].join(' ')}
        </p>
        <dl className="mt-1.5 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
          <dt className="text-muted">Genutzt von</dt>
          <dd className="text-ink">{server.projects.length === 0 ? <span className="text-muted">keinem Projekt</span> : listed(server.projects.map((project) => project.identifier))}</dd>
          {server.missing_on.length > 0 && (
            <>
              <dt className="text-muted">Fehlt auf</dt>
              <dd className="flex items-start gap-1.5 text-danger">
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                <span>{`${listed(server.missing_on.map((runner) => runner.name))}: Befehl nicht gefunden.${server.projects.length > 0 ? ` Aufträge von ${listed(server.projects.map((project) => project.identifier))} scheitern dort sofort.` : ''}`}</span>
              </dd>
            </>
          )}
        </dl>
      </div>
      <div className="flex items-center">
        <IconButton icon={Pencil} label={`„${server.name}“ bearbeiten`} onClick={onEdit} />
        <IconButton icon={Trash2} label={`„${server.name}“ löschen`} onClick={onDelete} />
      </div>
    </Row>
  );
}

export default function McpServers({ readOnlyReason: _readOnly }: SectionProps) {
  const servers = useMcpServers();
  const settle = useSettle();
  const remove = useDeleteMcpServer();
  const dialog = useDialogRound<McpServer>();
  const [deleting, setDeleting] = useState<McpServer | null>(null);
  /** Back to the trash button on „Abbrechen“; after the delete to the next row, or to „MCP-Server anlegen“. */
  const afterDelete = useRef<HTMLElement | null>(null);
  const create = useRef<HTMLButtonElement>(null);
  const add = (
    <Button ref={create} variant="primary" icon={Plus} onClick={() => dialog.show()}>
      MCP-Server anlegen
    </Button>
  );

  function runDelete(server: McpServer) {
    const next = neighbourOf(afterDelete.current);
    const target = next && next.id !== 'main' ? next : create.current;
    settle(remove.mutateAsync(server.id), {
      onSuccess: ({ projects }) => {
        afterDelete.current = target;
        setDeleting(null);
        toast({ title: `„${server.name}“ gelöscht`, description: projects.length > 0 ? `Die Agenten von ${listed(projects)} bekommen ihn nicht mehr.` : undefined, tone: 'success' });
      },
      onError: (error) => notifyError(`„${server.name}“ nicht gelöscht`, error, () => runDelete(server)),
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <SectionHeader
        title="MCP-Server"
        description="Werkzeuge, die Projekte ihren Agenten zusätzlich zu werkbuch geben. Ein Agent sieht nur diese, nie die Server der Maschine. Nur stdio."
        actions={add}
      />
      <Loaded queries={[servers]} failure="Die MCP-Server konnten nicht geladen werden" skeleton={<RowsSkeleton rows={3} label="Die MCP-Server werden geladen …" />}>
        {() => {
          const list = servers.data?.items ?? [];
          if (list.length === 0) {
            return <EmptyState icon={Plug} title="Noch kein MCP-Server" description="Etwa Playwright für Tests im Browser oder eine Doku-Suche. Projekte haken ihn danach unter Agenten an." actions={add} />;
          }
          return (
            <Panel>
              <Rows label="MCP-Server">
                {list.map((server) => (
                  <ServerRow
                    key={server.id}
                    server={server}
                    onEdit={() => dialog.show(server)}
                    onDelete={() => {
                      afterDelete.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
                      setDeleting(server);
                    }}
                  />
                ))}
              </Rows>
            </Panel>
          );
        }}
      </Loaded>
      <ServerDialog key={`mcp-${dialog.round}`} server={dialog.target} open={dialog.open} onOpenChange={dialog.setOpen} />
      <AlertDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`„${deleting?.name ?? ''}“ löschen?`}
        description={
          deleting && deleting.projects.length > 0
            ? `${listed(deleting.projects.map((project) => project.identifier))} ${deleting.projects.length === 1 ? 'nutzt' : 'nutzen'} ihn; die Agenten dort bekommen ihn danach nicht mehr. Gespeicherte Werte der Umgebung gehen mit.`
            : 'Kein Projekt nutzt ihn. Gespeicherte Werte der Umgebung gehen mit.'
        }
        confirmLabel="Löschen"
        pending={remove.isPending}
        finalFocus={afterDelete}
        onConfirm={() => deleting && runDelete(deleting)}
      />
    </div>
  );
}
