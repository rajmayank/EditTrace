export const PROVIDERS = [
  { id: 'lmstudio', name: 'LM Studio (Local)', url: 'http://localhost:1234/v1', help: 'Start the local server and enable CORS in LM Studio.', docs: 'https://lmstudio.ai/docs/developer/openai-compat', keyRequired: false },
  { id: 'ollama', name: 'Ollama', url: 'http://localhost:11434/v1', help: 'Allow this site’s origin with OLLAMA_ORIGINS, then restart Ollama.', docs: 'https://docs.ollama.com/api/openai-compatibility', keyRequired: false },
  { id: 'llamacpp', name: 'llama.cpp', url: 'http://localhost:8080/v1', help: 'Run llama-server and allow this site in its CORS origins.', docs: 'https://github.com/ggml-org/llama.cpp/tree/master/tools/server', keyRequired: false },
  { id: 'vllm', name: 'vLLM', url: 'http://localhost:8000/v1', help: 'Use your vLLM server address. Remote servers need HTTPS and CORS.', docs: 'https://docs.vllm.ai/en/latest/serving/online_serving/', keyRequired: false },
  { id: 'openrouter', name: 'OpenRouter', url: 'https://openrouter.ai/api/v1', help: 'Add your OpenRouter API key. Requests go directly to OpenRouter.', docs: 'https://openrouter.ai/docs/quickstart', keyRequired: true },
  { id: 'external', name: 'External', url: '', help: 'Enter an OpenAI-compatible base URL. Remote servers need HTTPS and CORS.', docs: '', keyRequired: false },
] as const;
export function providerFor(url: string) { return PROVIDERS.find(p => p.url && p.url === url.replace(/\/$/, '')) ?? PROVIDERS.at(-1)!; }
