# Contributing

Open an issue for a behavior change that needs discussion. For fixes, describe the trigger, expected result, and actual result in the pull request.

Use Node.js 22.12 or newer, run `npm ci`, then `npm run dev`. Run `npm test` and `npm run build` before submitting.

Keep interface copy brief. Protection must fail closed: after a retry, retain the original affected passage and show the failure. Add a regression test when changing that behavior. Never commit drafts, credentials, or server logs containing either.

Contributions are provided under the repository's Apache 2.0 license.
