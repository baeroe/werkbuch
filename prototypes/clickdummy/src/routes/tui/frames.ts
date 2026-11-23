/*
 * Static pictures of the runner in a terminal (WEBU-18, spec 8.2, 8.5 and 8.6): the output of `install.sh` and the
 * three tabs of the TUI. Nothing is set up in the TUI: slots and setup commands live in werkbuch; MCP servers, skills
 * and plugins are equipment of the machine. They are text with a small markup, so they stay readable and can be copied:
 *
 *   {a:text}  accent (cyan)            {A:text}  accent bold         {k:text}  key (cyan bold)
 *   {g:text}  green    {r:text}  red   {y:text}  yellow   {b:text}  blue
 *   {m:text}  app name (magenta bold)  {d:text}  dim       {B:text}  bold    {w:text}  code (white bold)
 *   {T:text}  active tab (reverse)     {!:text}  alert chip (white on red)   {s:text}  selected (cyan bold)
 *   a line starting with §             the selected row (bright black background over the full width)
 *
 * The demo data are those of the clickdummy: mac-studio works on WEB-51, mac-mini-alt is offline.
 */

export const WIDTH = 104;

export const visible = (line: string) => line.replace(/^§/, '').replace(/\{[aAkgrybmdBwT!s]:([^}]*)\}/g, '$1');

/** Pads a line with spaces to the width of the terminal (selected rows paint their background that far). */
const pad = (line: string) => line + ' '.repeat(Math.max(0, WIDTH - visible(line).length));

/** Left part, spaces, right part: the right part ends one cell before the edge, like Lip Gloss lays out skilltri. */
function spread(left: string, right: string): string {
  const gap = WIDTH - visible(left).length - visible(right).length - 1;
  return `${left}${' '.repeat(Math.max(1, gap))}${right} `;
}

const TABS = ['Status', 'Runs', 'Doctor'] as const;
export type TabName = (typeof TABS)[number];

function header(active: TabName): string {
  const tabs = TABS.map((name, index) => (name === active ? `{T: ${index + 1} ${name} }` : `{d: ${index + 1} ${name} }`)).join('');
  return spread(` {m:werkbuch-runner}  ${tabs}`, `{g:● connected}{d: · }1/2 slots`);
}

function footer(keys: [string, string][], status = ''): string {
  const hints = keys.map(([key, label]) => `{k:${key}} {d:${label}}`).join('  ');
  return status ? spread(` ${hints}`, status) : pad(` ${hints}`);
}

const rule = (title: string) => `  {B:${title}}`;
const blank = '';

export interface Frame {
  id: string;
  title: string;
  caption: string;
  /** What the window bar names. */
  window: string;
  /** A TUI frame fills the terminal's width; shell output only as wide as it is. */
  fixed?: boolean;
  lines: string[];
}

const install: Frame = {
  id: 'install',
  title: 'Installation mit install.sh',
  caption: 'Der Befehl aus „Runner verbinden“ im Terminal eines Macs: Das Skript erkennt System und Architektur, lädt den Runner von der Instanz, prüft die Prüfsumme, verbindet ihn mit dem Code und richtet den Dienst ein.',
  window: 'zsh, runner@mac-mini-buero',
  lines: [
    '{d:$} curl -fsSL https://werkbuch.example.com/runner/install.sh | sh -s -- --code K7QF-29XM',
    '',
    '{m:werkbuch-runner} installer',
    '',
    '  {d:system}       darwin/arm64',
    '  {d:instance}     https://werkbuch.example.com',
    '{g:✓} downloaded   werkbuch-runner 0.1.0-dev {d:(14.2 MB)}',
    '{g:✓} checksum     sha256 9e4b…c07a matches',
    '{g:✓} installed    ~/.local/bin/werkbuch-runner',
    '{g:✓} paired       as {B:mac-mini-buero} with Feldwerk {d:(token stored in the keychain)}',
    '{g:✓} service      launchd {d:dev.werkbuch.runner} loaded and started',
    '',
    'The runner polls for runs now, for every project. Slots and setup commands come from werkbuch;',
    'MCP servers, skills and plugins are set up on this machine.',
    'Open the TUI with {w:werkbuch-runner}.',
    '',
    '{d:$} ',
  ],
};

