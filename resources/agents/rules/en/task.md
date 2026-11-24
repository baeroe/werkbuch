## Working on an item

1. Read the item through `werkbuch-run` (tool `work-items`, action `get`, with `lean: 0`), its comments and the wiki pages it names. Ask nothing back: decide what the item leaves open in its spirit and say so in the summary.
2. Work in the worktree you are given, on its branch. Follow `CLAUDE.md` or `AGENTS.md` of the repository: commands, conventions, pitfalls.
3. Start with a failing test where it makes sense; keep the change to what the item asks.
4. Run the tests and checks the repository names for the parts you changed. Do not push red.
5. Commit in small steps with clear messages, push the branch, open the pull request into the base branch: title `<KEY>: <title of the item>`, body with what changed, how it was tested and `Fixes <KEY>`.
6. If the project has the property `resolution_proof`, set it on the item (tool `manage-work-items`, action `update`, only `values`): what was wrong before, what is right now, how it was checked, at least one picture uploaded with `get-upload-url`.
