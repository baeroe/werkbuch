/*
 * GitHub (WEBU-18, spec 10.2 and 11.3). Not connected: two steps, each a manifest flow at GitHub (name, rights,
 * webhook address and the way back are filled in), first the agent app, then the review app, both installed on the
 * same repos. Connected: the state of both apps, the repos (only those with both apps can be chosen by a project), the
 * ruleset every repo needs, and "Trennen". Private keys and webhook secrets stay on the server and never show.
 */

import { Check, ExternalLink, GitBranch, Lock, ShieldCheck, Unplug } from 'lucide-react';
import { useState } from 'react';
import { AlertDialog } from '@/components/ui/AlertDialog';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { cx } from '@/components/ui/cx';
import { toast } from '@/components/ui/toast';
import { useConnectGithubApp, useDisconnectGithub, useGithub, useRepoOwners } from '@/hooks/agents';
import { useSettle } from '@/hooks/mutation';
import { notifyError } from '@/lib/errors';
import { DEMO_ORIGIN } from '@/lib/links';
import type { GithubApp, GithubConnection } from '@/types';
import { formatDate, useOrgZone } from './format';
import { Badge, FormSkeleton, Loaded, Panel, Row, Rows, SectionHeader } from './parts';
import type { SectionProps } from './sections';

const AGENT_RIGHTS = ['Inhalte schreiben', 'Pull Requests schreiben', 'Checks lesen', 'Actions lesen', 'Metadaten lesen'];
const REVIEW_RIGHTS = ['Pull Requests schreiben', 'Inhalte lesen', 'Metadaten lesen'];

/* -------------------------------------------------------------------------- steps */

type StepProps = {
  number: 1 | 2;
  title: string;
  text: string;
  rights: string[];
  webhooks: boolean;
  app: GithubApp | null;
  /** The step before is not done yet: why this one waits. */
  waitsFor: string | null;
  pending: boolean;
  onStart: () => void;
};

function Step({ number, title, text, rights, webhooks, app, waitsFor, pending, onStart }: StepProps) {
  const done = app !== null;
  return (
    <li className="flex gap-3 px-4 py-4">
      <span
        className={cx('mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full border text-sm font-semibold tabular-nums', done ? 'border-transparent bg-accent text-on-accent' : 'border-line-strong text-ink')}
        aria-hidden="true"
      >
        {done ? <Check className="size-4" strokeWidth={3} /> : number}
      </span>
      <div className="min-w-0 flex-1">
        <h3 className="text-md font-semibold text-ink">
          <span className="sr-only">{`Schritt ${number}${done ? ', erledigt' : ''}: `}</span>
          {title}
        </h3>
        <p className="mt-0.5 max-w-[65ch] text-ui text-pretty text-muted">{text}</p>
        <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted">Rechte</dt>
          <dd className="text-ink">{rights.join(', ')}</dd>
          <dt className="text-muted">Webhooks</dt>
          <dd className="break-all text-ink" translate="no">
            {webhooks ? `${DEMO_ORIGIN}/github/webhook` : 'keine'}
          </dd>
        </dl>
        <div className="mt-3">
          {done ? (
            <p className="text-ui text-ink">
              <span className="font-semibold">{app.name}</span> ist angelegt und installiert.
            </p>
          ) : (
            <Button variant={waitsFor ? 'secondary' : 'primary'} icon={ExternalLink} pending={pending} disabledReason={waitsFor} onClick={onStart}>
              Bei GitHub anlegen
            </Button>
          )}
        </div>
      </div>
    </li>
  );
}