const installExpired: Frame = {
  id: 'install-expired',
  title: 'Installation mit abgelaufenem Code',
  caption: 'Ein Code gilt zehn Minuten und nur einmal. Das Skript bricht ab, bevor es einen Dienst anlegt, und sagt, wo es einen neuen gibt.',
  window: 'zsh, runner@mac-mini-buero',
  lines: [
    '{d:$} curl -fsSL https://werkbuch.example.com/runner/install.sh | sh -s -- --code K7QF-29XM',
    '',
    '{m:werkbuch-runner} installer',
    '',
    '  {d:system}       darwin/arm64',
    '{g:✓} downloaded   werkbuch-runner 0.1.0-dev {d:(14.2 MB)}',
    '{g:✓} checksum     sha256 9e4b…c07a matches',
    '{g:✓} installed    ~/.local/bin/werkbuch-runner',
    '{r:✗} paired       {r:the code has expired (valid for 10 minutes, once)}',
    '',
    'Create a new code in werkbuch: {B:Organization → Runners → Connect runner}, then run the command again.',
    'Nothing else changed; no service was set up.',
    '',
    '{d:$} ',
  ],
};

const status: Frame = {
  id: 'status',
  fixed: true,
  title: 'Status',
  caption: 'Verbindung, Instanz, Version, die Plätze aus werkbuch, die Auslastung der Maschine mit Verläufen der letzten zehn Minuten und was gerade läuft. Eingestellt wird nichts hier, sondern in werkbuch.',
  window: 'werkbuch-runner, mac-studio',
  lines: [
    header('Status'),
    blank,
    '  {d:instance}   https://werkbuch.example.com  {d:(Feldwerk)}',
    '  {d:runner}     {B:mac-studio}   darwin/arm64   0.1.0-dev   {d:protocol 3}',
    '  {d:connection} {g:● connected}  {d:last poll 2 s ago, next in 3 s}',
    '  {d:slots}      {A:■}□  1 of 2   {d:per repo} 0 of 1   {d:light (reviews, answers)} □□ 0 of 2   {d:(from werkbuch)}',
    blank,
    rule('Load') + '                                                {d:last 10 minutes}',
    '  {d:cpu}       {a:██████}{d:░░░░░░░░░░░░░░}   31 %                {a:▂▃▃▅▆▄▃▃▅▆▇▆▅▄▃▃▄▅▅▄▃▄▅▆▅▄▃▃▄▅}',
    '  {d:gpu}       {a:██}{d:░░░░░░░░░░░░░░░░░░}   12 %                {a:▁▁▂▁▁▁▂▃▂▁▁▁▂▁▁▁▁▂▁▁▁▂▂▁▁▁▂▁▁▁}',
    '  {d:memory}    {a:████████████}{d:░░░░░░░░}   38.2 of 64 GB       {a:▅▅▅▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆}',
    '  {d:disk}      {a:████████████████}{d:░░░░}   182 of 994 GB free  {a:▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇}',
    blank,
    rule('Running'),
    '§  {s:WEB-51}  task        sonnet   {a:● 6:12}   Cookie-Banner auf Consent v2 umstellen',
    '           {d:agent/WEB-51-cookie-banner-consent-v2   session 4f2c9e1a   worktree ~/…/website/WEB-51}',
    blank,
    rule('Recent'),
    '  WEB-44  review      opus     {g:✓ done}      09:38–09:49   {y:changes (2 findings)}',
    '  WEB-42  comment     haiku    {g:✓ done}      09:31–09:33   answer posted',
    '  WEB-53  task        haiku    {r:✗ timed out} 08:10–09:10   {r:60 min limit, nothing pushed}',
    blank,
    '  {d:Slots are set in werkbuch (Organization → Runners); MCP servers, skills, plugins on this machine.}',
    footer([['tab', 'next tab'], ['1-3', 'tabs'], ['enter', 'open run'], ['r', 'refresh'], ['l', 'logout'], ['?', 'help'], ['q', 'quit']], '{g:polled 2 s ago}'),
  ],
};

