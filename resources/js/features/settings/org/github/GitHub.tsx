/*
 * Settings → GitHub (spec 10.2, 11.3; port of the clickdummy's `Github.tsx`, org admins only), one private app per
 * GitHub account (A680: a private app installs only on the account it belongs to). Without an app: the manifest flow of
 * the first one, for the person's own account or a GitHub organization. The browser posts the manifest to GitHub; GitHub
 * registers the app, comes back to `/github/manifest`, which sends on to the installation on the repos, and after that
 * back here. With apps: each app with its rights, installations and the repos it reaches (with their project and whether
 * a ruleset protects the base branch), "Repos bei GitHub ändern" (`/github/install?app=`, with a state of its own) and
 * "Trennen" (only this app); "Neu einlesen" reads every app, "Weitere App hinzufügen" connects another account. The
 * ruleset is only shown: werkbuch detects an unauthorized merge with or without one. Private key and webhook secret stay
 * on the server and never show.
 */

import { Building2, Check, ExternalLink, GitBranch, Lock, Plus, RefreshCw, Shield, ShieldAlert, ShieldCheck, Unplug, User as UserIcon } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent, type RefObject } from 'react';
import { ApiError } from '@/api/client';
import { AlertDialog } from '@/components/ui/AlertDialog';
import { Banner } from '@/components/ui/Banner';
import { Button, buttonClass } from '@/components/ui/Button';
import { FormDialog } from '@/components/ui/FormDialog';
import { Input } from '@/components/ui/Input';
import { toast } from '@/components/ui/toast';
import { useDisconnectGitHub, useGitHub, useStartGitHubManifest, useSyncGitHub } from '@/hooks/github';
import { useSettle } from '@/hooks/mutation';
import { notifyError } from '@/lib/errors';
import { focusWhenLost } from '@/lib/focusOrigin';
import { t, tn } from '@/lib/i18n';
import { instanceOrigin } from '@/lib/links';
import type { GitHubApp, GitHubInstallation, GitHubOwnerType, GitHubRepository, GitHubStatus } from '@/types';
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

/** GitHub allows 34 characters for the name of an app; the manifest shortens the login of the account before " werkbuch". */
const NAME_MAX = 34;
const SUFFIX = ' werkbuch';

/** The name the manifest proposes for the app of a GitHub account (`App\GitHub\Manifest::for`). */
export const proposedName = (login: string): string => `${[...login].slice(0, NAME_MAX - SUFFIX.length).join('').trim()}${SUFFIX}`;

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

/** The GitHub account an app is registered for (A680: one private app per account). */
interface Account {
  owner: string;
  owner_type: GitHubOwnerType;
}

/**
 * The account to connect and its way to GitHub: the person names the login and whether it is their own account or an
 * organization; werkbuch answers what the browser posts to GitHub, and the page leaves.
 */
function useConnect() {
  const settle = useSettle();
  const start = useStartGitHubManifest();
  const [account, setAccount] = useState<Account>({ owner: '', owner_type: 'Organization' });
  const [errors, setErrors] = useState<{ owner?: string; owner_type?: string }>({});
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

  function edit(change: Partial<Account>) {
    setAccount((current) => ({ ...current, ...change }));
    setErrors({});
  }

  // a second send while it runs never comes: the busy button of the panel takes no press, the dialog sends once
  function connect(prefix: string) {
    const owner = account.owner.trim();
    if (owner === '') {
      setErrors({ owner: t('field.owner.required') });
      document.getElementById(`${prefix}-owner`)?.focus();
      return;
    }
    settle(start.mutateAsync({ owner, owner_type: account.owner_type }), {
      onSuccess: (answer) => {
        setLeaving(true);
        postToGitHub(answer.url, answer.manifest);
      },
      onError: (failure) => {
        // the account has its app already (409): said at the login, as a field of its own
        const taken = failure instanceof ApiError && failure.reason === 'github_connected' ? failure.message : undefined;
        const next = { owner: fieldMessage(failure, 'owner') ?? taken, owner_type: fieldMessage(failure, 'owner_type') };
        if (next.owner || next.owner_type) {
          setErrors(next);
          document.getElementById(next.owner ? `${prefix}-owner` : `${prefix}-type-${account.owner_type}`)?.focus();
        } else notifyError(t('settings.github.connect.failed'), failure, () => connect(prefix));
      },
    });
  }

  return { account, edit, errors, connect, pending: start.isPending || leaving };
}

