/*
 * Settings → GitHub (spec 10.2, 11.3; port of the clickdummy's `Github.tsx`, org admins only). Not connected: one step,
 * the manifest flow of the one app. The browser posts the manifest to GitHub (the person's own account, or a GitHub
 * organization); GitHub registers the app, comes back to `/github/manifest`, which sends on to the installation on the
 * repos, and after that back here. Connected: the app with its rights and installations, the repos with their project
 * and whether a ruleset protects its base branch, "Repos bei GitHub ändern" (`/github/install`, with a state of its own),
 * "Neu einlesen" and "Trennen". The ruleset is only shown: werkbuch detects an unauthorized merge with or without one.
 * Private key and webhook secret stay on the server and never show.
 */

import { Building2, Check, ExternalLink, GitBranch, Lock, RefreshCw, Shield, ShieldAlert, ShieldCheck, Unplug, User as UserIcon } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { AlertDialog } from '@/components/ui/AlertDialog';
import { Banner } from '@/components/ui/Banner';
import { Button, buttonClass } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { toast } from '@/components/ui/toast';
import { useDisconnectGitHub, useGitHub, useStartGitHubManifest, useSyncGitHub } from '@/hooks/github';
import { useSettle } from '@/hooks/mutation';
import { useOrganization } from '@/hooks/organization';
import { notifyError } from '@/lib/errors';
import { focusWhenLost } from '@/lib/focusOrigin';
import { t, tn } from '@/lib/i18n';
import { instanceOrigin } from '@/lib/links';
import type { GitHubApp, GitHubInstallation, GitHubRepository, GitHubStatus } from '@/types';
import { fieldMessage } from '../../frame/form';
import { formatDate, useOrgZone } from '../../frame/format';
import { Badge, FormSkeleton, Loaded, Measure, Panel, Row, Rows, SectionHeader } from '../../frame/parts';
import type { SectionProps } from '../sections';
import { MANIFEST_PERMISSIONS, permissionTexts } from './permissions';

/** The page title takes the focus when the view under it changes (disconnected). */
export const GITHUB_TITLE = 'github-title';

/**
 * Where the person goes to choose the repos of the installation: werkbuch gives a state there that GitHub sends back,
 * and GitHub returns to the settings afterwards. In the same tab: a second tab would keep this page with the old repos.
 */
const INSTALL_PATH = '/github/install';

/** GitHub allows 34 characters for the name of an app; the manifest shortens the organization before " werkbuch". */
const NAME_MAX = 34;
const SUFFIX = ' werkbuch';

/** The name the manifest proposes (`App\GitHub\Manifest::for`). */
export const proposedName = (organization: string): string => `${[...organization].slice(0, NAME_MAX - SUFFIX.length).join('').trim()}${SUFFIX}`;

/** Posts the manifest to GitHub the way a form would: the page leaves werkbuch. */
function postToGitHub(url: string, manifest: Record<string, unknown>): void {
  const form = document.createElement('form');
  form.method = 'post';
  form.action = url;
  form.hidden = true;
  const field = document.createElement('input');
  field.type = 'hidden';
  field.name = 'manifest';
  field.value = JSON.stringify(manifest);
  form.append(field);
  document.body.append(form);
  form.submit();
}

const externalLink = 'inline-flex h-11 items-center gap-1.5 rounded-ctl px-2.5 text-ui font-medium text-accent-text hover:bg-hover md:h-8';

/* -------------------------------------------------------------------------- connect */

