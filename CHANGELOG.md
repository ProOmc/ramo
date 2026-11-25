# Changelog

## Unreleased

- Separate personal builds (private defaults, no setup gate) from exported public builds.
- Allow cloud API profiles in every tier and create them during first-run setup.
- Add Ollama start/port/error handling; remove arbitrary model recommendations and fixed size labels.

## 3.0.0 — 2026-11-24

- First public Windows-x64 build.
- Ollama detection, user-assigned Fast/Smart/Super Smart tiers, and one first-run setup screen.
- Direct anonymous AnySearch, optional AnySearch/Tavily keys, and local slots for OpenAI, OpenRouter, Anthropic, Gemini and NVIDIA keys.
- Local MarkItDown documents with CPU-only OCRia-nano-1 through LiteParse; no Ollama/vision-model OCR.
- Direct executable entry point, no launcher script, private defaults, telemetry or bundled chats.
