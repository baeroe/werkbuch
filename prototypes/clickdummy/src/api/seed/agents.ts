/*
 * Seed of the runner and the agents (WEBU-18, spec `2026-11-23-runner-design.md`): three runners, the GitHub apps,
 * Kira as the one agent, the agent settings of WEB (APP and OPS have none: agents are off there), and the runs, strands
 * and PRs of a handful of WEB items, so every state of the item detail can be seen:
 *
 *   WEB-51  Kira works on it right now (a `task` on mac-studio; its log grows during the first minutes after loading)
 *   WEB-44  PR #214 open, the review found something, the correction waits for mac-mini-alt, which is offline
 *   WEB-53  the task ran into its time limit: failed, "Erneut starten"
 *   WEB-49  the brake: three corrections and a conflict, the strand is paused, the item is back with Mara
 *   WEB-47  two PRs of Jonas: one closed, one open with CI still running
 *   WEB-42  a draft PR of Ida, and a question to @kira that a `comment` run answered
 *   WEB-40  Lene's PR, reviewed and approved by Kira, merged
 *   OPS-15  assigned to Kira, but OPS has no agent settings: a plain assignment, and the detail says why
 *
 * "Now" is 2026-10-28 10:00 when the page loads. Everything is made up: hosts, repos, commits and logins.
 */

import { DEFAULT_RULES } from '@/domain/agentRuleDefaults';
import { RUN_TIMEOUTS } from '@/domain/agents';
import type { AgentConfig, AgentRun, AgentThread, Comment, GithubConnection, ItemEvent, ProjectAgents, PullRequestLink, RunLogLine, RunnerCli, RunnerEquipment, RunnerLoad, RunnerSlots, RunType } from '@/types';
import { comment, event, state } from './activity';
import { at, doc, p, ul } from './helpers';
import { itemId } from './items';

/** A runner as stored: `last_seen_at` only matters while it is offline; online ones call in all the time. */
export interface StoredRunner {
  id: string;
  name: string;
  os: 'darwin' | 'linux';
  arch: 'arm64' | 'amd64';
  version: string;
  online: boolean;
  last_seen_at: string;
  slots: RunnerSlots;
  /** The last load the runner sent; `measured_at` follows its last contact. */
  load: Omit<RunnerLoad, 'measured_at'>;
  /** What the harness offers, as the runner reports it (spec 8.7). */
  equipment: RunnerEquipment;
  /** The CLIs it found, installed and logged in (spec 8.8). */
  clis: RunnerCli[];
  update_error: string | null;
  created_at: string;
}

/** A pairing code as stored. */
export interface StoredPairing {
  code: string;
  expires_at: string;
  runner_id: string | null;
  created_by: string;
}

/** A run as stored: its whole log, of which the API gives out the lines up to now. */
export type StoredRun = Omit<AgentRun, 'runner_name' | 'runner_online' | 'runner_last_seen_at' | 'waiting_reason'> & { cancel_requested_at: string | null };

export const RUNNER_VERSION = '0.1.0-dev';

export const runners: StoredRunner[] = [
  {
    id: 'rn_studio',
    name: 'mac-studio',
    os: 'darwin',
    arch: 'arm64',
    version: RUNNER_VERSION,
    online: true,
    last_seen_at: at('10-28 09:59'),
    slots: { total: 2, per_repo: 1, light: 2 },
    load: { cpu: 31, gpu: 12, ram_used: 38.2, ram_total: 64, disk_free: 182, disk_total: 994 },
    // set up on the machine for the runner's own macOS user
    equipment: {
      mcp_servers: ['playwright', 'context7'],
      skills: [
        'superpowers:test-driven-development',
        'superpowers:systematic-debugging',
        'superpowers:verification-before-completion',
        'design:web-design-guidelines',
        'laravel:pest-testing',
        'react:accessibility',
      ],
      plugins: ['superpowers'],
      werkbuch_access: [],
    },
    clis: [
      { cli: 'claude', installed: true, version: '2.4.1', logged_in: true },
      { cli: 'codex', installed: false, version: null, logged_in: false },
    ],
    update_error: null,
    created_at: at('10-20 16:40'),
  },
  {
    id: 'rn_mini',
    name: 'mac-mini-alt',
    os: 'darwin',
    arch: 'amd64',
    version: RUNNER_VERSION,
    online: false,
    last_seen_at: at('10-28 09:41'),
    slots: { total: 1, per_repo: 1, light: 1 },
    // an Intel Mac: no GPU load without root
    load: { cpu: 6, gpu: null, ram_used: 9.1, ram_total: 16, disk_free: 61, disk_total: 256 },
    // nothing set up on the old Mac yet
    equipment: { mcp_servers: [], skills: [], plugins: [], werkbuch_access: [] },
    clis: [
      { cli: 'claude', installed: true, version: '2.3.0', logged_in: true },
      { cli: 'codex', installed: false, version: null, logged_in: false },
    ],
    update_error: null,
    created_at: at('10-22 10:15'),
  },
  {
    id: 'rn_build',
    name: 'build-01',
    os: 'linux',
    arch: 'amd64',
    version: '0.1.0-alpha',
    online: true,
    last_seen_at: at('10-28 09:59'),
    slots: { total: 4, per_repo: 1, light: 2 },
    load: { cpu: 7, gpu: null, ram_used: 5.8, ram_total: 32, disk_free: 410, disk_total: 500 },
    // runs under the admin's own user: her werkbuch server with a personal token comes along
    equipment: { mcp_servers: ['werkbuch-mara', 'context7'], skills: ['ops:runbook'], plugins: [], werkbuch_access: ['werkbuch-mara'] },
    // Codex is installed, but nobody ran codex login: Otto's runs wait (spec 8.8)
    clis: [
      { cli: 'claude', installed: true, version: '2.4.1', logged_in: true },
      { cli: 'codex', installed: true, version: '0.40.0', logged_in: false },
    ],
    update_error: 'Die Prüfsumme des neuen Binarys stimmt nicht. Der Runner läuft mit 0.1.0-alpha weiter und versucht es beim nächsten Kontakt erneut.',
    created_at: at('10-12 11:00'),
  },
];