function Connect() {
  const settle = useSettle();
  const start = useStartGitHubManifest();
  const organization = useOrganization();
  const [owner, setOwner] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);
  // the page is on its way to GitHub: the button stays busy until it is gone
  const [leaving, setLeaving] = useState(false);
  // back from GitHub through the back/forward cache: the page is the one that left, busy button and all
  useEffect(() => {
    const back = (event: PageTransitionEvent) => {
      if (event.persisted) setLeaving(false);
    };
    window.addEventListener('pageshow', back);
    return () => window.removeEventListener('pageshow', back);
  }, []);

  function connect(event?: FormEvent) {
    event?.preventDefault();
    if (start.isPending || leaving) return;
    settle(start.mutateAsync(owner.trim() === '' ? null : owner.trim()), {
      onSuccess: (answer) => {
        setLeaving(true);
        postToGitHub(answer.url, answer.manifest);
      },
      onError: (failure) => {
        const message = fieldMessage(failure, 'organization');
        if (message) {
          setError(message);
          document.getElementById('github-organization')?.focus();
        } else notifyError(t('settings.github.connect.failed'), failure, () => connect());
      },
    });
  }

  return (
    <Panel title={t('settings.github.connect.title')} description={t('settings.github.connect.description')}>
      <form noValidate onSubmit={connect} className="flex flex-col gap-3 p-4">
        <p className="max-w-[65ch] text-ui text-pretty text-ink">
          {t('settings.github.connect.what')}
          {organization.data ? ` ${t('settings.github.connect.proposed', { name: proposedName(organization.data.name) })}` : null}
        </p>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted">{t('settings.github.rights')}</dt>
          <dd className="text-ink">{permissionTexts(MANIFEST_PERMISSIONS).join(', ')}</dd>
          <dt className="text-muted">{t('settings.github.webhooks')}</dt>
          <dd className="break-all text-ink" translate="no">
            {`${instanceOrigin()}/github/webhook`}
          </dd>
        </dl>
        <Input
          id="github-organization"
          label={t('settings.github.connect.organization')}
          hint={t('settings.github.connect.organization_hint')}
          name="organization"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          translate="no"
          className="max-w-xs"
          value={owner}
          error={error}
          onChange={(event) => {
            setOwner(event.target.value);
            setError(undefined);
          }}
        />
        <div>
          <Button type="submit" variant="primary" icon={ExternalLink} pending={start.isPending || leaving}>
            {t('settings.github.connect.button')}
          </Button>
        </div>
      </form>
    </Panel>
  );
}

/* ---------------------------------------------------------------------- connected */

function AppRow({ app, installed }: { app: GitHubApp; installed: boolean }) {
  const zone = useOrgZone();
  const facts = [
    `${permissionTexts(app.permissions).join(', ')}.`,
    t(app.events.length > 0 ? 'settings.github.app.webhooks' : 'settings.github.app.no_webhooks'),
    app.created_at ? t('settings.github.app.created', { date: formatDate(app.created_at, zone) }) : null,
  ];
  return (
    <Row className="items-start">
      <div className="min-w-0 flex-1 basis-64">
        <p className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-ink" translate="no">
            {app.name}
          </span>
          {installed && <Badge icon={Check}>{t('settings.github.app.installed')}</Badge>}
        </p>
        <p className="mt-1 text-sm text-pretty text-muted">{facts.filter(Boolean).join(' ')}</p>
      </div>
      <a href={app.html_url} target="_blank" rel="noreferrer" className={externalLink}>
        {t('settings.github.app.at_github')}
        <ExternalLink className="size-3.5" aria-hidden="true" />{' '}
        <span className="sr-only">{t('settings.github.app.opens', { name: app.name })}</span>
      </a>
    </Row>
  );
}

function InstallationRow({ installation }: { installation: GitHubInstallation }) {
  const Icon = installation.account_type === 'Organization' ? Building2 : UserIcon;
  return (
    <Row>
      <div className="flex min-w-0 flex-1 basis-56 items-center gap-2">
        <Icon className="size-4 shrink-0 text-muted" aria-hidden="true" />
        <span className="min-w-0 font-medium break-all text-ink" translate="no">
          {installation.account_login}
        </span>
        <span className="text-sm text-muted">{t(installation.repository_selection === 'all' ? 'settings.github.installation.all' : 'settings.github.installation.selected')}</span>
      </div>
      {installation.removed_at ? (
        <Badge tone="quiet">{t('settings.github.installation.removed')}</Badge>
      ) : installation.suspended_at ? (
        <Badge tone="danger" icon={ShieldAlert}>
          {t('settings.github.installation.suspended')}
        </Badge>
      ) : null}
    </Row>
  );
}

