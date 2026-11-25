#!/usr/bin/env python3
"""Ramo local document-to-Markdown worker.

Core conversion uses MarkItDown. Near-empty/scanned results fall back to
LiteParse with OCRia-nano-1 on CPU. No Ollama, vision model, LLM or cloud API is
used. Stdout is exactly one JSON line for the Electron parent.
"""
import argparse
import json
import sys
from markitdown import MarkItDown


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--file", required=True)
    parser.add_argument("--name", default="document")
    parser.add_argument("--ocr", action="store_true")
    args = parser.parse_args()
    result = {"ok": False, "name": args.name, "markdown": "", "chars": 0,
              "ocr_used": False, "ocr_error": "", "ocr_model": "", "error": ""}
    try:
        md = MarkItDown(enable_plugins=False)
        result["markdown"] = str(md.convert(args.file).text_content or "")
        result["ok"] = True
    except Exception as exc:
        result["error"] = "core conversion: " + str(exc)[:500]
    result["chars"] = len(result["markdown"].strip())
    if args.ocr and result["chars"] < 200:
        try:
            from liteparse import LiteParse
            parsed = LiteParse(ocr_backend="ocria-nano", output_format="markdown",
                               image_mode="off", quiet=True).parse(args.file)
            text = str(parsed.text or "")
            if len(text.strip()) > result["chars"]:
                result.update(markdown=text, chars=len(text.strip()), ok=True,
                              ocr_used=True, ocr_model="OCRia-nano-1", error="")
        except Exception as exc:
            result["ocr_error"] = str(exc)[:500]
    sys.stdout.write(json.dumps(result, ensure_ascii=True) + "\n")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
