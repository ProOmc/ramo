# Troubleshooting

- **Setup says Ollama is unavailable:** start Ollama, confirm `ollama list` works in Terminal, then Refresh detection. Ramo expects the default loopback API at `127.0.0.1:11434`.
- **No models appear:** run `ollama pull <model-id>` for a model you selected, wait for completion, and Refresh. Ramo never pulls LLM weights itself.
- **A model runs out of memory:** assign a smaller model in Settings → Setup. Model weights, RAM/VRAM needs and model licenses are the user's responsibility.
- **Anonymous search fails:** the public AnySearch endpoint or its anonymous allowance may be unavailable. Add your own AnySearch key, or a Tavily key for reserve search.
- **Document setup fails:** install 64-bit Python 3.10–3.14 and retry. The first OCR fallback needs internet once for LiteParse's verified OCRia-nano-1 download. Review the separate OCR model license.
- **Windows warns about the app:** this build is not code-signed. Verify the release checksum; do not bypass warnings for a file obtained elsewhere.
- **Cloud provider fails:** confirm the exact provider model ID, key and provider quota. Keys stay local; do not attach them to a bug report.

No model-quality or live-search SLA is implied by the model-free test suite.
