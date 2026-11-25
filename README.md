# Ramo

Ramo is a Windows desktop assistant for chat, research, documents, and working with local files. Use models installed with Ollama, your own cloud-provider accounts, or both.

## Install and run (Windows x64)

1. Download the Windows ZIP from [Releases](https://github.com/ProOmc/ramo/releases) and extract it.
2. Open **Ramo → Ramo.exe**.
3. Setup opens if anything still needs your attention.
4. For Ollama, choose **Start Ollama** or **Download Ollama**. If your API uses another loopback port, edit it and choose **Refresh detection**. Models can be installed from [Ollama's library](https://ollama.com/library):
   ```powershell
   ollama pull <model-id>
   ```
5. Assign Fast, Smart, and Super Smart, then choose **Finish setup**. Cloud API models are available in all three tiers.

Keep the extracted folder together so `Ramo.exe` can find its DLLs, `resources`, and `locales`.

## Search and cloud providers

- **AnySearch** is the primary web-search provider. It works with an optional API key; anonymous access depends on AnySearch's availability and limits.
- **Tavily** can be configured as a backup when AnySearch is unavailable.
- Cloud-model key slots support **OpenAI, OpenRouter, Anthropic, Google Gemini, and NVIDIA**. Add a model in Setup with its exact provider model ID, or choose one from the provider's catalogue.
- Search keys stay in local app storage, and cloud keys use the native encrypted provider store. Fields are masked and keys are excluded from chats and exports.
- Search requests go directly to the selected provider.

Return to **Settings → Setup** to change models, tiers, endpoints, or keys. Setup can be completed with local models, cloud models, or a mixture of both.

## Documents, voice, and speech

Document tools set up a local Python environment on first use. Scanned documents use **OCRia-nano-1** through LiteParse on your CPU; the first OCR setup downloads about 60–75 MB. Its [model license and usage terms](https://huggingface.co/llamaindex/OCRia-nano-1/blob/main/LICENSE) are separate from Ramo's license. Voice output and speech recognition are optional and can be enabled in Settings.

## Network and release notes

Network access is used for web search, document downloads, cloud providers, and first-time tool setup. Ramo has no analytics, telemetry, crash uploads, or automatic-update service. The executable is unsigned, so Windows SmartScreen may warn; verify the release SHA-256 before running it.

This is an early Windows-x64 release. Search availability and model compatibility can vary by provider and hardware. Support is best-effort.

## Build from source

Use Node 22.19+ and npm on Windows x64. Bootstrap versions and archive SHA-256 values are pinned in `tools/bootstrap.cjs`.

```powershell
npm ci
npm run bootstrap
npm run check
npm run build
npm test
node tools/stage.cjs
node tools/verify.cjs
```

The app is written to `release/Ramo`; run `Ramo.exe` directly. These checks are model-free and do not assess answer quality or live-search availability.

## More information

- [First-run guide](docs/FIRST_RUN.md) and [Troubleshooting](docs/TROUBLESHOOTING.md)
- [How the core presents messages, tools, status and thinking](docs/core-information-display.md)
- [Changelog](CHANGELOG.md)
- Chats, settings, and provider configuration are stored in your Windows application-data profile, not in the extracted app folder.
- Ramo's agent kernel is derived in part from Pi 1.4.0 (MIT). Third-party notices and license files are included.

## License

Apache-2.0. See [LICENSE](LICENSE). Third-party components retain their own licenses.
