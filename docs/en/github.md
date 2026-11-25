# GitHub

[Agents](/en/concepts/agents) reach their repos through GitHub apps, one private app per GitHub account: your own account, an organization, or several of them. The app pushes and opens pull requests for the agents, never a person; werkbuch writes reviews and comments with it, reads the checks and merges once CI is green and the review has no findings. GitHub tells werkbuch about pushes, pull requests and checks through the webhook of the app.

Every instance creates its own apps: werkbuch is self-hosted, so there is no shared app. GitHub.com only; GitHub Enterprise Server, GitLab, Gitea, Forgejo and Bitbucket are not supported.

## Before you connect

- `APP_URL` has to be reachable from the internet over HTTPS for `POST /github/webhook`: GitHub delivers its webhooks there (see [the webhook behind the proxy](#the-webhook-behind-the-proxy)). Everything else of the flow runs in your browser.
- You are an owner of the GitHub organization the app shall belong to, or it belongs to your own account and you are signed in to GitHub with it.
- Back up `storage/app/.app-key` (see [Backup](/en/backup)): it encrypts the private keys and the webhook secrets of the apps.

## One app per account

A private GitHub app can only be installed on the account it belongs to. So werkbuch keeps one app per GitHub account: repos of your own account need the app of your account, repos of an organization the app of that organization. Each app has its own installations, tokens, webhook secret and bot account (`<slug>[bot]`); a repo uses the app whose installation reaches it. An account has at most one app in an instance.

## Connect

1. **Settings → GitHub → Connect to GitHub** (org admins), or **Add another app** once the first one is there. Choose **My GitHub account** or **A GitHub organization** and enter its login. werkbuch proposes the login followed by ` werkbuch` as the name (names are unique on GitHub; you can change it there). An account that has its app already is refused.
2. GitHub shows the app with its permissions, webhook address and the way back filled in. Create it. GitHub returns to werkbuch, which keeps the app (ID, private key and webhook secret, encrypted).
3. GitHub asks where to install the app: choose the repos the agents shall work on. It returns to werkbuch again.

The page then shows every app with its installations and its shared repos, each with its project and whether a ruleset protects its base branch. **Change repos on GitHub** of an app adds or removes its repos at GitHub; werkbuch hears it through the webhook, and **Read again** fetches the lists of all apps by hand.

## Permissions

| Permission | Access | For |
|---|---|---|
| Contents | write | clone, push the branches of the agents, merge, delete merged branches |
| Pull requests | write | open pull requests, write reviews and comments, mark a draft ready |
| Checks | read | the check runs of a commit |
| Actions | read | workflow runs and the log of failed checks |
| Commit statuses | read | statuses that CI sets without check runs |
| Metadata | read | always required by GitHub |

The app listens to `pull_request`, `push`, `check_suite` and `check_run`, and GitHub always sends it the events of its installations. When a new version of werkbuch needs a permission an existing app lacks, add it yourself: at GitHub under **Developer settings → GitHub Apps → \<app\> → Permissions & events**, then accept the new permission on every installation of the app (GitHub asks the owner of each one). Until both are done, GitHub refuses werkbuch every token that asks for the missing permission: reading the CI and merging fail.

## Tokens per run

werkbuch never hands out the private key. Each run gets an installation token for the one repo of its project, valid for an hour and renewed by the runner while the run lasts:

| Run | Contents | Pull requests | Checks, Actions |
|---|---|---|---|
| implement, correction, conflict | write | write | read |
| review, answer | read | read | – |

Reviews and answers get no token in the run at all: the runner clones with it and hands the agent the diff and the failed checks as files. Merges, reviews, comments at pull requests and reading checks werkbuch does itself, with tokens of its own.

## A repo for a project

Each project has at most one repo, and a repo belongs to one project at most. Project admins choose it under **Project settings → Agents**, among the repos the apps are installed on (grouped by app):

- **Base branch:** where pull requests go and what werkbuch merges into; empty is the default branch of the repo.
- **Merge method:** squash (default: one commit per pull request), merge commit or rebase.
- **Comment at the PR:** with a new link, the app writes one comment at the pull request with links to the items and keeps it up to date (default on).
- **Review PRs of people:** see [pull requests of people](/en/concepts/agents#pull-requests-of-people).

Without a repo, agents work in a folder of their own and end with a summary as a comment.

## Rulesets

A ruleset on the base branch is optional, and private repos on GitHub's free plan have none. Where you can, set one: pull request required, the CI check green, no bypass. werkbuch merges through the pull request and needs no bypass. Do **not** require an approval: the app cannot approve its own pull request, and its merge would fail. The page of the instance shows per repo whether a ruleset protects the base branch, as a hint only.

With or without a ruleset, werkbuch watches the base branch, see [unauthorized merge](#unauthorized-merge).

## Linking pull requests

A pull request in the repo of a project links to the items it names, in its title, its description (not in code) or its branch name. Only keys of that project count, former identifiers too, in any case:

| In the pull request | Effect |
|---|---|
| `fix`, `fixes`, `fixed`, `fixing`, `close`, `closes`, `closed`, `closing`, `resolve`, `resolves`, `resolved`, `resolving` before keys | links, and closes on merge |
| `ref`, `refs`, `references`, `part of`, `relates to`, `related to` before keys | links, never closes |
| a key without a word, in the text or in the branch name | links, never closes |
| `skip` or `ignore` before keys | takes the link back |

A word may take a colon, several keys go by comma or `and`: `Fixes: WEB-12, WEB-13 and WEB-14`. A key that disappears from title, description and branch keeps its link; only `skip` takes it back. Pull requests of agents carry `Fixes <KEY>` and are linked by their strand anyway.

What a link moves is set in the workflow: [steps of the agents](/en/concepts/workflows#steps-of-the-agents) and [pull requests](/en/concepts/workflows#pull-requests). In short: a draft moves nothing; an open pull request moves its items from Backlog or Unstarted to **In review**; merged into the base branch, it moves the items it closes to **Merged**, unless another pull request at the item is still open. The section **Pull requests** of the item shows each link with its state, the checks of the head commit and the verdict of the review.

## Unauthorized merge

werkbuch knows its own merges. When the app of the repo pushes to the base branch of a project and no merge of werkbuch explains it (a direct push, or a merge through the API with the token of a run), werkbuch

- pauses every strand of the project and cancels its running runs,
- comments at the items whose runs pushed, where it can tell,
- notifies the org admins, and shows a banner under **Project settings → Agents**.

A project admin checks the commit at GitHub, reverts it if needed and chooses **Confirm and continue**; the strands go on with a correction. A ruleset (pull request required, no bypass) keeps such pushes away before they happen.

## Disconnect

**Disconnect** at an app makes werkbuch forget that app: the projects with one of its repos lose it, their open strands pause, their running and waiting runs are canceled; the other apps and their projects stay as they are. Pull requests and branches stay on GitHub, and so does the app until you delete it there (**Settings → Developer settings → GitHub Apps** of the account or organization). To connect the account again you create a new app. Once a project has its repo again, **Resume** at an item continues its strand with a correction.

## The webhook behind the proxy

GitHub sends every event as `POST APP_URL/github/webhook`:

- It has to be reachable from the internet, also when the rest of werkbuch is only reachable through a VPN or behind a login of the proxy. Pass this one path without extra authentication. It is one address for all apps: werkbuch finds the app by `X-GitHub-Hook-Installation-Target-ID`, checks the signature (`X-Hub-Signature-256`) with the secret of that app and answers `401` to anything unsigned or of an app it does not know.
- Bodies reach up to 25 MB. nginx in the image takes 32 MB; allow at least as much at your proxy (`client_max_body_size 32m` for nginx).
- An address that sends 60 unsigned requests in a minute gets `429` before werkbuch reads the body. GitHub itself is never counted.
- werkbuch answers at once with `202` and works the delivery off in the queue; a delivery that GitHub sends again counts once.

GitHub keeps the recent deliveries of the app with their answers: **Settings → Developer settings → GitHub Apps → \<app\> → Advanced**. That is the first place to look when nothing arrives.

## Troubleshooting

- **A repo is missing in the list:** add it under **Change repos on GitHub**, then **Read again**.
- **Pull requests do not link:** the key belongs to another project, stands only in code, or the delivery did not arrive (see the recent deliveries).
- **CI is not seen:** werkbuch reads check runs, workflow runs of GitHub Actions and commit statuses of the head commit. CI that sets none of the three stays invisible, and a missing permission (see [permissions](#permissions)) hides what it covers.
- **The merge fails:** a ruleset asks for an approval, or the base branch moved and the pull request has a conflict (werkbuch then starts a conflict run).
