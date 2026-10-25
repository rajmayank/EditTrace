# Contributing to EditTrace

Contributions are welcome: fixes, documentation, accessibility improvements, and clearer editing flows all help. Keep each pull request focused on a problem someone can reproduce or a behavior someone can evaluate.

For a larger feature or a change to protection, storage, or provider support, open an [issue](https://github.com/rajmayank/EditTrace/issues/new) to discuss the approach first. A focused fix can go straight to a pull request.

## Report a problem

Include what you did, what you expected, and what happened. For connection issues, add the browser, model server and version, endpoint type, and visible error. For editing failures, a short, synthetic `.md` or `.txt` example is more useful than a private article.

Leave API keys, private drafts, and logs containing either out of public issues and commits. Use the route in [SECURITY.md](SECURITY.md) for vulnerabilities involving credentials, preview content, or protected-text leakage.

## Set up a checkout

Use Node.js 22.12 or newer.

1. Fork the repository and clone your fork.
2. Create a branch for your change.
3. Install dependencies and start Vite:

   ```sh
   npm ci
   npm run dev
   ```

Open the local URL Vite prints. Point the app at your own model server when checking real model behavior. Automated tests use a simulated API and need no provider key.

The main boundaries are:

| Area | Location |
| --- | --- |
| Workspace, dialogs, and app state | `src/App.tsx` |
| Source editing and fact selection | `src/Editor.tsx` |
| Sanitized Markdown preview | `src/Preview.tsx` |
| Retained-passage review | `src/RetainedReview.tsx` |
| Protection, passage planning, requests, and retries | `src/core/` |
| Unit and component tests | `tests/` |
| Browser tests and simulated API | `e2e/` |
| CI and GitHub Pages deployment | `.github/workflows/pages.yml` |

## Keep the editing contract

- **Keep the app static.** Requests go directly from the browser to an OpenAI-compatible endpoint. Changes must work on GitHub Pages without an app backend or credentials embedded in the build.
- **Preserve protected text.** Markers must return exactly once and in order. A failed check gets one automatic retry, then retains the original affected passage and exposes the reason.
- **Contain recovery.** Retrying one passage must preserve accepted edits elsewhere. Failure or cancellation must keep the previous result and its review flag; stopping a full edit must keep completed work.
- **Keep storage choices explicit.** API keys stay in memory and drafts stay in the tab by default. Persisting either requires the corresponding opt-in. Preserve the ability to remove saved data.
- **Keep previews safe.** Sanitize rendered Markdown and keep external images from loading. Use synthetic content in fixtures and screenshots.
- **Keep the interface lean.** Check keyboard access, responsive layouts, both themes, and reduced motion. Use existing color tokens and Lucide icons, and keep copy brief.

The supported imports are `.md` and `.txt`. Automatic protection recognizes syntax, not meaning. Don't describe a formatting check as factual verification or promise that a model cannot change unlocked claims.

## Validate the change

For code changes, run:

```sh
npm test
npm run build
```

For changes to the interface, streaming, connections, or protection flow, also run the browser suite:

```sh
npx playwright install chromium
npm run test:e2e
```

Add a regression test when fixing a behavior that could recur, especially protection, retries, cancellation, or request handling. Test the observable result. Documentation-only changes need checked commands, links, and factual claims; they don't need new app tests.

The build checks TypeScript and generates dependency license notices. Browser tests exercise a simulated model API, not live provider compatibility. Screenshots are written to `test-results/`; CI retains browser reports and screenshots for seven days.

If you add a runtime dependency, pin its version, include the lockfile change, and update [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Explain what the dependency solves and check its license.

## Submit a pull request

Target `main`. Describe the concrete problem, what changes for the user, and the validation you ran. For interface changes, include screenshots in both themes and a narrow layout where relevant. Name any behavior you couldn't verify.

`@rajmayank` is the code owner for all files and reviews contributions. Resolve review conversations and pass the GitHub Actions **check** job before merging. Pull requests run validation without deploying; successful builds from `main` deploy to GitHub Pages.

The repository includes [ruleset payloads and an activation guide](.github/rulesets/README.md) for owner review and required CI. Those files alone don't enable GitHub enforcement; a repository administrator must apply the settings.

Contributions are provided under the repository's [Apache 2.0 license](LICENSE).