export const agentConfigs: AgentConfig[] = [
  {
    bot_id: 'u_kira',
    enabled: true,
    runner_ids: ['rn_studio', 'rn_mini'],
    cli: 'claude',
    model: 'sonnet',
    models: { review: 'opus' },
    instruction: 'Schreib Commits und PR-Texte auf Englisch, Kommentare an Personen auf Deutsch. Frag lieber in einem Kommentar nach, als zu raten.',
  },
  // Otto works with Codex, which no runner of his pool has logged in: his run on WEB-55 waits (spec 8.8)
  {
    bot_id: 'u_otto',
    enabled: true,
    runner_ids: ['rn_studio', 'rn_build'],
    cli: 'codex',
    model: 'gpt-5-codex',
    models: {},
    instruction: 'Kleine, klar umrissene Aufgaben. Frag in einem Kommentar nach, wenn etwas unklar ist.',
  },
];

const NO_RULES: Record<RunType, string | null> = { task: null, correction: null, conflict: null, review: null, comment: null };

export const projectAgents: ProjectAgents[] = [
  {
    project_id: 'p_web',
    repo: 'feldwerk/website',
    base_branch: 'main',
    merge_method: 'squash',
    // a DDEV project per worktree, so two worktrees of the website do not share one (spec 8.4)
    setup_command: 'ddev config --project-name=web-$WORKTREE && ddev start',
    teardown_command: 'ddev delete -Oy web-$WORKTREE',
    review_bot_id: 'u_kira',
    max_corrections: 3,
    max_conflicts: 2,
    review_human_prs: true,
    comment_on_pr: true,
    models: { comment: 'haiku' },
    // WEB reviews with a focus of its own; the other kinds use the standard
    rules: {
      ...NO_RULES,
      review: `${DEFAULT_RULES.review}\n- Prüfe Kontraste und Fokus nach \`DESIGN.md\`, hell und dunkel.\n- Neue Texte auf der Website: Tippfehler und Duzen/Siezen (wir siezen).`,
    },
  },
];

export const github: GithubConnection = {
  agent_app: {
    name: 'Feldwerk werkbuch',
    slug: 'feldwerk-werkbuch',
    permissions: ['Inhalte schreiben', 'Pull Requests schreiben', 'Checks lesen', 'Actions lesen', 'Metadaten lesen'],
    webhooks: true,
    installed: true,
    created_at: at('10-20 16:05'),
  },
  review_app: {
    name: 'Feldwerk werkbuch review',
    slug: 'feldwerk-werkbuch-review',
    permissions: ['Pull Requests schreiben', 'Inhalte lesen', 'Metadaten lesen'],
    webhooks: false,
    installed: true,
    created_at: at('10-20 16:09'),
  },
  repos: [
    { full_name: 'feldwerk/website', private: true, default_branch: 'main', agent_app: true, review_app: true },
    { full_name: 'feldwerk/kunden-app', private: true, default_branch: 'main', agent_app: true, review_app: true },
    { full_name: 'feldwerk/infrastruktur', private: true, default_branch: 'main', agent_app: true, review_app: true },
    { full_name: 'feldwerk/design-tokens', private: false, default_branch: 'main', agent_app: true, review_app: false },
  ],
};

/* ---------------------------------------------------------------------------- strands */