function ConnectSteps({ github }: { github: GithubConnection }) {
  const settle = useSettle();
  const connect = useConnectGithubApp();

  function start(kind: 'agent' | 'review') {
    settle(connect.mutateAsync(kind), {
      onSuccess: (next) => {
        const app = kind === 'agent' ? next.agent_app : next.review_app;
        toast({ title: `„${app?.name}“ angelegt`, description: kind === 'agent' ? 'Jetzt fehlt noch die Review-App.' : 'GitHub ist verbunden. Projekte können jetzt ein Repo wählen.', tone: 'success' });
      },
      onError: (error) => notifyError('GitHub-App nicht angelegt', error, () => start(kind)),
    });
  }

  return (
    <Panel title="Mit GitHub verbinden" description="Zwei Apps, einmalig: GitHub führt jeweils durch Anlegen und Installieren und kommt danach hierher zurück. Wähle bei beiden dieselben Repos.">
      <ol className="divide-y divide-line">
        <Step
          number={1}
          title="Agenten-App"
          text="Pusht, öffnet Pull Requests und mergt, wenn CI und Freigabe auf demselben Commit grün sind. Meldet werkbuch Pushes, PRs und Checks. Vorgeschlagener Name: Feldwerk werkbuch."
          rights={AGENT_RIGHTS}
          webhooks
          app={github.agent_app}
          waitsFor={null}
          pending={connect.isPending && connect.variables === 'agent'}
          onStart={() => start('agent')}
        />
        <Step
          number={2}
          title="Review-App"
          text="Gibt Pull Requests frei, wenn das Review eines Agenten keine Befunde hat. Pusht nie. Vorgeschlagener Name: Feldwerk werkbuch review."
          rights={REVIEW_RIGHTS}
          webhooks={false}
          app={github.review_app}
          waitsFor={github.agent_app === null ? 'Lege zuerst die Agenten-App an.' : null}
          pending={connect.isPending && connect.variables === 'review'}
          onStart={() => start('review')}
        />
      </ol>
    </Panel>
  );
}

/* ---------------------------------------------------------------------- connected */

function AppRow({ role, app }: { role: string; app: GithubApp }) {
  const zone = useOrgZone();
  return (
    <Row className="items-start">
      <div className="min-w-0 flex-1 basis-64">
        <p className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-ink">{app.name}</span>
          <Badge tone="quiet">{role}</Badge>
          {app.installed && <Badge icon={Check}>Installiert</Badge>}
        </p>
        <p className="mt-1 text-sm text-pretty text-muted">{`${app.permissions.join(', ')}. ${app.webhooks ? 'Webhooks an werkbuch.' : 'Keine Webhooks.'} Angelegt am ${formatDate(app.created_at, zone)}.`}</p>
      </div>
      <a
        href={`https://github.com/apps/${app.slug}`}
        target="_blank"
        rel="noreferrer"
        className="inline-flex h-11 items-center gap-1.5 rounded-ctl px-2.5 text-ui font-medium text-accent-text hover:bg-hover md:h-8"
      >
        Bei GitHub
        <ExternalLink className="size-3.5" aria-hidden="true" />
        <span className="sr-only">(öffnet GitHub, {app.name})</span>
      </a>
    </Row>
  );
}

