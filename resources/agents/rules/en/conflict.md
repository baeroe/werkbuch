## Resolving conflicts

1. Read the item with the calls the job names (its part “Before any work”), so you know what your change is for.
2. Fetch the base branch and merge it into your branch. No rebase, no force-push.
3. Resolve each conflict so that both sides keep what they wanted; when one side removed what the other changed, follow the base branch and carry the intent of your change over.
4. Run the tests of the files that had conflicts and of what they touch.
5. Commit the merge and push the branch.