export const agentThreads: AgentThread[] = [
  { id: 'th_web51', item_id: itemId('WEB-51'), bot_id: 'u_kira', runner_id: 'rn_studio', branch: 'agent/WEB-51-cookie-banner-consent-v2', status: 'open', corrections: 0, conflicts: 0, pr_number: null },
  { id: 'th_web44', item_id: itemId('WEB-44'), bot_id: 'u_kira', runner_id: 'rn_mini', branch: 'agent/WEB-44-alt-texte', status: 'open', corrections: 1, conflicts: 0, pr_number: 214 },
  { id: 'th_web53', item_id: itemId('WEB-53'), bot_id: 'u_kira', runner_id: 'rn_studio', branch: 'agent/WEB-53-robots-sitemap', status: 'open', corrections: 0, conflicts: 0, pr_number: null },
  { id: 'th_web54', item_id: itemId('WEB-54'), bot_id: 'u_kira', runner_id: 'rn_mini', branch: 'agent/WEB-54-browser-test-formulare', status: 'open', corrections: 0, conflicts: 0, pr_number: null },
  { id: 'th_web55', item_id: itemId('WEB-55'), bot_id: 'u_otto', runner_id: '', branch: 'agent/WEB-55-bildformate-avif', status: 'open', corrections: 0, conflicts: 0, pr_number: null },
  { id: 'th_web49', item_id: itemId('WEB-49'), bot_id: 'u_kira', runner_id: 'rn_studio', branch: 'agent/WEB-49-layout-vorlage', status: 'paused', corrections: 3, conflicts: 1, pr_number: 209 },
];

/* ------------------------------------------------------------------------------- runs */

const line = (offset: number, kind: RunLogLine['kind'], text: string): RunLogLine => ({ offset, kind, text });

/** What a run of each kind writes, for runs started in the demo (assigned, retried); `{key}` is the item. */
export const LOG_TEMPLATES: Record<RunType, RunLogLine[]> = {
  // the story of a task in general; an item may have one of its own (TASK_LOGS)
  task: [
    line(0, 'system', 'Worktree {branch} angelegt, Setup-Befehl des Projekts gelaufen'),
    line(2, 'system', 'Claude Code gestartet, Modell {model}'),
    line(5, 'tool', 'werkbuch_work-items get {key}'),
    line(9, 'text', 'Ich lese „{title}“ und die verknüpften Seiten, dann suche ich die betroffenen Dateien.'),
    line(16, 'tool', 'Grep "{word}" resources tests'),
    line(27, 'text', 'Ich schreibe zuerst einen Test, der zeigt, was fehlt.'),
    line(41, 'tool', 'Bash ddev artisan test --filter={test}'),
    line(54, 'result', '1 failed'),
    line(66, 'text', 'Der Test zeigt das Ziel. Jetzt die Änderung selbst.'),
    line(95, 'tool', 'Bash ddev artisan test --filter={test}'),
    line(107, 'result', '1 passed'),
    line(115, 'text', 'Der Test ist grün. Jetzt der Rest des Tickets und die Suite.'),
  ],
  correction: [
    line(0, 'system', 'Worktree {branch} wieder aufgenommen, Session fortgesetzt'),
    line(3, 'tool', 'werkbuch_comments list {key}'),
    line(8, 'text', 'Ich arbeite die Befunde des Reviews der Reihe nach ab.'),
  ],
  conflict: [
    line(0, 'system', 'Worktree {branch} wieder aufgenommen'),
    line(2, 'tool', 'Bash git merge origin/main'),
    line(6, 'result', 'CONFLICT (content): Merge conflict in resources/css/app.css'),
  ],
  review: [
    line(0, 'system', 'Frische Session, nur lesen'),
    line(2, 'tool', 'Bash gh pr diff'),
    line(9, 'text', 'Ich prüfe den PR gegen das Ziel des Tickets.'),
  ],
  comment: [
    line(0, 'system', 'Frische Session, nur lesen'),
    line(2, 'tool', 'werkbuch_pages search'),
  ],
};

/** The story of a task at an item that has one: WEB-50, the 404 page of the flow in the README. */
export const TASK_LOGS: Record<string, RunLogLine[]> = {
  'WEB-50': [
    line(0, 'system', 'Worktree {branch} angelegt, Setup-Befehl des Projekts gelaufen'),
    line(2, 'system', 'Claude Code gestartet, Modell {model}'),
    line(5, 'tool', 'werkbuch_work-items get {key}'),
    line(9, 'text', 'Ich lese das Item und die verknüpften Seiten, dann suche ich die betroffenen Dateien.'),
    line(14, 'tool', 'Grep "404" resources/views'),
    line(21, 'tool', 'Read resources/views/errors/404.blade.php'),
    line(30, 'text', 'Die Fehlerseite nutzt noch das alte Layout. Ich schreibe zuerst einen Test für die neue Seite.'),
    line(42, 'tool', 'Edit tests/Feature/ErrorPageTest.php'),
    line(58, 'tool', 'Bash ddev artisan test --filter=ErrorPageTest'),
    line(71, 'result', '1 failed: erwartet die Überschrift „Diese Seite gibt es nicht“'),
    line(80, 'tool', 'Edit resources/views/errors/404.blade.php'),
    line(96, 'tool', 'Bash ddev artisan test --filter=ErrorPageTest'),
    line(108, 'result', '1 passed'),
    line(115, 'text', 'Der Test ist grün. Jetzt noch das Bild für Mobilgeräte und die Links auf Startseite und Suche.'),
  ],
};

