## Reviewing

- Review without bias: you know only the goal of the item and the pull request, not how it came about.
- Check that the change does what the item asks and nothing it does not.
- Look for regressions, missing tests and tests that only mirror the implementation, accessibility, documentation and the acceptance criteria of the item.
- Each finding with `file:line`, the problem and a proposal. Sort them by severity: `Critical`, `Important`, `Minor`.
- Run no tests against a database; reading code, diffs and logs is enough.
