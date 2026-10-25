# EditTrace

EditTrace is a browser editor that connects to your own model server. Paste a draft, protect the details that must survive, and review every change before using the result.

The original stays on the left. The right starts empty and fills as tokens arrive, one passage at a time. Removed words are struck through in red; additions are highlighted in green. Markdown has a source view and a lightweight reading preview.

[Open EditTrace](https://rajmayank.github.io/EditTrace/)

## Use it

1. Start LM Studio's local server, or an OpenAI-compatible server you control. Enable CORS for the editor's origin.
2. Open **Connect a model**, choose a provider preset or enter a base URL, and select **Test connection**. The status appears directly below the button. Choose a default model from the discovered list, or enter its ID manually.
3. Paste a draft or import a `.md` or `.txt` file. Choose a preset, adjust the instructions if needed, and select **Edit draft**.
4. Review the changes, then copy or export the result. `⌘ Enter` or `Ctrl Enter` starts an edit; the same shortcut stops a running edit.

Use a text model that follows system instructions and copies protected markers accurately. A non-reasoning model is usually a better fit for short editing passes. Model quality still matters outside protected passages.

## Keep the details

- **Lock any selection.** Select text in Source and choose **Lock selection**. Blue highlighting shows what is protected. Editing that source text manually removes its selection lock.
- **Keep Markdown structure.** Recognized headings, fenced code, tables, front matter, list and quote markers, emphasis notation, line breaks, inline code, and links are protected automatically. Complete inline links, including their labels, stay unchanged.
- **Keep signatures.** Email mode detects common closings and explicit signature separators, then protects the signature and quoted thread. Select unusual signatures manually.
- **Keep numbers.** Values, dates, and percentages are protected by default. Each automatic rule can be switched off in **Protected passages**.

Paragraph separators stay outside generation. Editable passages are processed separately, with long passages split at safe boundaries. Protected ranges become unique markers. Every marker must return exactly once and in the original order before the original text is restored.

A failed passage gets one retry. If it still fails, EditTrace retains that original passage and flags it. Stopping an edit keeps completed passages and restores any unfinished passage. Copy and export stay disabled during generation.

Detection is based on recognizable syntax, not a complete understanding of every Markdown extension or email format. Check the blue ranges before editing. Locks preserve literal text; they do not verify the meaning of the surrounding rewrite. The model sees each editable passage without the rest of the article.

## Connection and storage

The browser sends requests directly to the provider you choose. EditTrace has no background service, server-side draft storage, account, or analytics. Your provider receives the editable passages you submit and any key needed to authenticate. Protected text is masked before submission. The provider's own storage policy still applies.

The presets use these documented OpenAI-compatible endpoints. Each server must allow browser requests from EditTrace's origin.

| Preset | Default base URL | Setup |
| --- | --- | --- |
| LM Studio (Local) | `http://localhost:1234/v1` | Start the server and enable CORS. [Docs](https://lmstudio.ai/docs/developer/openai-compat) |
| Ollama | `http://localhost:11434/v1` | Set `OLLAMA_ORIGINS` for the editor's origin and restart. [Docs](https://docs.ollama.com/api/openai-compatibility) |
| llama.cpp | `http://localhost:8080/v1` | Run `llama-server` and allow the editor's origin. [Docs](https://github.com/ggml-org/llama.cpp/tree/master/tools/server) |
| vLLM | `http://localhost:8000/v1` | Use a chat-capable model and your server's address. [Docs](https://docs.vllm.ai/en/latest/serving/online_serving/) |
| OpenRouter | `https://openrouter.ai/api/v1` | Supply an API key and choose a text model. [Docs](https://openrouter.ai/docs/quickstart) |
| External | Your base URL | Use an endpoint with `/models` discovery and streamed `/chat/completions`. |

Saved configurations are checked again after refresh. A successful stream also updates the connection badge. **Disconnect** clears the selected model and API key, removes any remembered key, and stops automatic reconnection. Switching provider presets clears the previous provider's key.

Connection settings and the current instructions are saved in browser storage. API keys stay in memory unless **Remember API key on this device** is enabled. Saving a key uses browser local storage, not an encrypted vault.

Drafts and the last 12 edits stay in the tab by default. **Save drafts on this device** opts into browser storage. Turning it off removes saved drafts and history. Clearing browser storage removes saved settings too. The Markdown preview is sanitized and does not load external images.

GitHub Pages uses HTTPS. Remote model servers need HTTPS and must allow the editor's origin through CORS. Local connections also depend on the browser's mixed-content and local-network rules. Allow local-network access if prompted. If the browser still blocks the request, run the editor locally. Disabling browser security is not required.

## Run locally

Use Node.js 22.12 or newer.

```sh
git clone https://github.com/rajmayank/EditTrace.git
cd EditTrace
npm ci
npm run dev
```

Open the local URL printed by Vite. For a production build:

```sh
npm test
npm run build
npm run preview
```

The app builds to `dist/` and uses relative asset paths, so it can run under a GitHub Pages project path or another static host. No environment variables or server credentials belong in the build.

For browser checks, install Chromium once, then run the workspace suite:

```sh
npx playwright install chromium
npm run test:e2e
```

The suite uses a local simulated model server. It exercises incremental streaming, connection results, refresh and disconnect, selection locks, signature-preserving exports, tall screens, mobile panels, both themes, and reduced motion. Provider defaults follow the linked documentation; the suite does not make live requests to those providers. Screenshots are saved in `test-results/`. CI keeps the browser report and screenshots for seven days.

## Deploy and contribute

The Pages workflow tests and builds pushes to `main`, then uploads and deploys the static artifact. In repository **Settings → Pages**, choose **GitHub Actions** as the source. Pull requests run the checks without deploying.

React and TypeScript provide the interface, CodeMirror handles source editing, and local diff computation marks the changes. The protection, passage planning, streaming parser, and edit runner live in `src/core/`. Tests exercise lock failures, recovery, cancellation, stream parsing, storage choices, and the editor flow with a simulated model API.

Keep changes focused. Add regression coverage when changing protection or request handling. Run `npm test` and `npm run build` before opening a pull request. To report a connection problem, include the browser, server version, endpoint type, and error message. Leave drafts and API keys out of issue reports.

EditTrace is licensed under [Apache 2.0](LICENSE). Third-party dependencies retain their own licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
