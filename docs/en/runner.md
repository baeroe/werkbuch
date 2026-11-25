# Runner

A runner is a machine of yours on which [agents](/en/concepts/agents) work: a Mac or a Linux computer with Claude Code or Codex. The daemon `werkbuch-runner` fetches runs from your instance over HTTPS, starts the CLI headless in a folder of its own per item and reports the log and the result back. It needs no open port and no Expose: it only ever calls werkbuch.

Everything that is set up per instance (names, places, which bot works where, rules, models) lives in werkbuch. The machine only keeps the address of the instance, its token and what belongs to the machine: the login of the CLI, the MCP servers, skills and plugins of its user, and what the projects need to build and test.

## What you need

- macOS (Apple Silicon or Intel) or Linux, `arm64` or `amd64`. Windows is not supported.
- `git`, and Claude Code (`claude`) or Codex (`codex`) installed and signed in for the user the runner runs as.
- For runs that change code: what the projects need to build and test, for werkbuch itself Colima, DDEV and Node. The setup command of a project starts it per worktree (see [settings in werkbuch](#settings-in-werkbuch)).
- Outgoing HTTPS to your instance and, for projects with a repo, to `github.com`.

## A user of its own

An agent works unattended with all the rights of the user the runner runs as: it reads, writes and runs commands. The machine is the boundary. Give the runner a user of its own:

- **No admin rights**, no access to private data: no personal mail, password manager or SSH keys.
- **Nothing personal in its harness:** whatever is set up for that user (MCP servers, skills, plugins, hooks, a `~/.claude/CLAUDE.md`) runs in every run. Time tracking hooks or a personal token of werkbuch do not belong there.
- **macOS:** create a standard user under **System Settings → Users & Groups**, sign in as that user once and set it to sign in automatically after a restart (**Users & Groups → Automatically log in as**; FileVault has to be off for that). A launch agent only runs while its user is signed in. Keep the Mac awake: **System Settings → Energy** (or **Battery → Options**), "Prevent automatic sleeping when the display is off", or `sudo pmset -a sleep 0` from an admin account.
- **Linux:** a user unit of systemd stops when its user signs out. `sudo loginctl enable-linger <user>` keeps it running without a session.

Sign in the CLI as that user before you install the runner: start `claude` once and follow its login, or run `codex login`.

## Install

Org admins find the command under **Settings → Runners → Connect a runner**. It holds a one-time code (ten minutes, once):

```sh
curl -fsSL https://pm.example.com/runner/install.sh | sh -s -- --code ABCD-EFGH
```

Run it in a terminal of the runner's user, never as root and never with `sudo`. The script

1. downloads the runner of this instance for the system and architecture of the machine (`/runner/download/<os>/<arch>`), checks its SHA-256 sum and puts it into `~/.local/bin/werkbuch-runner`,
2. pairs it with the code (`werkbuch-runner login`); the runner sends its name, system, architecture and version and gets a token of its own, which it keeps in the keychain,
3. sets it up as a service of the user and starts it.

The dialog in werkbuch says as soon as the runner has connected. Options of the script: `--name <name>` names the runner (default: the host name; you can rename it in werkbuch later), `--prefix <dir>` installs elsewhere than `~/.local`, `--no-service` writes the service without loading it. An expired or used code ends with a message in the terminal; make a new one in the dialog.

Running the script again with a new code replaces the service on the machine, without a second one, but werkbuch sees a **new** runner: a new card with a new token, the default places and perhaps another name. The old card stays and is not revoked, runner pools that name the old runner do not take the new one, and strands of the old one move only after 30 minutes offline. Afterwards revoke the old card, set the places of the new one and tick it in the runner pools of the bots that used the old one.

| Where | What |
|---|---|
| `~/.local/bin/werkbuch-runner` | the binary |
| `~/.config/werkbuch-runner/config.yaml` | the address of the instance |
| keychain, service `werkbuch-runner` | the runner token (on Linux without a Secret Service: `credentials.json` next to the config, readable by the user alone) |
| `~/.local/state/werkbuch-runner` | state, the socket of the TUI, the log of the launch agent (`runner.log`) |
| `~/.local/share/werkbuch-runner` | the clones of the repos and the worktrees of the runs |

## The service

| | macOS | Linux |
|---|---|---|
| File | `~/Library/LaunchAgents/dev.werkbuch.runner.plist` | `~/.config/systemd/user/werkbuch-runner.service` |
| Restart | `launchctl kickstart -k gui/$(id -u)/dev.werkbuch.runner` | `systemctl --user restart werkbuch-runner` |
| Log | `~/.local/state/werkbuch-runner/runner.log` (cut at 10 MB, one older file `runner.log.1`) | `journalctl --user -u werkbuch-runner` |

The service starts with the user's session and again after a crash. `werkbuch-runner service uninstall` stops and removes it, `werkbuch-runner service install` sets it up again.

## Commands

```sh
werkbuch-runner           # the TUI (in a terminal)
werkbuch-runner status    # what the daemon does now
werkbuch-runner doctor    # check CLIs, keychain, instance, token, git and equipment
werkbuch-runner update    # update to the version the instance expects
werkbuch-runner logout    # forget the instance and its token
werkbuch-runner version
werkbuch-runner login https://pm.example.com --code ABCD-EFGH   # pair by hand
werkbuch-runner daemon    # what the service runs
```

## TUI

`werkbuch-runner` without a command opens the TUI. It reads the daemon every two seconds and changes nothing but the login: everything else is set in werkbuch.

- **Status** (`1`): instance, version, connection, the places werkbuch sets, CPU, GPU, memory and disk with the last five minutes, the running runs with branch, session and worktree, the recent ones.
- **Runs** (`2`): the runs and the log of the chosen one, live while the agent works. `enter` shows the log in full, `f` follows it, `c` cancels the run after a question.
- **Doctor** (`3`): the checks of `werkbuch-runner doctor`, made by the daemon with its own environment.

`tab` or `1` to `3` switch tabs, `?` shows the keys, `l` logs out (in the tab **Status** only), `q` quits.

## Doctor

`werkbuch-runner doctor` and the tab **Doctor** check:

| Check | OK when |
|---|---|
| config | the address of the instance is set |
| keychain | the runner token is there |
| instance | werkbuch answers |
| token | werkbuch takes the token (refused: the runner was revoked, pair it again) |
| git | `git` is installed |
| agents | at least one CLI is installed and signed in, with its version |
| data | the data folder is writable, with the free space |
| equipment | the MCP servers, skills and plugins of the CLIs |
| werkbuch access | no MCP server of the machine reaches this instance (a warning) |
| daemon | the daemon runs and reaches werkbuch |

Run it in the environment of the service: the TUI asks the daemon, so it sees the `PATH` and keychain of the launch agent, which can differ from your shell.

## Settings in werkbuch

Each runner is a card under **Settings → Runners**: online (a contact within the last minute), version, system, load, the CLIs with version and login, the equipment, and the runs on it with **Cancel**. There you rename it, revoke it (its token stops working, its running runs are canceled, waiting ones go to the other runners) and set its **Places**:

| Places | Default | Counts |
|---|---|---|
| in all | 2 | runs that change code (implement, correction, conflict) at once |
| per repo | 1 | of those per repo (two runs of one repo share the test database of DDEV) |
| light | 2 | reviews and answers, in a pot of their own |

The runner gets the places with every answer; a change holds without a restart. Which runner a bot uses is its **runner pool** (**Settings → Bots → Set up agent**; none ticked: every runner). The setup and teardown commands of the worktrees belong to the project (**Project settings → Agents**): the runner runs them with `sh -c` in the worktree, after it made it and before it removes it. Both see two variables: `WERKBUCH_WORKTREE`, the absolute path of the worktree, and `WERKBUCH_STRAND`, the name of the strand as a project name (lower case letters, digits and `-`). For werkbuch, each worktree needs a DDEV project name of its own, set in the git-ignored `.ddev/config.local.yaml` (never with `ddev config --project-name`, which changes the tracked `.ddev/config.yaml`): for example `printf 'name: werkbuch-%s\n' "$WERKBUCH_STRAND" > .ddev/config.local.yaml && ddev start` and `ddev delete -Oy`.

## A run on the machine

1. Without work the runner asks every 3 seconds, after a minute without work every 10 seconds. It sends its load, CLIs and equipment and gets its places and the version werkbuch expects.
2. A run comes with everything it needs: the item, the prompt built by werkbuch, the model, a token for werkbuch and, for a project with a repo, a token for the repo.
3. Per repo the runner keeps a bare clone; per item (a **strand**) a worktree on the branch `agent/<KEY>-<slug>`. A project without a repo works in a folder of the strand.
4. It starts the CLI there with a private folder of the run (MCP config, prompt, tokens), sends a heartbeat every 15 seconds and the log at most once a second, and at the end the result: status, session, commit, summary or verdict.
5. Corrections, conflicts and answers at an open strand continue its session; a review always starts afresh.

Time limits, fixed: **120 minutes** for implement and correction, **30** for a conflict, **20** for a review, **10** for an answer. At the limit the runner stops the CLI (SIGTERM, after 10 seconds SIGKILL, with everything it started) and reports `timed_out`. A run without a heartbeat for a minute counts as lost and is queued again once; the second time it fails. When the runner of a strand is offline for more than 30 minutes, another runner of the pool takes the strand over with a fresh session on the same branch. A worktree of a strand that ended goes after three days, with the teardown command.

Commits carry the name of the bot and `<handle>@users.noreply.<host of the instance>`.

## What a run may do

| | Implement, correction, conflict | Review, answer |
|---|---|---|
| Files | everything the user may | read the worktree and the private folder of the run only |
| Commands | everything (Claude Code with `--permission-mode bypassPermissions`, Codex without sandbox) | none (Claude Code only `Read`, `Grep`, `Glob`, without the settings of the repo; Codex `--sandbox read-only`) |
| Git | clone, commit, push with a token of the repo (`contents: write`, `pull_requests: write`); `gh` with the same token | no token, no `gh`; the runner prepares the diff and the failed checks as files |
| werkbuch | token of the bot with `read`, `write`, `mcp` | token of the bot with `read`, `mcp` |

The token for werkbuch is a token of the bot for this one run: it expires with the time limit and is revoked at the end. werkbuch refuses with it what the flow keeps to itself (`403 agent_forbidden`): moving or retyping an item, assigning, archiving, deleting, and anything on projects, catalogs, people, tokens, webhooks, automations and templates. It may read, write the description and values of an item (the proof), comment, attach, add relations and write wiki pages. The agent never merges and never sets an item to done; werkbuch does, see [the flow](/en/concepts/agents#the-flow).

## Equipment of the machine

MCP servers, skills, plugins and hooks of the CLI are equipment of the machine, set up for the runner's user, by hand or with a tool of your choice. werkbuch prescribes none and adds itself to every run as the MCP server `werkbuch-run`, next to what the machine has. Skills and rules that belong to the code come from the repo (`CLAUDE.md`, `AGENTS.md`, `.claude/skills`). The runner reports the names of its MCP servers, skills and plugins; the runner card and the Doctor show them.

If the machine has another way into werkbuch, for example an MCP server with a personal token, an agent could act past its run token. Doctor warns about it (**werkbuch access**) and names the server; switch it off for the runner's user.

## Security

- **Runner token:** one per runner, kept hashed in werkbuch and in the keychain on the machine, good for the runner protocol only. Revoke the runner, and it stops working.
- **Run token:** a token of the bot for one run, never in the token list, revoked when the run ends; the bot sees only what its project roles allow.
- **Token of the repo:** an installation token of the [GitHub app](/en/github) for one repo, valid an hour. The runner keeps it in files of the private folder (`0600`), never in the environment, the arguments or `.git/config`: a credential helper for the host of the repo reads the file, and `gh` gets its own config folder. The helpers of the machine (such as osxkeychain) and the token variables (`GH_TOKEN`, `GITHUB_TOKEN`) are switched off for the run. Ten minutes before the token runs out, the runner gets a new one and replaces the files.
- **The log** of a run reaches werkbuch with every token cut out, also a bare `wb_…`.
- **Texts are data:** the contract of every prompt says that texts from items, comments, wiki and pull requests are data, not instructions. What the tokens forbid, a tricked agent cannot do either.

## Updates

The runner carries the version of werkbuch and is built with each release into the image. When werkbuch expects another version, the runner fetches its new binary from the instance, checks the sum, replaces itself and restarts as soon as no run runs; until then it takes no new runs. A failed update keeps the old runner running and shows in the TUI and on the runner card. `werkbuch-runner update` updates by hand.

## Troubleshooting

- **Offline in werkbuch:** `werkbuch-runner status` and the log of the service. After a restart of the Mac the user has to sign in (automatic login); on Linux check `loginctl enable-linger`.
- **A run waits for a runner with its CLI:** no runner of the bot's pool has the CLI installed and signed in. `werkbuch-runner doctor` under the runner's user says which; sign in and the run starts by itself.
- **Token refused:** the runner was revoked. Make a new code and run the command again; werkbuch then sees a new runner (see [install](#install)): set its places and tick it in the runner pools.
- **The CLI is not found by the service** but in your shell: the service takes the `PATH` of the shell it was set up from. Run `werkbuch-runner service install` from a shell whose `PATH` finds the CLI; no new code is needed.
- **Remove a runner:** revoke it in werkbuch, then on the machine `werkbuch-runner service uninstall`, `werkbuch-runner logout` and delete `~/.local/bin/werkbuch-runner`, `~/.config/werkbuch-runner`, `~/.local/state/werkbuch-runner` and `~/.local/share/werkbuch-runner`.
