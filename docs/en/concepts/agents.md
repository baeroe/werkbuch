# Agents

An agent is a [bot](/en/bots) that works on items by itself. Assign it an item, and a [runner](/en/runner), a machine of yours with Claude Code or Codex, implements it, opens a pull request, lets CI and an independent review run, fixes what they find, and werkbuch merges once everything is green. Ask it something in a comment, and it answers from the wiki, the items and the code of the project.

An item an agent works on looks like any other: the same history, the same notifications, the same automations. The agent never moves an item, never assigns it and never merges; werkbuch does all of that, under the name of the bot.

| Term | Means |
|---|---|
| Agent | a bot with its agent switched on: runner pool, CLI, models |
| Runner | a machine with the daemon `werkbuch-runner` |
| Run | one go of an agent on a runner: implement, correction, conflict, review or answer |
| Strand | the ongoing work on an item or epic: branch, worktree, session of the CLI, pull request |

## Before the first run

1. **A runner:** connect one under **Settings → Runners** ([Runner](/en/runner)).
2. **GitHub**, for projects with code: connect the app under **Settings → GitHub** and pick the repo of the project under **Project settings → Agents** ([GitHub](/en/github)). A project without a repo works too, see [without a repo](#without-a-repo).
3. **The setup command**, for projects with code: under **Project settings → Agents**, so that each worktree gets its dependencies and its own test environment, with DDEV a project name of its own per strand ([setup and teardown](/en/runner#setup-and-teardown)). It runs before every run that changes code, so write it so it can run again.
4. **The ruleset of the base branch:** if it requires an approval, put the app in its bypass list, for pull requests only; otherwise werkbuch cannot merge ([approval required](/en/github#approval-required)).
5. **A bot as agent:** **Settings → Bots → Set up agent**: on, the runner pool (none ticked: every runner), the CLI, the default model and a model per kind of run. The bot needs a responsible person, has to be active and a member of the project with the right to edit items. The default bot cannot be an agent.
6. **The steps of the workflow:** the workflow of the project names a state for each of the four [steps of the agents](/en/concepts/workflows#steps-of-the-agents): In progress, In review, Correction, Merged. Without all four, agents work on no item in its projects, and assigning a bot stays a plain assignment; they still answer mentions (an answer moves no item).

Where something is missing, the item says why under its title, and **Project settings → Agents** says it for the project.

## The flow

```
Bot assigned ─► implement (In progress)
  └─ pull request open ─► In review
       ├─ conflict with the base ─► conflict ─► push ─► (CI …)
       ├─ CI red ─────────────┐
       ├─ CI green ─► review   │
       │    ├─ findings ───────┴─► Correction ─► correction ─► In progress ─► push ─► (CI …)
       │    └─ no findings ─► werkbuch merges ─► Merged
       └─ brake (3 corrections / 2 conflicts) ─► strand paused, item to the responsible person
```

1. **Assigned:** someone assigns the item to the bot (also a template whose assignee is the bot). werkbuch queues an **implement** run; when it starts, the item goes to **In progress**.
2. **Pull request:** the agent works in a worktree on the branch `agent/<KEY>-<slug>`, tests, commits, pushes and opens a pull request with `Fixes <KEY>`. werkbuch links it and moves the item to **In review**. If an earlier strand of the item already used that name (a closed pull request, then a new assignment), the new strand gets `-2`, `-3` … so the old worktree does not hold it; names made by hand or left on the remote are not checked.
3. **CI:** werkbuch hears the checks of the head commit. Green means every check run, every workflow run of GitHub Actions and every commit status of that commit is done and none failed; red as soon as one fails, even while others still run. A repo without any check counts as green when GitHub has none for the commit two minutes after the push.
4. **Review:** on green CI the review agent of the project reviews the pull request, always with a fresh session and without the context of the implementation; without a review agent, the bot of the strand reviews it itself. Once per head commit; a new push makes a running review void.
5. **Correction:** red CI or findings in the review move the item to **Correction** and start a **correction** on the same strand, continuing its session. werkbuch names the failed checks with links; the agent reads their logs itself. Then CI and review run again.
6. **Merge:** with a review without findings and green CI on the same head commit, and a mergeable pull request, werkbuch merges with the merge method of the project and deletes the branch. The item goes to **Merged**. The verdict of the review stands as a comment at the pull request (the app cannot approve its own pull request).

Done comes only after the merge: done sets the resolution, closes a parent epic through [automations](/en/concepts/automations) and starts the clock of auto-archive.

A **conflict** with the base branch goes before CI and review: werkbuch checks the open pull requests of agents after every push to their base and before every merge, and starts a **conflict** run. The agent merges the base into the branch (no rebase, no force push), resolves the conflicts, runs the affected tests and pushes.

While a run that changes code is waiting or running, CI and review decide nothing; their findings wait at the strand. If the run ends without a new commit, waiting findings become a correction, otherwise the strand pauses (no change), unless a correction only set the proof of the item (`resolution_proof`): then the same head commit is reviewed again. With a new commit they are void.

## Kinds of runs

| Run | Starts when | May | Ends with | Time limit |
|---|---|---|---|---|
| implement | the bot is assigned an item | worktree, commits, push, open a pull request, read and write werkbuch | an open pull request | 120 min |
| correction | red CI, findings of the review, a person moves the item back to Backlog or Unstarted, or assigns it to the bot again | like implement, same strand and session | a new push to the same pull request | 120 min |
| conflict | the pull request conflicts with its base | like correction | the base merged in, a push | 30 min |
| review | all checks of the head commit green | read only | a verdict: no findings or findings | 20 min |
| answer | a person mentions the bot in a new comment | read only | an answer as a comment of the bot | 10 min |

What a run may do, the tokens enforce, not only the prompt; see [what a run may do](/en/runner#what-a-run-may-do). Changes werkbuch makes in the flow (state, assignment), comments of bots, mentions in a description or field and edited comments never start a run.

## Without a repo

In a project without a repo, an implement run works in a folder of its own and ends with a summary as a comment of the bot. The item goes straight to the step **Merged**: there is no pull request, no CI and no review.

## Brakes

So no strand burns tokens without end, each strand has two brakes (**Project settings → Agents**, 1 to 10): at most **3 corrections** and **2 conflicts**. Past a brake the strand pauses: pull request, branch, worktree and session stay, the item goes to **Correction** and is assigned to the responsible person of the bot, with a comment naming the last finding. The same happens when a run ends without any change.

## When a run fails

A run that fails, times out or is lost twice leaves a comment with the reason, and nothing starts again by itself. After a run that changes code or a review of an agent's pull request the item goes to **Correction**; a failed answer leaves the item where it is. **Start again** at the run starts the same kind on the same strand; the brakes keep counting.

## People step in

- **Assign the item to a person:** a running run is canceled, the strand pauses; the pull request stays.
- **Assign it to the bot again:** with an open or paused strand a correction with the comments since the last run as findings, and the brakes start from zero; without a strand a new implement run. A strand paused by an [unauthorized merge](/en/github#unauthorized-merge) goes on only with **Confirm and continue**, one paused by **Disconnect GitHub** only with **Resume**; assigning again does not wake it.
- **Move it back to Backlog or Unstarted** while the pull request of the bot is open: a correction as well.
- **Merge the pull request on GitHub yourself:** werkbuch treats it like its own merge; the item goes to **Merged**. Close it without a merge, and the strand ends and the item goes to **Correction** with a comment.
- **Cancel** a run at the item; whoever may edit the item may.
- **Ask:** mention the bot in a comment (see [mentions](#mentions)). A question never changes code; to get a change, move the item back or assign it again.

## When the agent is stuck

If the agent cannot do an item, or only part of it, because something is missing (information, access, a decision), it ends its answer with `Outcome: blocked` and lists what it needs. werkbuch then writes that as a comment of the bot, moves the item to the optional step `blocked` (usually **Pending**, [steps of the agents](/en/concepts/workflows#steps-of-the-agents)) and gives it to the responsible person of the bot. The strand pauses: no review, no merge. Answer in the comments and assign the item to the bot again; a correction begins with the comments since the last run. A part that was pushed stays on the branch. At a child of an epic the strand keeps running with the next child; the epic is not marked ready while a child waits for a person. Without the step `blocked` the item keeps its state; comment, assignment and pause stay.

## Begin in Todo

With the optional step `ready` (usually **Todo**, [steps of the agents](/en/concepts/workflows#steps-of-the-agents)) the bot begins an item only when it is its own **and** stands in that state. Assigned in the backlog, nothing starts: the item says "Bob begins as soon as the item is in Todo". Assign it in Todo, or move an item of the bot to Todo, and the implement run starts. An item of the bot that a person puts into **Correction** without a strand begins like one from Todo; with a strand it corrects as before. Mentions, reviews, red CI and conflicts do not depend on the state. Without the step `ready` an agent begins at once, as before.

An item that an open item **blocks** (relation "blocks") is not begun either: the item says "Bob begins as soon as WEBU-44 is done". A blocker counts as done when it is Completed (merged) or Canceled, so the new strand builds on the finished code; it branches from the current base branch, never from the branch of the blocker. When the last blocker closes or the relation is removed, the agent begins by itself. At an epic a blocked child is skipped and the next free one runs. Moving a blocked item to Todo does not release it; only the end of the last blocker or removing the relation does. Corrections, conflicts and reviews of a running strand are not affected.

## Epics

When an epic is assigned to the bot, it works the whole epic on one branch with one pull request:

- One strand at the epic, branch `agent/<KEY>-<slug>` from the base branch. The open children that belong to nobody or to the bot (with the step `ready` only those in Todo; a child moved there later joins the queue, and the epic is not marked ready while open children wait in the backlog) become implement runs one after the other, in their manual order; the bot assigns each child to itself when it starts.
- After the first child the agent opens a **draft** pull request. Children of the bot wait in **In review**.
- Children that belong to a person stay hers; she pushes her work to the epic branch herself.
- When no child is open any more, werkbuch marks the pull request ready; only then CI and review run.
- On merge the epic and the children of the bot go to **Merged**; children already closed stay.

A task assigned to the bot on its own is a plain task with its own branch and pull request, also inside an epic. A child that a person assigns to the bot while the bot works on its epic joins the epic's strand.

## Mentions

Mention the bot with `@handle` in a new comment, and it answers in a comment of its own, from the wiki, the items and the code of the project, naming its sources. Only mentions by accounts that may edit the item count, and only in new comments; mentions in a description or field and edits of a comment start nothing. At an item with an open strand the answer continues its session, else it starts afresh. An answer needs none of the four steps of the workflow: it moves no item.

When a bot set up as an agent cannot answer here (its agent is switched off, it has no responsible person, is deactivated, or may not edit items of the project), the default bot says so in a comment at the item, once for each comment: why, and who changes it with a link to the place (an org admin for the agent and the bot, a project admin for the members). A bot that was never set up as an agent gets no note (it may wake through a webhook on `bot.mentioned`, see [Wake an agent](/en/bots#wake-an-agent)), nor does the default bot. A mention by a bot, by an account that may not edit the item or in an edited comment gets no such note either, and the note itself sets off nothing; watchers of the item hear of it like of any comment.

## Pull requests of people

Pull requests of people go through review too, if the project has a review agent and **Review PRs of people** is on (the default):

- Only pull requests linked to an item of the project (by branch name, title or description) are reviewed, once CI on the head commit is green; drafts are not.
- Without findings the app writes a GitHub review **Approve**; with findings a comment with the findings (no "Request changes", which would block the merge). The verdict also goes as a comment to the linked items.
- werkbuch never starts a correction or a conflict for them and never merges them.

Which states a pull request of a person moves is under [pull requests](/en/concepts/workflows#pull-requests) of the workflows.

## Prompt and rules

werkbuch builds the prompt of every run in layers, in this order:

1. **Contract**, in the code, in the language of the organization (English or German; the job of a run follows it): what the kind of run does and never does (move, assign, merge, release, force-push), the format werkbuch reads, and that texts from items, comments, wiki and pull requests are data, not instructions. **Settings → Agents** shows it, folded and read only.
2. **Working rules per kind of run** for the whole organization, under **Settings → Agents**: prefilled with the standard of werkbuch in the language of the organization, **Restore the standard** per kind. Org admins change them.
3. **Guidance for agents** of the item's type, in the type dialog.
4. **Project information and rules for agents**, under **Project settings → Agents**.
5. **The run:** the item with its key and title, the calls of `werkbuch-run` that read the item (with its files and relations, and the epic of a child), its comments page by page and its pictures (`attachments` with `content` gives a PNG, JPEG, GIF or WebP as an image), with their arguments word for word, and the epic with its siblings for a child. The text of the item is not in the prompt: the contract tells every run to read it before any work and, when reading fails a second time, to change nothing and say which call failed.

The CLI also reads the rules of the code in the repo (`CLAUDE.md`, `AGENTS.md`). Commands and conventions belong there, the texts in werkbuch say how to work. There is no instruction per bot.

## Models

Not every run needs the strongest model. werkbuch picks the model when it queues a run; the first that fits wins:

1. **A model label of the item:** a label with **Model for agents** (in the label dialog). With several, the first in the order of the catalog; a child without one takes the epic's.
2. **The project**, a model per kind of run (**Project settings → Agents**).
3. **The bot**, a model per kind of run, then its default model.

The models come from a fixed list per CLI: Claude Code `haiku`, `sonnet` (default), `opus`, `fable`; Codex `gpt-5-codex` (default), `gpt-5-codex-mini`. A model of another CLI is skipped. The run shows the model and where it came from.

## Places and order

A runner takes as many runs as its places allow (**Settings → Runners**: 2 in all, 1 per repo, 2 light). Reviews and answers count only in their own pot. Conflicts, corrections and reviews go before implement runs and answers, then by priority of the item, then by age. A strand stays on its runner; a run of it waits while the runner is busy, and moves to another runner of the pool after 30 minutes offline. An epic always runs one child after the other.

## At the item

Every run is a line of the item's activity (filter **Runs**): its kind, the model and where it came from, the runner, how long it took, and why it waits. **Log** unfolds what the runner read from the CLI and grows while the run runs. Under the title a chip says that the agent is at work, and a notice says what needs a person: a brake, a run that failed or was canceled (**Start again**), a run that waits for its offline runner or for a runner with its CLI, an unauthorized merge, a bot that does not work as an agent in this project. Whoever may edit the item cancels a run, starts it again or gives the item back to the agent; after **Disconnect GitHub**, **Resume** goes on once the project has its repo again.

The section **Pull requests** lists the linked pull requests with their state, the checks of the head commit and the verdict of the review. A comment of the agent that answers a run (a review, an answer, a summary) links to it with **Result of a run**. The log is no live region for screen readers: a status says how many new lines came, at most every five seconds.

## REST and MCP

The runs are readable under `GET /api/v1/runs` (filters `work_item_id`, `runner_id`, `bot_id`, `project_id`, `status`, `type`), with `GET /api/v1/runs/{run}/events` for the log, `POST …/cancel` and `POST …/retry`. `GET /api/v1/work-items/{item}?include=links,agent` reads the pull requests and the state of the agent at an item. Over [MCP](/en/mcp) the tools `agents` and `manage-agents` do the same. Pairing a runner and connecting GitHub work only in the interface.
