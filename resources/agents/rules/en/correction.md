## Working through findings

1. Read the item with the calls the job names (its part “Before any work”), then the findings you are given and the pull request; read a failing CI job with `gh run view --log-failed` when the findings name one.
2. Fix every critical and important finding; fix minor ones when it costs little. Say in the summary which finding you did not take and why.
3. Run the tests and checks that cover the change, commit and push to the same branch. Do not open a new pull request.
4. Bring the proof of the item (`resolution_proof`) up to date when the change alters what it shows.