/** Whether a ruleset protects the base branch of the project the repo belongs to; nothing for a repo of no project the person sees. */
function Ruleset({ project }: { project: NonNullable<GitHubRepository['project']> }) {
  if (project.protected === true) return <Badge icon={ShieldCheck}>{t('settings.github.repo.protected', { branch: project.base_branch })}</Badge>;
  if (project.protected === false) {
    return (
      <Badge tone="quiet" icon={ShieldAlert}>
        {t('settings.github.repo.unprotected', { branch: project.base_branch })}
      </Badge>
    );
  }
  return (
    <Badge tone="quiet" icon={Shield}>
      {t('settings.github.repo.ruleset_unknown')}
    </Badge>
  );
}

function RepoRow({ repo }: { repo: GitHubRepository }) {
  return (
    <Row>
      <div className="flex min-w-0 flex-1 basis-56 flex-wrap items-center gap-x-2 gap-y-1">
        <GitBranch className="size-4 shrink-0 text-muted" aria-hidden="true" />
        <span className="min-w-0 font-medium break-all text-ink" translate="no">
          {repo.full_name}
        </span>
        {repo.private && (
          <span className="inline-flex items-center gap-1 text-sm text-muted">
            <Lock className="size-3.5" aria-hidden="true" />
            {t('settings.github.repo.private')}
          </span>
        )}
        {repo.removed_at && <span className="text-sm text-muted">{t('settings.github.repo.removed')}</span>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {repo.project?.guarded && (
          <Badge tone="danger" icon={ShieldAlert}>
            {t('settings.github.repo.guarded')}
          </Badge>
        )}
        {repo.project && <Ruleset project={repo.project} />}
        {repo.project ? (
          <Badge tone="accent">
            <span translate="no">{repo.project.identifier}</span>
          </Badge>
        ) : repo.taken ? (
          <Badge tone="accent">{t('settings.github.repo.other_project')}</Badge>
        ) : (
          <span className="text-sm text-muted">{t('settings.github.repo.no_project')}</span>
        )}
      </div>
    </Row>
  );
}

function Connected({ github, onDisconnect }: { github: GitHubStatus; onDisconnect: (trigger: HTMLElement) => void }) {
  const settle = useSettle();
  const sync = useSyncGitHub();
  const app = github.app!;
  const live = github.installations.filter((installation) => !installation.removed_at);
  const installed = live.some((installation) => !installation.suspended_at);

  function readAgain() {
    settle(sync.mutateAsync(undefined), {
      onSuccess: (next) => {
        const count = next.repositories.filter((repo) => !repo.removed_at).length;
        toast({ title: t('settings.github.sync.done'), description: tn('settings.github.sync.repos', count), tone: 'success' });
      },
      onError: (error) => notifyError(t('settings.github.sync.failed'), error, readAgain),
    });
  }

  return (
    <>
      <Panel title={t('settings.github.app.title')}>
        <Rows label={t('settings.github.app.label')}>
          <AppRow app={app} installed={installed} />
        </Rows>
        <div className="border-t border-line">
          <h4 className="px-4 pt-3 text-sm font-semibold text-muted">{t('settings.github.installation.title')}</h4>
          {github.installations.length === 0 ? (
            <p className="max-w-[65ch] px-4 pt-1 pb-3 text-sm text-pretty text-muted">{t('settings.github.installation.none')}</p>
          ) : (
            <Rows label={t('settings.github.installation.title')}>
              {github.installations.map((installation) => (
                <InstallationRow key={installation.id} installation={installation} />
              ))}
            </Rows>
          )}
        </div>
      </Panel>

      <Panel
        title={t('settings.github.repos.title')}
        description={t('settings.github.repos.description')}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" icon={RefreshCw} pending={sync.isPending} onClick={readAgain}>
              {t('settings.github.sync.button')}
            </Button>
            <a href={INSTALL_PATH} className={buttonClass({ variant: 'secondary' }, 'gap-1.5')}>
              {t('settings.github.repos.change')}
              <ExternalLink className="size-3.5 text-muted" aria-hidden="true" />{' '}
              <span className="sr-only">{t('settings.github.leaves')}</span>
            </a>
          </div>
        }
      >
        {github.repositories.length === 0 ? (
          <p className="max-w-[65ch] px-4 py-3 text-sm text-pretty text-muted">{t('settings.github.repos.none')}</p>
        ) : (
          <Rows label={t('settings.github.repos.label')}>
            {github.repositories.map((repo) => (
              <RepoRow key={repo.id} repo={repo} />
            ))}
          </Rows>
        )}
      </Panel>

      <Banner tone="info" icon={ShieldCheck} title={t('settings.github.ruleset.title')}>
        <Measure>{t('settings.github.ruleset.text')}</Measure>
      </Banner>

      <Panel title={t('settings.github.disconnect.title')} description={t('settings.github.disconnect.description')}>
        <div className="p-4">
          <Button
            variant="secondary"
            icon={Unplug}
            onClick={(event) => onDisconnect(event.currentTarget)}
          >
            {t('settings.github.disconnect.button')}
          </Button>
        </div>
      </Panel>
    </>
  );
}