interface RunSeed {
  id: string;
  type: RunType;
  status: AgentRun['status'];
  key: string;
  thread: string | null;
  runner: string | null;
  model: string;
  source: AgentRun['model_source'];
  label?: string;
  attempt?: number;
  /** Kira unless a run says otherwise. */
  bot?: string;
  created: string;
  started: string | null;
  finished: string | null;
  result?: AgentRun['result'];
  error?: string;
  usage?: AgentRun['usage'];
  log?: RunLogLine[];
}

function run(seed: RunSeed): StoredRun {
  return {
    id: seed.id,
    type: seed.type,
    status: seed.status,
    bot_id: seed.bot ?? 'u_kira',
    runner_id: seed.runner,
    item_id: itemId(seed.key),
    thread_id: seed.thread,
    model: seed.model,
    model_source: seed.source,
    model_label_id: seed.label ?? null,
    attempt: seed.attempt ?? 1,
    created_at: at(seed.created),
    started_at: seed.started ? at(seed.started) : null,
    finished_at: seed.finished ? at(seed.finished) : null,
    result: seed.result ?? null,
    error: seed.error ?? null,
    usage: seed.usage ?? null,
    log: seed.log ?? [],
    canceled_by: null,
    cancel_requested_at: null,
  };
}

/** The log of WEB-51's running task: streams in during the first seven minutes after the page loads (10:00). */
const web51Log: RunLogLine[] = [
  line(0, 'system', 'Worktree agent/WEB-51-cookie-banner-consent-v2 angelegt, Setup-Befehl des Projekts gelaufen'),
  line(4, 'system', 'Claude Code 2.4.1 gestartet, Modell sonnet, Session 4f2c9e1a'),
  line(9, 'tool', 'werkbuch_work-items get WEB-51'),
  line(15, 'text', 'Das Banner soll auf Consent v2 umgestellt werden. Ich suche, wo das Banner heute eingebunden ist.'),
  line(23, 'tool', 'Grep "cookie" resources/js'),
  line(31, 'tool', 'Read resources/js/consent/banner.ts'),
  line(44, 'text', 'Das Banner setzt nur ein Cookie „consent=1“. Consent v2 braucht die vier Signale ad_storage, analytics_storage, ad_user_data und ad_personalization.'),
  line(70, 'tool', 'Read tests/js/consent.test.ts'),
  line(96, 'text', 'Ich schreibe zuerst Tests für die vier Signale: Standard abgelehnt, nach Zustimmung erteilt.'),
  line(120, 'tool', 'Edit tests/js/consent.test.ts'),
  line(158, 'tool', 'Bash pnpm vitest run tests/js/consent.test.ts'),
  line(171, 'result', '3 failed, 2 passed'),
  line(205, 'tool', 'Edit resources/js/consent/banner.ts'),
  line(248, 'tool', 'Edit resources/js/consent/signals.ts'),
  line(276, 'tool', 'Bash pnpm vitest run tests/js/consent.test.ts'),
  line(289, 'result', '5 passed'),
  line(310, 'text', 'Die Signale stimmen. Jetzt prüfe ich das Banner im Browser, hell und dunkel, und mache das Bild für den Nachweis.'),
  line(352, 'tool', 'playwright browser_navigate https://feldwerk-website.ddev.site'),
  line(399, 'tool', 'playwright browser_take_screenshot banner-light.png'),
  line(431, 'tool', 'Bash ddev artisan test --filter=Consent'),
];

