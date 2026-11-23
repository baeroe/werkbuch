/*
 * GitHub (WEBU-18, spec 10.2 and 11.3). Not connected: one step, the manifest flow of the one app at GitHub (name,
 * rights, webhook address and the way back are filled in) and its installation on the repos. Connected: the state of
 * the app, the repos with whether a ruleset protects the base branch (only shown: werkbuch detects an unauthorized
 * merge either way), and "Trennen". Private key and webhook secret stay on the server and never show.
 */

import { Check, ExternalLink, GitBranch, Lock, ShieldAlert, ShieldCheck, Unplug } from 'lucide-react';
import { useRef, useState } from 'react';
import { AlertDialog } from '@/components/ui/AlertDialog';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/toast';
import { focusWhenLost } from '@/features/item-detail/shared';
import { useConnectGithub, useDisconnectGithub, useGithub, useRepoOwners } from '@/hooks/agents';
import { useSettle } from '@/hooks/mutation';
import { notifyError } from '@/lib/errors';
import { DEMO_ORIGIN } from '@/lib/links';
import type { GithubApp, GithubConnection } from '@/types';
import { formatDate, useOrgZone } from './format';
import { Badge, FormSkeleton, Loaded, Panel, Row, Rows, SectionHeader } from './parts';
import type { SectionProps } from './sections';

/** The page title takes the focus when the view under it changes (connected, disconnected). */
const GITHUB_TITLE = 'github-title';

const RIGHTS = ['Inhalte schreiben', 'Pull Requests schreiben', 'Checks lesen', 'Actions lesen', 'Metadaten lesen'];

/* -------------------------------------------------------------------------- connect */

function Connect() {
  const settle = useSettle();
  const connect = useConnectGithub();

  function start() {
    settle(connect.mutateAsync(undefined), {
      onSuccess: (next) => {
        toast({ title: `„${next.app?.name}“ angelegt und installiert`, description: 'GitHub ist verbunden. Projekte können jetzt ein Repo wählen.', tone: 'success' });
        // the button goes with the step: the focus goes to the page title above the connected view
        focusWhenLost(() => document.getElementById(GITHUB_TITLE), 2000);
      },
      onError: (error) => notifyError('GitHub nicht verbunden', error, start),
    });
  }

  return (
    <Panel title="Mit GitHub verbinden" description="Eine App, einmalig: GitHub führt durch Anlegen und Installieren und kommt danach hierher zurück. Wähle dabei die Repos, an denen Agenten arbeiten sollen.">
      <div className="flex flex-col gap-3 p-4">
        <p className="max-w-[65ch] text-ui text-pretty text-ink">
          Die App pusht, öffnet Pull Requests, schreibt Reviews und mergt, wenn CI grün ist und das Review keine Befunde hat. Sie meldet werkbuch Pushes, PRs und Checks. Vorgeschlagener Name: Feldwerk
          werkbuch.
        </p>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted">Rechte</dt>
          <dd className="text-ink">{RIGHTS.join(', ')}</dd>
          <dt className="text-muted">Webhooks</dt>
          <dd className="break-all text-ink" translate="no">
            {`${DEMO_ORIGIN}/github/webhook`}
          </dd>
        </dl>
        <div>
          <Button variant="primary" icon={ExternalLink} pending={connect.isPending} onClick={start}>
            Mit GitHub verbinden
          </Button>
        </div>
      </div>
    </Panel>
  );
}

/* ---------------------------------------------------------------------- connected */

