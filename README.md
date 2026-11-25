# Ramo

Ramo is a local-first Windows desktop assistant with chat, research, file and shell tools, optional local memory, and support for your own cloud-provider keys. Ollama models run on your computer; no model weights or personal chats are bundled.

## Install and run (Windows x64)

1. Download the public Windows ZIP and extract all of it to a folder you can write to.
2. Open **Ramo → ramoresearchresponsiveuinativeeditor.exe**. No launcher script or installation is required.
3. Ramo opens **Setup** automatically when configuration is incomplete.
4. If Ollama is not detected, use **Start Ollama** or **Download Ollama**. If it runs on a non-default loopback port, edit the port and refresh. Install models you choose from [Ollama's library](https://ollama.com/library), based on your own RAM/VRAM and each model's license:
   ```powershell
   ollama pull <model-id>
   ```
   Ramo does not recommend or download LLM weights automatically. Cloud API models can be used instead.
5. Back in Ramo, choose **Refresh detection**, assign Fast, Smart and Super Smart, then **Finish setup**.

Keep the extracted folder together: the executable needs its adjacent DLLs, `resources`, and `locales`. Ollama and its models are the only separate runtime pieces. Ramo does not download model weights automatically.

## Search and cloud providers

- **AnySearch** is the primary web-search provider. With no key Ramo tries its direct anonymous API; a saved AnySearch key is used when present. Anonymous availability and limits are controlled by AnySearch.
- **Tavily** is an optional reserve and is called only when its key is set and AnySearch fails.
- Cloud-model key slots support **OpenAI, OpenRouter, Anthropic, Google Gemini, and NVIDIA**. After saving a key, add an API model from the model picker and enter the provider's model ID.
- Search keys stay in the app's local storage. Cloud keys use the native encrypted provider store. Fields are masked; keys are not included in chats or exports.

Return to **Settings → Setup** to change tiers or keys. Setup remains visibly incomplete until Ollama is reachable and at least one model is detected.

## Build from a clean clone

Use Node 22.19+ and npm on Windows x64. The bootstrap downloads unmodified Electron, Node, ripgrep, fd and native npm runtime inputs; versions and archive SHA-256 values are pinned in `tools/bootstrap.cjs`. Artwork and detector inputs are repository files.

```powershell
npm ci
npm run bootstrap
npm run check
npm run build
npm test
node tools/stage.cjs
node tools/verify.cjs
```

The runnable app is written to `release/Ramo`. Start `ramoresearchresponsiveuinativeeditor.exe` directly. These checks are model-free; they do not establish model quality or live search availability.

To create a ZIP after verification, archive the **contents** of `release/Ramo` (or archive the `Ramo` folder) without adding profiles, `.env` files, chats, or other local data.

## Local document, voice and speech tools

On first document use Ramo creates a per-user Python environment with pinned MarkItDown and LiteParse packages. If a scanned PDF has too little text, Ramo automatically downloads **OCRia-nano-1** (an 8.1M-parameter CPU document parser, not an LLM) through LiteParse and uses it locally. It never sends OCR to Ollama or a cloud/vision model. The first OCR download is about 60–75 MB. OCRia-nano-1 has a [separate model license and use restrictions](https://huggingface.co/llamaindex/OCRia-nano-1/blob/main/LICENSE); review them before OCR use. Local TTS and STT are opt-in and set themselves up inside the app when enabled.

## Network behaviour and status

Ramo has no analytics, telemetry, crash upload or automatic-update service. Network access occurs for document downloads, optional AnySearch/Tavily search, user-configured cloud models, and first-time tool/runtime setup. Search query text goes directly to the selected search provider, never through a Ramo-operated relay. The executable is unsigned, so Windows SmartScreen may warn; verify the release SHA-256 before running it.

This is an early Windows-x64 public build. Model quality, arbitrary Ollama-model compatibility and live-search availability are not guaranteed. The test suite is model-free and is not a semantic-quality benchmark. Support is best-effort, without an SLA.

## More information

- [First-run guide](docs/FIRST_RUN.md) and [Troubleshooting](docs/TROUBLESHOOTING.md)
- [How the core presents messages, tools, status and thinking](docs/core-information-display.md)
- [Security policy](SECURITY.md) and [Changelog](CHANGELOG.md)
- Runtime, local models and provider settings are stored in the operating system's per-user application-data location, not in the extracted app folder.
- Ramo's agent kernel is derived in part from Pi 1.4.0 (MIT). Third-party notices and license files are included.

## License

Apache-2.0. See [LICENSE](LICENSE). Third-party components retain their own licenses.