export const agentRuns: StoredRun[] = [
  // WEB-55: Otto's task waits, no runner of his pool has Codex logged in
  run({ id: 'run_web55_task', type: 'task', status: 'waiting', key: 'WEB-55', thread: 'th_web55', runner: null, bot: 'u_otto', model: 'gpt-5-codex', source: 'bot', created: '10-28 09:40', started: null, finished: null }),

  // WEB-51: running now
  run({ id: 'run_web51_task', type: 'task', status: 'running', key: 'WEB-51', thread: 'th_web51', runner: 'rn_studio', model: 'sonnet', source: 'bot', created: '10-28 09:55', started: '10-28 09:56', finished: null, log: web51Log }),

  // WEB-44: task, review with findings, the correction waits for its runner
  run({
    id: 'run_web44_task',
    type: 'task',
    status: 'succeeded',
    key: 'WEB-44',
    thread: 'th_web44',
    runner: 'rn_mini',
    model: 'opus',
    source: 'label',
    label: 'lb_agent_opus',
    created: '10-28 08:51',
    started: '10-28 08:52',
    finished: '10-28 09:21',
    result: { commit: 'a41c9e2', summary: 'Alt-Texte für 23 Bilder der Startseite und der Leistungsseiten ergänzt, dazu ein Test, der leere Alt-Attribute findet. PR #214 geöffnet.' },
    usage: { input: 412_300, output: 18_900 },
    log: [
      line(0, 'system', 'Worktree agent/WEB-44-alt-texte angelegt, Setup-Befehl des Projekts gelaufen'),
      line(3, 'system', 'Claude Code 2.4.1 gestartet, Modell opus, Session 7b01d3c2'),
      line(8, 'tool', 'werkbuch_work-items get WEB-44'),
      line(140, 'tool', 'Bash ddev artisan test --filter=AltTextTest'),
      line(152, 'result', '4 passed'),
      line(1720, 'tool', 'Bash gh pr create --title "WEB-44: Add alt texts" --body "Fixes WEB-44 …"'),
      line(1738, 'result', 'https://github.com/feldwerk/website/pull/214'),
    ],
  }),
  run({
    id: 'run_web44_review',
    type: 'review',
    status: 'succeeded',
    key: 'WEB-44',
    thread: 'th_web44',
    runner: 'rn_studio',
    model: 'opus',
    source: 'label',
    label: 'lb_agent_opus',
    created: '10-28 09:37',
    started: '10-28 09:38',
    finished: '10-28 09:49',
    result: { verdict: 'changes', summary: '2 Befunde: Dekorative Icons brauchen alt="" statt eines Textes; der Test prüft nur die Startseite.' },
    usage: { input: 96_400, output: 4_100 },
    log: [
      line(0, 'system', 'Frische Session, nur lesen, Head-Commit a41c9e2'),
      line(4, 'tool', 'Bash gh pr diff 214'),
      line(380, 'text', 'Zwei Befunde, einer davon Important. Urteil: changes.'),
    ],
  }),
  run({ id: 'run_web44_correction', type: 'correction', status: 'waiting', key: 'WEB-44', thread: 'th_web44', runner: 'rn_mini', model: 'opus', source: 'label', label: 'lb_agent_opus', created: '10-28 09:50', started: null, finished: null }),

  // WEB-54: on mac-mini-alt the setup command of the project failed (Docker is not running): no Claude Code, no change
  run({
    id: 'run_web54_task',
    type: 'task',
    status: 'failed',
    key: 'WEB-54',
    thread: 'th_web54',
    runner: 'rn_mini',
    model: 'sonnet',
    source: 'bot',
    created: '10-28 09:34',
    started: '10-28 09:35',
    finished: '10-28 09:35',
    error: 'Der Setup-Befehl des Projekts ist gescheitert: ddev braucht Docker, und Colima läuft auf mac-mini-alt nicht. Der Auftrag ist gescheitert, bevor Claude Code startete; nichts wurde geändert.',
    log: [
      line(0, 'system', 'Worktree agent/WEB-54-browser-test-formulare angelegt'),
      line(1, 'tool', 'Setup: ddev config --project-name=web-WEB-54 && ddev start'),
      line(4, 'error', 'Could not connect to a docker provider. Please start or install a docker provider.'),
    ],
  }),

  // WEB-53: the first attempt got lost (the Mac lost its network), the second ran into the time limit
  run({
    id: 'run_web53_lost',
    type: 'task',
    status: 'lost',
    key: 'WEB-53',
    thread: 'th_web53',
    runner: 'rn_studio',
    model: 'haiku',
    source: 'label',
    label: 'lb_agent_haiku',
    created: '10-28 08:04',
    started: '10-28 08:05',
    finished: '10-28 08:09',
    error: 'Kein Heartbeat mehr seit 08:07. werkbuch hat den Auftrag neu eingereiht.',
    log: [line(0, 'system', 'Worktree agent/WEB-53-robots-sitemap angelegt'), line(3, 'system', 'Claude Code 2.4.1 gestartet, Modell haiku, Session 1e88a04f')],
  }),
  run({
    id: 'run_web53_task',
    type: 'task',
    status: 'timed_out',
    key: 'WEB-53',
    thread: 'th_web53',
    runner: 'rn_studio',
    model: 'haiku',
    source: 'label',
    label: 'lb_agent_haiku',
    attempt: 2,
    created: '10-28 08:09',
    started: '10-28 08:10',
    finished: '10-28 09:10',
    error: `Zeitlimit von ${RUN_TIMEOUTS.task} Minuten erreicht. Der Agent hat noch nichts gepusht; Worktree und Session bleiben erhalten.`,
    usage: { input: 880_100, output: 31_700 },
    log: [
      line(0, 'system', 'Worktree agent/WEB-53-robots-sitemap wieder aufgenommen'),
      line(3, 'system', 'Claude Code 2.4.1 gestartet, Modell haiku, Session 1e88a04f fortgesetzt'),
      line(9, 'tool', 'werkbuch_work-items get WEB-53'),
      line(31, 'text', 'Die Sitemap soll aus den Seiten erzeugt werden. Ich suche den Router der Seiten.'),
      line(950, 'tool', 'Bash ddev artisan test --filter=SitemapTest'),
      line(968, 'result', '2 failed: Route [sitemap] not defined'),
      line(2400, 'tool', 'Bash ddev artisan test --filter=SitemapTest'),
      line(2418, 'result', '2 failed: Route [sitemap] not defined'),
      line(RUN_TIMEOUTS.task * 60, 'error', `Zeitlimit erreicht (${RUN_TIMEOUTS.task} Minuten). Der Runner hat Claude Code beendet (SIGTERM).`),
    ],
  }),

  // WEB-49: three corrections and a conflict, then the brake
  run({
    id: 'run_web49_task',
    type: 'task',
    status: 'succeeded',
    key: 'WEB-49',
    thread: 'th_web49',
    runner: 'rn_studio',
    model: 'sonnet',
    source: 'bot',
    created: '10-27 09:09',
    started: '10-27 09:10',
    finished: '10-27 09:48',
    result: { commit: '5d2e810', summary: 'Layout-Vorlage für die Leistungsseiten mit Raster, Teasern und Kontaktblock. PR #209 geöffnet.' },
  }),
  run({ id: 'run_web49_review1', type: 'review', status: 'succeeded', key: 'WEB-49', thread: 'th_web49', runner: 'rn_studio', model: 'opus', source: 'bot', created: '10-27 10:04', started: '10-27 10:05', finished: '10-27 10:16', result: { verdict: 'changes', summary: '1 Befund: Das Raster bricht unter 390 px.' } }),
  run({ id: 'run_web49_corr1', type: 'correction', status: 'succeeded', key: 'WEB-49', thread: 'th_web49', runner: 'rn_studio', model: 'sonnet', source: 'bot', created: '10-27 10:17', started: '10-27 10:20', finished: '10-27 10:41', result: { commit: '9a07bc1', summary: 'Raster unter 390 px einspaltig.' } }),
  run({ id: 'run_web49_corr2', type: 'correction', status: 'succeeded', key: 'WEB-49', thread: 'th_web49', runner: 'rn_studio', model: 'sonnet', source: 'bot', created: '10-27 10:58', started: '10-27 11:00', finished: '10-27 11:18', result: { commit: 'e3f4410', summary: 'CI rot: Snapshot der Leistungsseite angepasst.' } }),
  run({ id: 'run_web49_review2', type: 'review', status: 'canceled', key: 'WEB-49', thread: 'th_web49', runner: 'rn_studio', model: 'opus', source: 'bot', created: '10-27 11:31', started: '10-27 11:32', finished: '10-27 11:35', error: 'main ist weitergezogen, der PR hat jetzt einen Konflikt: werkbuch hat das Review abgebrochen. Erst wird der Konflikt gelöst, dann laufen CI und Review neu.' }),
  run({ id: 'run_web49_conflict', type: 'conflict', status: 'succeeded', key: 'WEB-49', thread: 'th_web49', runner: 'rn_studio', model: 'sonnet', source: 'bot', created: '10-27 11:36', started: '10-27 11:40', finished: '10-27 11:52', result: { commit: '71c0d95', summary: 'main hineingemergt, Konflikt in resources/css/app.css gelöst.' } }),
  run({ id: 'run_web49_review3', type: 'review', status: 'succeeded', key: 'WEB-49', thread: 'th_web49', runner: 'rn_studio', model: 'opus', source: 'bot', created: '10-27 12:04', started: '10-27 12:05', finished: '10-27 12:16', result: { verdict: 'changes', summary: '1 Befund: Der Kontaktblock hat keinen sichtbaren Fokus.' } }),
  run({ id: 'run_web49_corr3', type: 'correction', status: 'succeeded', key: 'WEB-49', thread: 'th_web49', runner: 'rn_studio', model: 'sonnet', source: 'bot', created: '10-27 12:17', started: '10-27 12:20', finished: '10-27 12:46', result: { commit: 'b88e2f3', summary: 'Fokusring am Kontaktblock ergänzt.' } }),

  // WEB-42: Ida asked @kira, a comment run answered
  run({
    id: 'run_web42_comment',
    type: 'comment',
    status: 'succeeded',
    key: 'WEB-42',
    thread: null,
    runner: 'rn_studio',
    model: 'haiku',
    source: 'project',
    created: '10-28 09:31',
    started: '10-28 09:31',
    finished: '10-28 09:33',
    result: { summary: 'Antwort als Kommentar gepostet.' },
    usage: { input: 38_200, output: 900 },
    log: [line(0, 'system', 'Frische Session, nur lesen'), line(3, 'tool', 'werkbuch_pages get „Bildgrößen“'), line(11, 'tool', 'Read resources/views/partials/hero.blade.php'), line(70, 'result', 'Antwort an werkbuch übergeben')],
  }),

  // WEB-40: Lene's PR, reviewed and approved
  run({ id: 'run_web40_review', type: 'review', status: 'succeeded', key: 'WEB-40', thread: null, runner: 'rn_studio', model: 'opus', source: 'bot', created: '10-23 13:39', started: '10-23 13:40', finished: '10-23 13:47', result: { verdict: 'approve', summary: 'Keine Befunde. Freigegeben.' } }),
];

