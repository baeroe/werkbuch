# Bots

A bot is an account for a script or an AI agent. It has no login and no password. It works through tokens, over the [MCP server](/en/mcp) and the REST API. Otherwise it behaves like a person: it can be a member of projects, get items assigned and appears in the history under its own name. The interface calls every bot "Bot", even when it belongs to a person.

This page covers the basics, how a [webhook](/en/webhooks#agents) wakes an agent and how the agent then works over [MCP](/en/mcp).

## Create a bot

Only org admins create bots: **Settings → Bots → Create bot**.

- **Name** is what people see.
- **Handle** has 3 to 32 characters (a–z, 0–9 and hyphen) and is unique among all accounts. People mention the bot with it, for example `@kira`.
- **Description** says what the bot is for, so others know why it exists.
- **Responsible person** is the person to turn to when the bot does something unexpected. By default that is you.

Bots have no e-mail address, and they get no notifications; mentioning a bot or assigning it an item sends the webhook events `bot.mentioned` and `bot.assigned` instead (see below). A bot cannot be the lead of a project; the lead is always a person.

## Give it access

A bot sees and does only what its roles allow, like a person. The organization role of a new bot is member. To let it work in a project, add it as a member of that project, in the project settings. Org admins can change the role of a bot like that of a person, and deactivate it.

## Tokens

A bot works with a token. Only org admins create tokens for bots: open the bot in the settings and choose **Create token**. A token has a name, abilities and an optional expiry date. werkbuch shows it only once, right after you created it, so copy it then. If it is lost, revoke it and create a new one.

The abilities are `read`, `write` and `mcp`; see [roles and permissions](/en/concepts/permissions#tokens). Give a bot only what its job needs, and one token per script, so you can revoke them one by one. Tokens can only be created from the interface, not with another token.

Deactivating a bot deletes all its tokens. Activating it again does not bring them back.

## Wake an agent

An agent learns about its work through a [webhook](/en/webhooks) that is set to **Only for one bot**. Such a webhook gets `bot.assigned` when someone else assigns an item to the bot (a bot that takes an item itself gets none), `bot.mentioned` when someone mentions it with `@handle`, and the changes and comments of items assigned to it, each with the item in `data`. It gets them only while the bot is active and sees the project: remove the bot from a private project, and its webhook hears nothing more from there. Like everything else, `data` is written for the bot, so it never names an item the bot may not see.

The agent then works with a token of its bot over [MCP](/en/mcp#agent-scenario); the token needs `mcp`, `read` and, to change anything, `write`. `whoami` tells it which account the token belongs to, `work-items:get` reads the item (the description as Markdown), `manage-comments:add` reports what it did and `manage-work-items:transition` moves the item on. Every change shows up in the history under the name of the bot, with `via: mcp`. A script without an MCP client does the same over the [REST API](/en/api): `GET /api/v1/me`, `GET /api/v1/work-items/{item}`, a comment and a transition.

## The default bot

Every organization has one default bot, named "Automation". Automations and the schedules of templates act on its behalf, so their changes show up in the history under its name.

The default bot is an **org admin**, and that is intended: an automation has to be able to act in every project. That makes its tokens powerful. A token always acts with the rights of its account, so **a token of the default bot has admin rights everywhere**. The interface warns you when you create one. Create such a token only when you need it, and treat it like an admin password.

You can rename the default bot. Its role stays admin, it stays active, and you cannot deactivate it. It is not a member of any project unless you add it to one explicitly.