type Connection = ReturnType<typeof useConnect>;

/** Whose app (own account or organization) and its login; the name the manifest proposes. */
function AccountFields({ prefix, connection }: { prefix: string; connection: Connection }) {
  const { account, edit, errors } = connection;
  const errorId = `${prefix}-type-error`;
  const kinds: { value: GitHubOwnerType; label: string; icon: typeof UserIcon }[] = [
    { value: 'User', label: t('settings.github.connect.user'), icon: UserIcon },
    { value: 'Organization', label: t('settings.github.connect.organization'), icon: Building2 },
  ];
  const owner = account.owner.trim();
  return (
    <div className="flex flex-col gap-3">
      <fieldset className="flex flex-col gap-1.5" aria-describedby={errors.owner_type ? errorId : undefined}>
        <legend className="mb-1.5 text-sm font-medium text-ink">{t('settings.github.connect.owner_type')}</legend>
        <div role="radiogroup" aria-label={t('settings.github.connect.owner_type')} className="flex flex-wrap gap-x-5 gap-y-1">
          {kinds.map(({ value, label, icon: Icon }) => (
            <label key={value} className="flex min-h-11 cursor-pointer items-center gap-2 text-ui text-ink md:min-h-8">
              <input
                id={`${prefix}-type-${value}`}
                type="radio"
                name={`${prefix}-type`}
                value={value}
                checked={account.owner_type === value}
                onChange={() => edit({ owner_type: value })}
                className="size-4 shrink-0 cursor-[inherit] appearance-none rounded-full border border-line-input bg-surface transition-colors duration-120 checked:border-accent checked:[box-shadow:inset_0_0_0_3px_var(--color-surface),inset_0_0_0_8px_var(--color-accent)]"
              />
              <Icon className="size-4 text-muted" aria-hidden="true" />
              {label}
            </label>
          ))}
        </div>
        {errors.owner_type && (
          <p id={errorId} className="text-sm text-danger">
            {errors.owner_type}
          </p>
        )}
      </fieldset>
      <Input
        id={`${prefix}-owner`}
        label={t(account.owner_type === 'User' ? 'settings.github.connect.login_user' : 'settings.github.connect.login_organization')}
        hint={`${t(account.owner_type === 'User' ? 'settings.github.connect.hint_user' : 'settings.github.connect.hint_organization')}${owner ? ` ${t('settings.github.connect.proposed', { name: proposedName(owner) })}` : ''}`}
        name="owner"
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        translate="no"
        className="max-w-xs"
        value={account.owner}
        error={errors.owner}
        onChange={(event) => edit({ owner: event.target.value })}
      />
    </div>
  );
}

/** What an app may do and where GitHub sends its webhooks: the same for every app. */
function AppFacts() {
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm">
      <dt className="text-muted">{t('settings.github.rights')}</dt>
      <dd className="text-ink">{permissionTexts(MANIFEST_PERMISSIONS).join(', ')}</dd>
      <dt className="text-muted">{t('settings.github.webhooks')}</dt>
      <dd className="break-all text-ink" translate="no">
        {`${instanceOrigin()}/github/webhook`}
      </dd>
    </dl>
  );
}

/** No app yet: the first account, in the page. */
function Connect() {
  const connection = useConnect();
  return (
    <Panel title={t('settings.github.connect.title')} description={t('settings.github.connect.description')}>
      <form
        noValidate
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          connection.connect('github-connect');
        }}
        className="flex flex-col gap-3 p-4"
      >
        <p className="max-w-[65ch] text-ui text-pretty text-ink">{t('settings.github.connect.what')}</p>
        <AppFacts />
        <AccountFields prefix="github-connect" connection={connection} />
        <div>
          <Button type="submit" variant="primary" icon={ExternalLink} pending={connection.pending}>
            {t('settings.github.connect.button')}
          </Button>
        </div>
      </form>
    </Panel>
  );
}

