# EditTrace

EditTrace lets you edit Markdown, email, and plain text with your own language model. Lock the details that must stay unchanged, stream a revision beside the original, and review the diff before using it.

It runs entirely in your browser and connects directly to your model provider. No account, app backend, or bundled model is required.

[Open EditTrace](https://rajmayank.github.io/EditTrace/) · [Contribute](CONTRIBUTING.md) · [Report an issue](https://github.com/rajmayank/EditTrace/issues/new)

- **See what changed.** The original stays on the left; the right starts empty and fills as tokens arrive. Removals are red and struck through, additions are green, and protected text is blue.
- **Choose the editing pass.** Start with Technical article, Markdown edit, Email polish, or Light copyedit. Change the system prompt when you need different instructions.
- **Protect what matters.** Select your own facts or use automatic rules for Markdown structure, signatures, and numbers. A failed check gets one automatic retry, then the original passage is retained and flagged.
- **Review at your own pace.** Switch between source, diff, and sanitized Markdown preview. Link scrolling to keep corresponding blocks in view, or scroll each pane independently. Retry individual retained passages, copy or export the result, and use an edit as the next draft.
- **Keep the workspace comfortable.** Light and dark themes, responsive panels, keyboard controls, and reduced-motion support work alongside live word counts, reading estimates, and output speed.

## Start editing

1. Start LM Studio's local server or choose another OpenAI-compatible provider. Enable CORS for the editor's origin, `https://rajmayank.github.io` when using GitHub Pages.
2. Open **Connect a model**, choose a preset or enter your server URL, and select **Test connection**. Check the status below the button, then choose a discovered model or enter its ID.
3. Paste a draft, or import or drop a `.md` or `.txt` file. Choose an editing preset and adjust **Instructions** if needed.
4. Check the blue protected ranges, add any fact locks, and select **Edit draft**. Review the result before copying or exporting it.

`⌘ Enter` or `Ctrl Enter` starts an edit and stops one in progress. Stopping keeps completed edits and restores the unfinished passage. Copy and export become available when generation ends.

Choose a model that follows system instructions and copies protected markers accurately. The model sees one editable passage at a time, without the rest of the article. It can still change the meaning of unlocked text.

## Connections

The connection dialog includes these presets. Local defaults can be changed to a server address.

| Provider | Default base URL | Setup |
| --- | --- | --- |
| [LM Studio](https://lmstudio.ai/docs/developer/openai-compat) | `http://localhost:1234/v1` | Start the server and enable CORS. |
| [Ollama](https://docs.ollama.com/api/openai-compatibility) | `http://localhost:11434/v1` | Set `OLLAMA_ORIGINS` for the editor's origin and restart. |
| [llama.cpp](https://github.com/ggml-org/llama.cpp/tree/master/tools/server) | `http://localhost:8080/v1` | Run `llama-server` and allow the editor's origin. |
| [vLLM](https://docs.vllm.ai/en/latest/serving/online_serving/) | `http://localhost:8000/v1` | Serve a chat-capable model. |
| [OpenRouter](https://openrouter.ai/docs/quickstart) | `https://openrouter.ai/api/v1` | Supply an API key and choose a text model. |
| External | Your base URL | Support `/models` discovery and streamed `/chat/completions`. |

Saved connections are checked again after refresh. A successful edit also updates the connection badge. **Disconnect** clears the selected model and API key, removes any remembered key, and stops automatic reconnection. Switching provider presets clears the previous provider's key.

Remote servers need HTTPS when used from GitHub Pages and must allow the editor's origin through CORS. Local connections also depend on browser permissions. Allow local-network access if prompted. If the browser still blocks your local server, [run EditTrace locally](#run-locally).

## Protection and recovery

Select text in **Source**, then choose **Lock as fact** beside the selection or **Lock selection** in the toolbar. This works across document types. Editing inside a fact in the source removes its manual lock.

**Protected passages** explains each automatic rule and lets you turn it off. Markdown protects recognized code blocks, tables, front matter, links, and formatting markers. Numbers, dates, and percentages are protected by default. Email mode detects common signatures and quoted threads; select unusual signatures manually.

Heading wording stays editable. For `# A closer look at connection limits`, the `# ` prefix and line break are protected. The title can change unless you lock it yourself. Complete links, including their labels, stay unchanged.

Protected ranges are replaced with unique markers before a passage goes to the model. Each marker must return exactly once, in order, before EditTrace restores the original text. Paragraph separators stay outside generation. Checks also reject structural changes, severe shortening, and unexpected formatting such as added HTML.

If a passage fails twice, its original text stays in the result. Open the collapsed summary at the bottom of **Edited** to see excerpts and reasons in a bounded, scrollable list. **Show passage** locates the text. **Retry** runs only that original passage with your current model, instructions, and locks; accepted edits stay in place. A failed or stopped retry keeps the previous result and flag.

These checks preserve literal text and recognized structure. They don't verify factual accuracy or cover every Markdown extension and email format. Check the protected ranges and read the revision.

Scrolling is linked by default on side-by-side layouts. The chain button between the panes switches it off or on, and the choice stays in this browser. Headings, paragraphs, lists, and code blocks align by document order; movement within a rewritten block is proportional. This works across Source, Changes, Preview, and Read. During streaming, alignment stops at received content. On mobile, the visible pane scrolls independently.

## Live metrics

Both panels update word counts and estimated reading time as you type or receive output. [reading-time](https://github.com/ngryman/reading-time) counts readable content extracted with Marked, excluding Markdown notation, hidden link destinations, front matter, and comments. Estimates use 200 words/min for prose, 100 for code, and a small viewing allowance for images. Images are never fetched. The [calculation](src/core/reading.ts) is a heuristic; actual reading speed varies.

Output words/min and elapsed time are measured in the browser during generation and freeze when it finishes or stops. The rate includes waiting and retries, excludes protected text restored locally, and measures words received rather than the server's token decoding speed. A passage retry starts a new measurement.

## Privacy and storage

Requests go directly from your browser to the provider you choose. EditTrace has no relay, account, analytics, or server-side draft storage. The provider receives editable passages and any authentication key; protected ranges are masked. Your provider's storage policy still applies.

| Data | Default behavior | Control |
| --- | --- | --- |
| Connection settings, instructions, theme, and protection preferences | Saved in this browser. | Clear browser storage to remove them. |
| API key | Kept in memory. | **Remember API key on this device** saves it in browser local storage. |
| Draft and last 12 edits | Kept in the current tab. | **Save drafts on this device**, above the editor, saves them locally, including review flags and completed generation metrics. |

Turning draft saving off removes persisted drafts and history. Browser storage is not an encrypted vault. Markdown previews are sanitized and don't load external images. **Feedback** opens a GitHub issue without attaching your draft, credentials, or connection settings.

## Run locally

Use Node.js 22.12 or newer.

```sh
git clone https://github.com/rajmayank/EditTrace.git
cd EditTrace
npm ci
npm run dev
```

Open the local URL printed by Vite. To check and preview a production build:

```sh
npm test
npm run build
npm run preview
```

For browser checks, install Chromium once, then run Playwright:

```sh
npx playwright install chromium
npm run test:e2e
```

The browser suite uses a local simulated model API, so it needs no model download or provider key. See [CONTRIBUTING.md](CONTRIBUTING.md) for code layout, validation, and pull request guidance. Report credential or preview vulnerabilities through the route in [SECURITY.md](SECURITY.md).

## Deploy and contribute

EditTrace builds to `dist/` with relative asset paths and can run on GitHub Pages or another static host. No model credentials belong in the build. For Pages, set **Settings → Pages → Source** to **GitHub Actions**. The [workflow](.github/workflows/pages.yml) checks pull requests and deploys successful builds from `main`.

Issues, focused fixes, documentation, and usability improvements are welcome. Submit a pull request to `main` with the problem, resulting behavior, and relevant validation. [Mayank Raj](https://mayankraj.com/) maintains the project and reviews contributions. The [contribution guide](CONTRIBUTING.md) covers the details; maintainers can apply the prepared [repository protection rulesets](.github/rulesets/README.md).

EditTrace is licensed under [Apache 2.0](LICENSE). Dependencies retain their own licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