function AppRow({ app }: { app: GithubApp }) {
  const zone = useOrgZone();
  return (
    <Row className="items-start">
      <div className="min-w-0 flex-1 basis-64">
        <p className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-ink">{app.name}</span>
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
  /** Where the focus goes when the question closes: back to „GitHub trennen“, after the disconnect to the page title. */
  const afterDisconnect = useRef<HTMLElement | null>(null);
  const ownerOf = (repo: string) => owners.data?.find((entry) => entry.repo === repo);

  function run() {
    settle(disconnect.mutateAsync(undefined), {
      onSuccess: () => {
        afterDisconnect.current = document.getElementById(GITHUB_TITLE);
        setAsking(false);
        toast({ title: 'GitHub getrennt', description: 'Lösche die App bei GitHub, wenn du sie nicht mehr brauchst.', tone: 'success' });
      },
      onError: (error) => notifyError('GitHub nicht getrennt', error, run),
    });
  }

  return (
    <>
      <Panel title="App">
        <Rows label="GitHub-App">{github.app && <AppRow app={github.app} />}</Rows>
      </Panel>

      <Panel
        title="Repos"
        description="Ein Projekt wählt sein Repo in den Projekteinstellungen unter „Agenten“; ein Repo gehört höchstens einem Projekt. Ob ein Ruleset den Basis-Branch schützt, steht nur zur Information da."
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
                  {repo.protected ? (
                    <Badge icon={ShieldCheck}>{`Ruleset schützt ${repo.default_branch}`}</Badge>
                  ) : (
                    <Badge tone="quiet" icon={ShieldAlert}>{`${repo.default_branch} ohne Ruleset`}</Badge>
                  )}
                  {owner ? (
                    <Badge tone="accent">
                      <span translate="no">{owner.identifier ?? 'anderes Projekt'}</span>
                    </Badge>
                  ) : (
                    <span className="text-sm text-muted">Kein Projekt</span>
                  )}
                </div>
              </Row>
            );
          })}
        </Rows>
      </Panel>

      <Banner tone="info" icon={ShieldCheck} title="Ruleset empfohlen">
        <span className="block max-w-[65ch]">
          werkbuch mergt, wenn CI grün ist und das Review keine Befunde hat; die App ist dabei der einzige Weg auf den Basis-Branch. Ein Ruleset (Pull Request nötig, Check „tests“ grün, nur die App als
          Bypass) verhindert, dass ein Agent, der sich etwas einreden lässt, selbst auf main pusht. Ohne Ruleset erkennt werkbuch einen eigenmächtigen Merge und pausiert alle Stränge des Projekts, bis
          ein Projekt-Admin bestätigt.
        </span>
      </Banner>

      <Panel title="Trennen" description="werkbuch vergisst die App. Projekte verlieren ihr Repo, laufende Stränge halten an. Die App bleibt bei GitHub, bis du sie dort löschst.">
        <div className="p-4">
          <Button
            variant="secondary"
            icon={Unplug}
            onClick={(event) => {
              afterDisconnect.current = event.currentTarget;
              setAsking(true);
            }}
          >
            GitHub trennen
          </Button>
        </div>
      </Panel>
      <AlertDialog
        open={asking}
        onOpenChange={setAsking}
        title="GitHub trennen?"
        description="Kein Agent kann danach pushen oder PRs öffnen, und werkbuch hört keine Webhooks von GitHub mehr. Offene Stränge pausieren, laufende Aufträge werden abgebrochen; PRs und Branches bleiben bei GitHub. Zum Verbinden legst du die App neu an."
        confirmLabel="Trennen"
        pending={disconnect.isPending}
        finalFocus={afterDisconnect}
        onConfirm={run}
      />
    </>
  );
}

export default function Github(_props: SectionProps) {
  const github = useGithub();
  const connected = github.data?.app != null;
  return (
    <div className="flex flex-col gap-4">
      <SectionHeader
        titleId={GITHUB_TITLE}
        title="GitHub"
        description="Über eine GitHub-App arbeiten Agenten an Repos: Sie pushen und öffnen PRs als App der Instanz, nie als eine Person. Tokens gelten je Auftrag für ein Repo und eine Stunde."
        actions={connected ? <Badge tone="accent" icon={Check}>Verbunden</Badge> : undefined}
      />
      <Loaded queries={[github]} failure="Die Verbindung zu GitHub konnte nicht geladen werden" skeleton={<FormSkeleton label="GitHub wird geladen …" />}>
        {() => (connected ? <Connected github={github.data!} /> : <Connect />)}
      </Loaded>
    </div>
  );
}