/* ---------------------------------------------------------------------------- PRs */

const pr = (
  id: string,
  key: string,
  number: number,
  title: string,
  rest: Partial<PullRequestLink> & Pick<PullRequestLink, 'state' | 'head_branch' | 'author' | 'checks'>,
): PullRequestLink => ({
  id,
  item_id: itemId(key),
  repo: 'feldwerk/website',
  number,
  title,
  url: `https://github.com/feldwerk/website/pull/${number}`,
  draft: false,
  base_branch: 'main',
  head_sha: 'a41c9e2',
  closes: true,
  review: null,
  updated_at: at('10-28 09:00'),
  ...rest,
});

const ok = (name: string) => ({ name, status: 'completed' as const, conclusion: 'success' as const });

export const pullRequests: PullRequestLink[] = [
  pr('pr_214', 'WEB-44', 214, 'WEB-44: Add alt texts to images', {
    state: 'open',
    head_branch: 'agent/WEB-44-alt-texte',
    head_sha: 'a41c9e2',
    author: { kind: 'agent', bot_id: 'u_kira' },
    review: 'changes',
    checks: [ok('tests'), ok('lint'), ok('e2e (desktop)'), ok('e2e (phone)')],
    updated_at: at('10-28 09:49'),
  }),
  pr('pr_209', 'WEB-49', 209, 'WEB-49: Layout template for service pages', {
    state: 'open',
    head_branch: 'agent/WEB-49-layout-vorlage',
    head_sha: 'b88e2f3',
    author: { kind: 'agent', bot_id: 'u_kira' },
    review: 'changes',
    checks: [{ name: 'tests', status: 'completed', conclusion: 'failure' }, ok('lint'), ok('e2e (desktop)'), { name: 'e2e (phone)', status: 'completed', conclusion: 'failure' }],
    updated_at: at('10-27 12:58'),
  }),
  pr('pr_211', 'WEB-47', 211, 'Fix double submit of the contact form', {
    state: 'closed',
    head_branch: 'fix/contact-double-submit',
    head_sha: '0c4d1aa',
    author: { kind: 'person', login: 'jonas-feld' },
    closes: false,
    checks: [{ name: 'tests', status: 'completed', conclusion: 'failure' }, ok('lint')],
    updated_at: at('10-27 16:40'),
  }),
  pr('pr_216', 'WEB-47', 216, 'WEB-47: Send the contact form once', {
    state: 'open',
    head_branch: 'fix/WEB-47-contact-once',
    head_sha: 'd9e7b21',
    author: { kind: 'person', login: 'jonas-feld' },
    checks: [{ name: 'tests', status: 'in_progress', conclusion: null }, ok('lint'), { name: 'e2e (desktop)', status: 'queued', conclusion: null }, { name: 'e2e (phone)', status: 'queued', conclusion: null }],
    updated_at: at('10-28 09:52'),
  }),
  pr('pr_217', 'WEB-42', 217, 'WEB-42: Hero and teasers of the start page', {
    state: 'open',
    draft: true,
    head_branch: 'feat/WEB-42-start-page',
    head_sha: '3b6a9f0',
    author: { kind: 'person', login: 'ida-brenner' },
    checks: [ok('tests'), ok('lint')],
    updated_at: at('10-28 09:20'),
  }),
  pr('pr_198', 'WEB-40', 198, 'WEB-40: Add the apple-touch-icon', {
    state: 'merged',
    head_branch: 'fix/WEB-40-favicon',
    head_sha: 'f0e1d2c',
    author: { kind: 'person', login: 'lene-vogt' },
    review: 'approve',
    checks: [ok('tests'), ok('lint'), ok('e2e (desktop)'), ok('e2e (phone)')],
    updated_at: at('10-23 14:10'),
  }),
];

