/**
 * The one interface the memory subsystem uses to reach a model.
 *
 * Both stages that need judgement — the retainer, which reads facts out of a
 * turn, and the dream, which synthesises them — ask for one JSON object and
 * nothing else. That makes the request shape unusual, and the local small
 * models need to be shown the answer rather than told about it: given a schema
 * full of placeholders, `qwen3.5:4b` mirrors the placeholders and answers
 * `{"facts":[]}` for every message, including obvious ones like "My name is
 * Mira Chen." Given one worked example, the same model extracts the fact.
 * That was measured, not assumed; see `docs/validation.md`.
 *
 * So the contract carries examples. They are turns the model is shown before
 * the real request, in the order they would have been exchanged.
 */

/** A turn shown to the model as an example of the answer it should give. */
export interface ModelTurn {
	role: "user" | "assistant";
	content: string;
}

/** What the memory subsystem needs from a model. */
export interface MemoryModel {
	/** The model's name, recorded in the journal and in the fact provenance. */
	id: string;
	complete(request: {
		/** The instructions. */
		system: string;
		/** The request itself. */
		prompt: string;
		/** Worked examples, oldest first, shown before the request. */
		examples?: ModelTurn[];
		signal?: AbortSignal;
	}): Promise<{ text: string; usage: { input: number; output: number } }>;
}
