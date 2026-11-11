---
layout: home

hero:
  name: werkbuch
  text: Project management you host yourself.
  tagline: Work items with your own types, fields and workflows, a wiki per project and views across all of them. Made for the keyboard, and open to scripts and AI agents through a REST API, MCP and webhooks.
  image:
    light:
      src: /screenshots/en/board.png
      width: 1440
      height: 900
    dark:
      src: /screenshots/en/board-dark.png
      width: 1440
      height: 900
    alt: The board of a project, its work items in one column per status
  actions:
    - theme: brand
      text: Setup
      link: /en/setup
    - theme: alt
      text: GitHub
      link: https://github.com/baeroe/werkbuch

features:
  - title: Types and workflows
    details: Task, bug, client request – you decide which types there are, which fields each one has and which states an item goes through. A matrix says which moves are allowed, if you want one.
    link: /en/concepts/types-and-properties
    linkText: Types and properties
  - title: Views
    details: Filter across every project, group by status, assignee or label and save it for the whole team. As a list, board, table or timeline.
    link: /en/concepts/views
    linkText: Views
  - title: Wiki
    details: Every project has its own wiki. Pages in a tree, versions, and references to work items and other pages.
    link: /en/concepts/wiki
    linkText: Wiki
  - title: Templates and automations
    details: Recurring work comes from a template on a schedule. Automations do the small stuff, like closing the epic once its last child is done.
    link: /en/concepts/templates
    linkText: Templates
  - title: Keyboard
    details: Almost everything has a shortcut, and ⌘K finds the rest – items, pages, projects and every command.
    link: /en/keyboard
    linkText: Keyboard
  - title: REST, MCP and webhooks
    details: Everything the app does, the REST API does too. AI agents work through MCP, and webhooks tell your other tools what happened.
    link: /en/api
    linkText: REST API
---

werkbuch is project management for teams that want to keep their data on their own server. It runs as a Docker Compose stack: one image, MariaDB and Meilisearch, one port. The interface is in English and German.

## A look inside

A work item on its own page: description, fields, relations, the wiki pages that mention it and the whole history.

![The page of the work item WEB-47 with its description, fields, relations and activity](/screenshots/en/item.png)

⌘K searches work items, wiki pages and projects at once, and runs every command.

![The command palette searching for WEB, with work items, wiki pages and the project](/screenshots/en/palette.png)

And the same page in the dark.

![The page of the work item WEB-47 in the dark theme](/screenshots/en/item-dark.png)

<SelfHost />

## Status

v0.1.0 is the first release: the image `baeroe/werkbuch` is on Docker Hub for `linux/amd64` and `linux/arm64`, what changed is under [Releases](https://github.com/baeroe/werkbuch/releases). How to run werkbuch on a server is covered by [Setup](/en/setup), [Reverse proxy](/en/reverse-proxy), [Operations](/en/operations), [Upgrading](/en/upgrading) and [Backup](/en/backup), working on the code by the [development page](/en/development). How everything works is under [Concepts](/en/concepts/permissions).