/* ------------------------------------------------------------- comments and history */

const AGENT = 'Agent';

export const agentComments: Comment[] = [
  {
    ...comment('c_web44_review', 'WEB-44', 'kira', '10-28 09:49', ''),
    body: doc(
      p('Review von PR #214 (Commit a41c9e2): Änderungen nötig.'),
      ul('Important: Dekorative Icons im Footer haben einen Alt-Text. Sie brauchen alt="", sonst liest der Screenreader „Pfeil“ vor (resources/views/partials/footer.blade.php:18).', 'Minor: Der Test prüft nur die Startseite. Die Leistungsseiten fehlen (tests/Feature/AltTextTest.php:12).'),
    ),
    run_id: 'run_web44_review',
  },
  {
    ...comment('c_web53_failed', 'WEB-53', 'kira', '10-28 09:10', 'Der Auftrag „Umsetzen“ hat das Zeitlimit von 60 Minuten erreicht. Der Test für die Sitemap blieb rot (Route [sitemap] not defined); gepusht ist noch nichts. Worktree und Session bleiben erhalten.'),
    run_id: 'run_web53_task',
  },
  {
    ...comment('c_web49_brake', 'WEB-49', 'kira', '10-27 12:58', 'Ich höre hier auf: Nach drei Korrekturen ist CI auf PR #209 noch rot (tests und e2e (phone): Snapshot der Leistungsseite). @mara, der Strang ist pausiert; PR, Branch und Session bleiben. Weist du das Item wieder mir zu, fange ich mit den Kommentaren seit meinem letzten Auftrag neu an.'),
    run_id: 'run_web49_corr3',
  },
  comment('c_web42_question', 'WEB-42', 'ida', '10-28 09:30', '@kira welche Bildgrößen braucht der Hero auf Mobilgeräten? Steht das irgendwo?'),
  {
    ...comment('c_web42_answer', 'WEB-42', 'kira', '10-28 09:33', 'Laut der Wiki-Seite „Bildgrößen“: 750 × 1000 px für Mobil, 1600 × 900 px ab Tablet, als WebP. Das Partial hero.blade.php lädt sie über srcset, die Breakpoints stehen dort in Zeile 14.'),
    run_id: 'run_web42_comment',
  },
  {
    ...comment('c_web40_review', 'WEB-40', 'kira', '10-23 13:47', 'Review von PR #198 (Commit f0e1d2c): Freigegeben, keine Befunde.'),
    run_id: 'run_web40_review',
  },
];

