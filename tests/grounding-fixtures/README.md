# Grounding fixtures — frozen

Status: **FROZEN (2026-11-08).** `ground-truth.json` is the measurement set for
every phase from here on. A case is never changed because a method failed; a
method that cannot place a target loses the case, the case stays.

## Why these exist

The pet's drawings live in `src/native/pet-grounding.cjs` (where the marks go)
and `src/native/pet-sketch.cjs` (what a mark is). The models are small and
local, so "where did the mark land?" has to be measured, not argued about.
These cases are that measurement, on real pixels, with the same model and the
same contract for every method.

## How the boxes were measured

Every box was read off the pixels of the originals in `_captures/`, not
guessed and not produced by a vision model:

- icon boxes come from an ink/colour segmentation of the PNG (the Recycle Bin
  is the difference from the desktop background colour; the folder is its
  saturated-yellow pixels);
- the button boxes come from their drawn borders (the Save and Cancel buttons
  have a visible 1-px frame);
- the clock and the tab label come from their glyph runs;
- the game character is a hue/saturation cluster of the cyan silhouette;
- the cat head is the texture map of the photo, whose two ear tips fix the box.

`box` is `[left, top, right, bottom]` in normalised 0..1000 top-left units
(`x = pixelX / 1920 * 1000`, `y = pixelY / 1200 * 1000`). `boxPx` is the same
box in the source pixels, so a box can be re-checked without doing the
arithmetic. `verified` is true on every case.

## The cases (12)

| ID | Target | Size | Capture |
|---|---|---|---|
| G01 | Recycle Bin icon, top-left of the desktop | tiny | `shot-clean-desktop.png` |
| G02 | yellow desktop folder | tiny | `shot-clean-desktop.png` |
| G03 | taskbar search pill | small | `shot-taskbar.png` |
| G04 | taskbar clock | tiny | `shot-taskbar.png` |
| G05 | large File Explorer window on the left | large | `shot-clean-desktop.png` |
| G06 | cyan game character silhouette | tiny | `shot-edge.png` |
| G07 | cat's head in the photo | small | `c-windowleft.png` |
| G08 | the text `oceanic-unified` in the tab strip | small | `s-cursor.png` |
| G09 | the **Save** button | small | `s-notepad-saveas.png` |
| G10 | the **Cancel** button next to it | small | `s-notepad-saveas.png` |
| G11 | the elephant (absent) | n/a | `shot-clean-desktop.png` |
| G12 | the printer icon (absent) | n/a | `shot-edge.png` |

Ten present cases and two absent ones, over three size classes, three corners
of the screen, two distractor pairs (Save next to Cancel, one of two cyan
figures) and two different background types (a busy desktop and a game frame).

The set is smaller than the 20 cases the first draft proposed, on purpose: the
draft listed targets whose capture did not exist (a Cursor activity-bar icon,
an Edge omnibox, a thin health bar). Nothing here is a placeholder, and every
box is reproducible from the pixels.

## The absent cases are a probe, not a gate

The model contract deliberately has **no refusal option**: it is never asked
whether the target exists, it always commits to a place and the marks are
always shown. So an absent target cannot be answered correctly with "no
drawing" — that answer does not exist in the product any more. G11 and G12
therefore measure **where the invented mark landed**, which is the honest
hallucination measurement, and the scorer's pass line does not depend on
them. The scorer still reports them, as `false_draw`, so a regression in
behaviour is visible.

## Running it

```powershell
# score a predictions file against the frozen boxes
node tools/grounding-bench.cjs tests/grounding-fixtures/ground-truth.json tests/grounding-fixtures/predictions.jsonl

# run the live A/B against the staged app (both methods, same model, same contract)
node tools/live-grounding-bench.cjs
```

`tools/live-grounding-bench.cjs` drives the test-only seam
`oceanic:pet:ground-file`, which runs the grounded method and the faithful
pre-Phase-1 baseline against the same PNG on disk. The seam exists because the
agent's own console covers the desktop a live capture would otherwise see.

## Files

- `ground-truth.json` — the frozen cases (this is the file the scorer reads).
- `ground-truth-draft.json` — the original 20-case draft, kept for history. It
  is not read by anything.
- `_captures/` — the real 1920x1200 PNGs the boxes were measured on.
- `progress-2026-11-08.md` — the Phase 0 notes.
- `live-requests.json` — the prompts the user's live acceptance test uses.