const runs: Frame = {
  id: 'runs',
  fixed: true,
  title: 'Runs',
  caption: 'Laufende und letzte Aufträge links, das Protokoll des gewählten rechts, live während des Laufs. „c“ bricht ab wie „Abbrechen“ in werkbuch.',
  window: 'werkbuch-runner, mac-studio',
  lines: [
    header('Runs'),
    blank,
    `  {d:RUN                         STATUS}        {d:│} {d:LOG}  WEB-51 task, sonnet, 6:12`,
    `§  {s:WEB-51 task       sonnet}    {a:● running}     {d:│} {d:+0:31} Read resources/js/consent/banner.ts`,
    `  WEB-44 review     opus      {g:✓ done}        {d:│} {d:+0:44} Das Banner setzt nur ein Cookie „consent=1“.`,
    `  WEB-42 comment    haiku     {g:✓ done}        {d:│}       Consent v2 braucht die vier Signale ad_storage,`,
    `  WEB-53 task       haiku     {r:✗ timed out}   {d:│}       analytics_storage, ad_user_data, ad_person….`,
    `  WEB-53 task       haiku     {d:↻ lost}        {d:│} {d:+1:10} Read tests/js/consent.test.ts`,
    `  WEB-49 correction sonnet    {g:✓ done}        {d:│} {d:+1:36} Ich schreibe zuerst Tests für die vier Signale.`,
    `  WEB-49 review     opus      {g:✓ done}        {d:│} {d:+2:00} Edit tests/js/consent.test.ts`,
    `  WEB-49 conflict   sonnet    {g:✓ done}        {d:│} {d:+2:38} Bash pnpm vitest run tests/js/consent.test.ts`,
    `  WEB-49 review     opus      {d:– canceled}    {d:│} {d:+2:51} {B:3 failed, 2 passed}`,
    `  WEB-49 correction sonnet    {g:✓ done}        {d:│} {d:+3:25} Edit resources/js/consent/banner.ts`,
    `  WEB-49 correction sonnet    {g:✓ done}        {d:│} {d:+4:08} Edit resources/js/consent/signals.ts`,
    `                                            {d:│} {d:+4:36} Bash pnpm vitest run tests/js/consent.test.ts`,
    `                                            {d:│} {d:+4:49} {B:5 passed}`,
    `                                            {d:│} {d:+5:10} Die Signale stimmen. Jetzt das Banner im Browser.`,
    `                                            {d:│} {d:+5:52} playwright browser_navigate …website.ddev.site`,
    `                                            {d:│} {a:▍}`,
    blank,
    footer([['j/k', 'move'], ['enter', 'full log'], ['c', 'cancel'], ['f', 'follow log'], ['?', 'help'], ['q', 'quit']], '{a:following WEB-51}'),
  ],
};

const doctor: Frame = {
  id: 'doctor',
  fixed: true,
  title: 'Doctor',
  caption: 'Prüft, was ein Auftrag braucht: die CLIs, installiert und angemeldet (Codex ist hier installiert, aber nicht angemeldet: Aufträge von Agenten mit Codex warten), die Modelle der Agenten, Git, Schlüsselbund und die Instanz, und zeigt die Ausstattung des Harness (MCP-Server, Skills, Plugins), die man auf der Maschine einrichtet. Hier auf build-01 läuft der Runner unter dem eigenen Benutzer: ein MCP-Server erreicht werkbuch mit einem persönlichen Token, der Agent hätte einen zweiten Zugang.',
  window: 'werkbuch-runner, build-01',
  lines: [
    header('Doctor'),
    blank,
    '  {g:✓} instance       https://werkbuch.example.com answers {d:(38 ms, protocol 3)}',
    '  {g:✓} token          in the keychain, accepted',
    '  {y:!} version        0.1.0-alpha, the instance offers 0.1.0-dev {d:(update failed: checksum)}',
    '  {g:✓} claude         2.4.1, logged in',
    '  {y:!} codex          0.40.0, not logged in {d:(run codex login; runs of agents with Codex wait)}',
    '  {g:✓} models         sonnet, opus, haiku, fable {d:(Kira: default sonnet, review opus; model labels)}',
    '  {g:✓} git            2.47.1',
    blank,
    rule('Harness (set up on this machine)'),
    '  {d:mcp servers}    werkbuch-mara, context7 {d:+ werkbuch with the token of each run}',
    '  {d:skills}         ops:runbook',
    '  {d:plugins}        none',
    '  {r:✗} werkbuch       {r:werkbuch-mara reaches werkbuch with a personal token: a second way in}',
    '                   {d:Turn it off for the runner, or run the runner under its own macOS user.}',
    blank,
    '  {!: 1 problem } {d:Runs stay possible; the agent sees werkbuch twice until it is turned off.}',
    footer([['r', 'run again'], ['enter', 'details'], ['?', 'help'], ['q', 'quit']], '{r:1 problem} {y:2 warnings}'),
  ],
};

export const FRAMES: Frame[] = [install, installExpired, status, runs, doctor];
export const padLine = pad;