export const agentEvents: ItemEvent[] = [
  // WEB-51: Mara assigns Kira, the task starts
  event('ev_web51_assigned', 'work_item.assigned', 'WEB-51', 'mara', '10-28 09:55', { assignee_id: { old: null, new: 'u_kira' } }),
  event('ev_web51_started', 'work_item.state_changed', 'WEB-51', 'kira', '10-28 09:56', state('std_backlog', 'std_progress'), `${AGENT}: Auftrag „Umsetzen“ gestartet`),
  // WEB-44: task, PR, review with findings
  event('ev_web44_started', 'work_item.state_changed', 'WEB-44', 'kira', '10-28 08:52', state('std_todo', 'std_progress'), `${AGENT}: Auftrag „Umsetzen“ gestartet`),
  event('ev_web44_review', 'work_item.state_changed', 'WEB-44', 'kira', '10-28 09:21', state('std_progress', 'std_pending'), `${AGENT}: PR #214 geöffnet`),
  event('ev_web44_back', 'work_item.state_changed', 'WEB-44', 'kira', '10-28 09:49', state('std_pending', 'std_todo'), `${AGENT}: Review mit Befunden`, 5),
  // WEB-54: Mara assigns Kira, the task fails at once
  event('ev_web54_assigned', 'work_item.assigned', 'WEB-54', 'mara', '10-28 09:34', { assignee_id: { old: 'u_lene', new: 'u_kira' } }),
  // WEB-53: started, timed out
  event('ev_web53_started', 'work_item.state_changed', 'WEB-53', 'kira', '10-28 08:05', state('std_todo', 'std_progress'), `${AGENT}: Auftrag „Umsetzen“ gestartet`),
  event('ev_web53_back', 'work_item.state_changed', 'WEB-53', 'kira', '10-28 09:10', state('std_progress', 'std_todo'), `${AGENT}: Auftrag gescheitert`, 5),
  // WEB-49: from Kira back to Mara
  event('ev_web49_assigned', 'work_item.assigned', 'WEB-49', 'mara', '10-27 09:09', { assignee_id: { old: null, new: 'u_kira' } }),
  event('ev_web49_started', 'work_item.state_changed', 'WEB-49', 'kira', '10-27 09:10', state('std_backlog', 'std_progress'), `${AGENT}: Auftrag „Umsetzen“ gestartet`),
  event('ev_web49_review', 'work_item.state_changed', 'WEB-49', 'kira', '10-27 09:48', state('std_progress', 'std_pending'), `${AGENT}: PR #209 geöffnet`),
  event('ev_web49_brake', 'work_item.state_changed', 'WEB-49', 'kira', '10-27 12:58', state('std_pending', 'std_todo'), `${AGENT}: Bremse nach 3 Korrekturen`, 5),
  event('ev_web49_back', 'work_item.assigned', 'WEB-49', 'kira', '10-27 12:58', { assignee_id: { old: 'u_kira', new: 'u_mara' } }, `${AGENT}: Bremse nach 3 Korrekturen`, 6),
];
