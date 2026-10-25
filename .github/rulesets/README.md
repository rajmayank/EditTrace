# Protect main

These files prepare protection for `rajmayank/EditTrace`. Committing them does not activate or synchronize GitHub settings. A repository administrator must apply both rulesets after `.github/CODEOWNERS` reaches `main`.

| File | Enforcement after activation |
| --- | --- |
| [main-reviews.json](main-reviews.json) | Require a PR, one approval from the code owner, dismissal of stale approvals, and resolved review conversations. Only `@rajmayank` can bypass this ruleset, through a PR. |
| [main-checks.json](main-checks.json) | Require the `check` job from GitHub Actions. There are no bypass actors, including the owner. |

The owner bypass permits merging the owner's PRs without self-approval. It also permits bypassing the review and conversation requirements on another contributor's PR. It does not grant a direct-push bypass or skip CI. Keep repository write access limited to trusted collaborators.

## Activate

Use either the GitHub interface or an authenticated GitHub CLI session with repository administration access.

1. Open [Settings → Rules → Rulesets](https://github.com/rajmayank/EditTrace/settings/rules).
2. Choose **New ruleset → Import a ruleset** and import `main-checks.json`. Confirm that enforcement is **Active**, the target is `main`, and the required check is **check** from **GitHub Actions**.
3. Import `main-reviews.json`. Confirm **Active** enforcement and the listed review requirements. Verify the bypass list contains only **rajmayank**, with **For pull requests only**. Set it explicitly if the importer omits bypass actors.
4. Confirm both rulesets appear under [main's rules](https://github.com/rajmayank/EditTrace/rules?ref=refs%2Fheads%2Fmain). CODEOWNERS alone does not require approval.

Alternatively, run these commands once from the repository checkout:

```sh
gh api --method POST repos/rajmayank/EditTrace/rulesets --input .github/rulesets/main-checks.json
gh api --method POST repos/rajmayank/EditTrace/rulesets --input .github/rulesets/main-reviews.json
gh api repos/rajmayank/EditTrace/rules/branches/main
```

If either creation fails, correct the error before continuing. Update existing rulesets in Settings rather than creating duplicates. Keep the required context in sync if the workflow's `check` job is renamed. The `deploy` job is intentionally excluded because it runs after merging.

GitHub documents [ruleset imports](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/managing-rulesets-for-a-repository), [ruleset API permissions and parameters](https://docs.github.com/en/rest/repos/rules#create-a-repository-ruleset), and [CODEOWNERS behavior](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners).