/**
 * Disconnecting lives here and not in the connected view: that view goes as soon as the status is read anew, before the
 * answer of the call comes back, and what the call says must still reach the person.
 */
export default function GitHub(_props: SectionProps) {
  const github = useGitHub();
  const connected = github.data?.app != null;
  const settle = useSettle();
  const disconnect = useDisconnectGitHub();
  const [asking, setAsking] = useState(false);
  /** Where the focus goes when the question closes: back to „GitHub trennen“, after the disconnect to the page title. */
  const afterDisconnect = useRef<HTMLElement | null>(null);

  function run() {
    settle(disconnect.mutateAsync(undefined), {
      onSuccess: ({ canceled }) => {
        afterDisconnect.current = document.getElementById(GITHUB_TITLE);
        setAsking(false);
        const hint = t('settings.github.disconnect.done_hint');
        toast({ title: t('settings.github.disconnect.done'), description: canceled > 0 ? `${tn('settings.github.disconnect.canceled', canceled)} ${hint}` : hint, tone: 'success' });
        // the view under the title changes: the title keeps the focus when the dialog gave it somewhere that went
        focusWhenLost(() => document.getElementById(GITHUB_TITLE), 2000);
      },
      onError: (error) => notifyError(t('settings.github.disconnect.failed'), error, run),
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <SectionHeader
        titleId={GITHUB_TITLE}
        title={t('settings.org.section.github')}
        description={t('settings.github.description')}
        actions={
          connected ? (
            <Badge tone="accent" icon={Check}>
              {t('settings.github.connected')}
            </Badge>
          ) : undefined
        }
      />
      <Loaded queries={[github]} keepData failure={t('settings.github.load_failed')} skeleton={<FormSkeleton label={t('settings.github.loading')} />}>
        {() =>
          connected ? (
            <Connected
              github={github.data!}
              onDisconnect={(trigger) => {
                afterDisconnect.current = trigger;
                setAsking(true);
              }}
            />
          ) : (
            <Connect />
          )
        }
      </Loaded>
      <AlertDialog
        open={asking}
        onOpenChange={setAsking}
        title={t('settings.github.disconnect.question')}
        description={t('settings.github.disconnect.consequence')}
        confirmLabel={t('settings.github.disconnect.confirm')}
        pending={disconnect.isPending}
        finalFocus={afterDisconnect}
        onConfirm={run}
      />
    </div>
  );
}