/** One app more, for another GitHub account: the same way to GitHub in a dialog. */
function AddAppDialog({ open, onOpenChange, finalFocus }: { open: boolean; onOpenChange: (open: boolean) => void; finalFocus: RefObject<HTMLElement | null> }) {
  const connection = useConnect();
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('settings.github.add.title')}
      description={t('settings.github.add.description')}
      submitLabel={t('settings.github.add.submit')}
      pending={connection.pending}
      finalFocus={finalFocus}
      onSubmit={() => connection.connect('github-add')}
    >
      <AppFacts />
      <AccountFields prefix="github-add" connection={connection} />
    </FormDialog>
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

/** One app: what it may do, where it is installed, the repos it reaches, and the ways to change them or let it go. */
function AppPanel({ app, repos, onDisconnect }: { app: GitHubApp; repos: GitHubRepository[]; onDisconnect: (app: GitHubApp, trigger: HTMLElement) => void }) {
  const live = app.installations.filter((installation) => !installation.removed_at);
  const installed = live.some((installation) => !installation.suspended_at);
  const login = app.owner_login;
  return (
    <Panel
      title={t('settings.github.app.title', { login })}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <a href={`${INSTALL_PATH}?app=${encodeURIComponent(app.id)}`} className={buttonClass({ variant: 'secondary' }, 'gap-1.5')}>
            {t('settings.github.repos.change')}
            <ExternalLink className="size-3.5 text-muted" aria-hidden="true" />{' '}
            <span className="sr-only">{t('settings.github.leaves_for', { login })}</span>
          </a>
          <Button variant="secondary" icon={Unplug} onClick={(event) => onDisconnect(app, event.currentTarget)}>
            {t('settings.github.disconnect.title')}{' '}
            <span className="sr-only">{t('settings.github.app.for', { login })}</span>
          </Button>
        </div>
      }
    >
      <Rows label={t('settings.github.app.label', { login })}>
        <AppRow app={app} installed={installed} />
      </Rows>
      <div className="border-t border-line">
        <h4 className="px-4 pt-3 text-sm font-semibold text-muted">{t('settings.github.installation.title')}</h4>
        {app.installations.length === 0 ? (
          <p className="max-w-[65ch] px-4 pt-1 pb-3 text-sm text-pretty text-muted">{t('settings.github.installation.none')}</p>
        ) : (
          <Rows label={t('settings.github.installation.label', { login })}>
            {app.installations.map((installation) => (
              <InstallationRow key={installation.id} installation={installation} />
            ))}
          </Rows>
        )}
      </div>
      <div className="border-t border-line">
        <h4 className="px-4 pt-3 text-sm font-semibold text-muted">{t('settings.github.repos.title')}</h4>
        {repos.length === 0 ? (
          <p className="max-w-[65ch] px-4 pt-1 pb-3 text-sm text-pretty text-muted">{t('settings.github.repos.none')}</p>
        ) : (
          <Rows label={t('settings.github.repos.label', { login })}>
            {repos.map((repo) => (
              <RepoRow key={repo.id} repo={repo} />
            ))}
          </Rows>
        )}
      </div>
    </Panel>
  );
}

/** The repos of each app: a repo belongs to the app whose installation reaches it. */
export function reposByApp(github: GitHubStatus): Map<string, GitHubRepository[]> {
  const appOf = new Map(github.apps.flatMap((app) => app.installations.map((installation) => [installation.id, app.id] as const)));
  const byApp = new Map<string, GitHubRepository[]>(github.apps.map((app) => [app.id, []]));
  for (const repo of github.repositories) byApp.get(appOf.get(repo.installation_id) ?? '')?.push(repo);
  return byApp;
}

/**
 * Settings → GitHub. Disconnecting lives here and not in a panel of an app: the panel goes as soon as the status is
 * read anew, before the answer of the call comes back, and what the call says must still reach the person.
 */
