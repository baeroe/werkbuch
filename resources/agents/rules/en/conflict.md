## Resolving conflicts

1. Fetch the base branch and merge it into your branch. No rebase, no force-push.
2. Resolve each conflict so that both sides keep what they wanted; when one side removed what the other changed, follow the base branch and carry the intent of your change over.
3. Run the tests of the files that had conflicts and of what they touch.
4. Commit the merge and push the branch.