function Connected({ github }: { github: GithubConnection }) {
  const settle = useSettle();
  const disconnect = useDisconnectGithub();
  const owners = useRepoOwners();
  const [asking, setAsking] = useState(false);
  const ownerOf = (repo: string) => owners.data?.find((entry) => entry.repo === repo);

  function run() {
    settle(disconnect.mutateAsync(undefined), {
      onSuccess: () => {
        setAsking(false);
        toast({ title: 'GitHub getrennt', description: 'Lösche die beiden Apps bei GitHub, wenn du sie nicht mehr brauchst.', tone: 'success' });
      },
      onError: (error) => notifyError('GitHub nicht getrennt', error, run),
    });
  }

  return (
    <>
      <Panel title="Apps">
        <Rows label="GitHub-Apps">
          {github.agent_app && <AppRow role="Agenten-App" app={github.agent_app} />}
          {github.review_app && <AppRow role="Review-App" app={github.review_app} />}
        </Rows>
      </Panel>

      <Panel
        title="Repos"
        description="Ein Projekt wählt sein Repo in den Projekteinstellungen unter „Agenten“. Wählbar sind nur Repos, auf denen beide Apps installiert sind; ein Repo gehört höchstens einem Projekt."
        actions={
          <a
            href="https://github.com/apps/feldwerk-werkbuch/installations/new"
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-11 items-center gap-1.5 rounded-ctl border border-line-strong bg-surface px-3 text-ui font-medium text-ink shadow-elev-1 hover:bg-sunken md:h-8"
          >
            Repos bei GitHub ändern
            <ExternalLink className="size-3.5 text-muted" aria-hidden="true" />
            <span className="sr-only">(öffnet GitHub)</span>
          </a>
        }
      >
        <Rows label="Freigegebene Repos">
          {github.repos.map((repo) => {
            const both = repo.agent_app && repo.review_app;
            const owner = ownerOf(repo.full_name);
            return (
              <Row key={repo.full_name}>
                <div className="flex min-w-0 flex-1 basis-56 items-center gap-2">
                  <GitBranch className="size-4 shrink-0 text-muted" aria-hidden="true" />
                  <span className="min-w-0 font-medium break-all text-ink" translate="no">
                    {repo.full_name}
                  </span>
                  {repo.private && (
                    <span className="inline-flex items-center gap-1 text-sm text-muted">
                      <Lock className="size-3.5" aria-hidden="true" />
                      privat
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {both ? <Badge icon={Check}>Beide Apps</Badge> : <Badge tone="danger">Review-App fehlt</Badge>}
                  {owner ? (
                    <Badge tone="accent">
                      <span translate="no">{owner.identifier ?? 'anderes Projekt'}</span>
                    </Badge>
                  ) : (
                    <span className="text-sm text-muted">{both ? 'Kein Projekt' : 'Nicht wählbar'}</span>
                  )}
                </div>
              </Row>
            );
          })}
        </Rows>
      </Panel>

      <Banner tone="info" icon={ShieldCheck} title="Ruleset für jedes Repo">
        <span className="block max-w-[65ch]">
          Schütze den Standard-Branch mit einem Ruleset: Pull Request nötig, Check „tests“ muss grün sein, ein Approve, keine App und keine Person als Bypass. werkbuch mergt nur, wenn CI und die Freigabe der
          Review-App auf demselben Commit grün sind. Ohne Bypass kann auch ein Agent, der sich etwas einreden lässt, weder mergen noch auf main pushen.
        </span>
      </Banner>

      <Panel title="Trennen" description="werkbuch vergisst beide Apps. Projekte verlieren ihr Repo, laufende Stränge halten an. Die Apps bleiben bei GitHub, bis du sie dort löschst.">
        <div className="p-4">
          <Button variant="secondary" icon={Unplug} onClick={() => setAsking(true)}>
            GitHub trennen
          </Button>
        </div>
      </Panel>
      <AlertDialog
        open={asking}
        onOpenChange={setAsking}
        title="GitHub trennen?"
        description="Kein Agent kann danach pushen oder PRs öffnen, und werkbuch hört keine Webhooks von GitHub mehr. Zum Verbinden legst du die Apps neu an."
        confirmLabel="Trennen"
        pending={disconnect.isPending}
        onConfirm={run}
      />
    </>
  );
}

export default function Github(_props: SectionProps) {
  const github = useGithub();
  const connected = github.data?.agent_app != null && github.data?.review_app != null;
  return (
    <div className="flex flex-col gap-4">
      <SectionHeader
        title="GitHub"
        description="Über zwei GitHub-Apps arbeiten Agenten an Repos: Sie pushen und öffnen PRs als App der Instanz, nie als eine Person. Tokens gelten je Auftrag für ein Repo und eine Stunde."
        actions={connected ? <Badge tone="accent" icon={Check}>Verbunden</Badge> : undefined}
      />
      <Loaded queries={[github]} failure="Die Verbindung zu GitHub konnte nicht geladen werden" skeleton={<FormSkeleton label="GitHub wird geladen …" />}>
        {() => (connected ? <Connected github={github.data!} /> : <ConnectSteps github={github.data!} />)}
      </Loaded>
    </div>
  );
}