export default function GitHub(_props: SectionProps) {
  const github = useGitHub();
  const connected = (github.data?.apps.length ?? 0) > 0;
  const settle = useSettle();
  const sync = useSyncGitHub();
  const disconnect = useDisconnectGitHub();
  const [leaving, setLeaving] = useState<GitHubApp | null>(null);
  const [asking, setAsking] = useState(false);
  const [adding, setAdding] = useState(false);
  // every opening of the dialog starts empty: a new round mounts a fresh form
  const [round, setRound] = useState(0);
  /** Where the focus goes when the question closes: back to „Trennen“, after the disconnect to the page title. */
  const afterDisconnect = useRef<HTMLElement | null>(null);
  const addButton = useRef<HTMLButtonElement | null>(null);

  function readAgain() {
    settle(sync.mutateAsync(undefined), {
      onSuccess: (next) => {
        const count = next.repositories.filter((repo) => !repo.removed_at).length;
        toast({ title: t('settings.github.sync.done'), description: tn('settings.github.sync.repos', count), tone: 'success' });
      },
      onError: (error) => notifyError(t('settings.github.sync.failed'), error, readAgain),
    });
  }

  function run(app: GitHubApp) {
    settle(disconnect.mutateAsync(app.id), {
      onSuccess: ({ canceled }) => {
        afterDisconnect.current = document.getElementById(GITHUB_TITLE);
        setAsking(false);
        const hint = t('settings.github.disconnect.done_hint');
        toast({
          title: t('settings.github.disconnect.done', { login: app.owner_login }),
          description: canceled > 0 ? `${tn('settings.github.disconnect.canceled', canceled)} ${hint}` : hint,
          tone: 'success',
        });
        // the panel of the app goes: the title keeps the focus when the dialog gave it somewhere that went
        focusWhenLost(() => document.getElementById(GITHUB_TITLE), 2000);
      },
      onError: (error) => notifyError(t('settings.github.disconnect.failed'), error, () => run(app)),
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
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="secondary" icon={RefreshCw} pending={sync.isPending} onClick={readAgain}>
                {t('settings.github.sync.button')}
              </Button>
              <Button
                ref={addButton}
                variant="secondary"
                icon={Plus}
                onClick={() => {
                  setRound((current) => current + 1);
                  setAdding(true);
                }}
              >
                {t('settings.github.add.button')}
              </Button>
            </div>
          ) : undefined
        }
      />
      <Loaded queries={[github]} keepData failure={t('settings.github.load_failed')} skeleton={<FormSkeleton label={t('settings.github.loading')} />}>
        {() => {
          if (!connected) return <Connect />;
          const repos = reposByApp(github.data!);
          return (
            <>
              <p className="max-w-[65ch] text-sm text-pretty text-muted">{t('settings.github.repos.description')}</p>
              {github.data!.apps.map((app) => (
                <AppPanel
                  key={app.id}
                  app={app}
                  repos={repos.get(app.id) ?? []}
                  onDisconnect={(chosen, trigger) => {
                    afterDisconnect.current = trigger;
                    setLeaving(chosen);
                    setAsking(true);
                  }}
                />
              ))}
              <Banner tone="info" icon={ShieldCheck} title={t('settings.github.ruleset.title')}>
                <Measure>{t('settings.github.ruleset.text')}</Measure>
              </Banner>
            </>
          );
        }}
      </Loaded>
      <AddAppDialog key={round} open={adding} onOpenChange={setAdding} finalFocus={addButton} />
      <AlertDialog
        open={asking}
        onOpenChange={setAsking}
        title={t('settings.github.disconnect.question', { login: leaving?.owner_login ?? '' })}
        description={t('settings.github.disconnect.consequence')}
        confirmLabel={t('settings.github.disconnect.confirm')}
        pending={disconnect.isPending}
        finalFocus={afterDisconnect}
        // the question opens only with an app to leave
        onConfirm={() => run(leaving!)}
      />
    </div>
  );
}
