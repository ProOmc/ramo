# Troubleshooting

- **Ollama is unavailable:** start Ollama and confirm `ollama list` works in Terminal. Check the port in Setup; the default is `127.0.0.1:11434`.
- **No models appear:** after `ollama pull <model-id>` finishes, choose **Refresh detection**.
- **A model runs out of memory:** assign a smaller model in Settings → Setup. Check the model's documented RAM/VRAM requirements.
- **Anonymous search fails:** availability and limits are controlled by AnySearch. Add your own AnySearch key or configure Tavily as a backup.
- **Document setup fails:** install 64-bit Python 3.10–3.14 and retry. The first OCR setup also needs internet access for LiteParse's verified OCRia-nano-1 download.
- **Windows warns about the app:** this build is unsigned. Verify the release checksum and make sure the ZIP came from the official Ramo Releases page.
- **A cloud provider fails:** confirm the exact model ID, key, and provider quota. Do not include keys in bug reports.
