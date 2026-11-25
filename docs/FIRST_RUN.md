# First run

1. Extract the complete ZIP on Windows x64, keeping the `Ramo` folder together.
2. Run `Ramo.exe`. The app is unsigned; compare the ZIP's published SHA-256 if Windows shows a SmartScreen warning.
3. In Setup, choose **Start Ollama** or **Download Ollama** if needed. If its API uses another loopback port, edit the port and refresh. Install models from the Ollama library with `ollama pull <model-id>`.
4. Choose **Refresh detection**. Ramo suggests Fast (smallest), Smart (mid-size), and Super Smart (largest); change any assignment before finishing.
5. Cloud models are another option. Save a provider key and add the exact model ID in Setup. Local and cloud models can be assigned to any tier.
6. AnySearch can be tried without an account. Add an AnySearch key if you have one, or configure Tavily as a backup.

Chats, settings, and keys are stored in your Windows application-data profile rather than the ZIP folder. Export chats before deleting that profile.

Document tools create a local Python environment on first use. Scanned documents use OCRia-nano-1 through LiteParse on your CPU. Voice output and speech recognition are optional and can be enabled in Settings.
