/**
 * Asynchronous event stream used by the Ramo kernel.
 *
 * Derived from Pi 1.4.0 (`third_party/pi/packages/ai/src/utils/event-stream.ts`, MIT
 * licensed, Copyright (c) 2025 Mario Zechner). Changes: renamed to Ramo's
 * vocabulary and the response-specific subclass was dropped in favour of one
 * generic stream with an explicit final-result extractor.
 */

class FifoQueue<T> {
	private incoming: T[] = [];
	private outgoing: T[] = [];

	get length(): number {
		return this.incoming.length + this.outgoing.length;
	}

	enqueue(value: T): void {
		this.incoming.push(value);
	}

	dequeue(): T | undefined {
		if (this.outgoing.length === 0) {
			while (this.incoming.length > 0) this.outgoing.push(this.incoming.pop() as T);
		}
		return this.outgoing.pop();
	}
}

/** A stream of events that yields a final result when it completes. */
export class EventStream<T, R = T> implements AsyncIterable<T> {
	private queue = new FifoQueue<T>();
	private waiting = new FifoQueue<(value: IteratorResult<T>) => void>();
	protected done = false;
	private finalResultPromise: Promise<R>;
	private resolveFinalResult!: (result: R) => void;
	private isComplete: (event: T) => boolean;
	private extractResult: (event: T) => R;

	constructor(isComplete: (event: T) => boolean, extractResult: (event: T) => R) {
		this.isComplete = isComplete;
		this.extractResult = extractResult;
		this.finalResultPromise = new Promise((resolve) => {
			this.resolveFinalResult = resolve;
		});
	}

	push(event: T): void {
		if (this.done) return;
		if (this.isComplete(event)) {
			this.done = true;
			this.resolveFinalResult(this.extractResult(event));
		}
		const waiter = this.waiting.dequeue();
		if (waiter) waiter({ value: event, done: false });
		else this.queue.enqueue(event);
	}

	/** Close the stream. A result supplied here becomes the final result. */
	end(result?: R): void {
		this.done = true;
		if (result !== undefined) this.resolveFinalResult(result);
		while (this.waiting.length > 0) {
			const waiter = this.waiting.dequeue() as (value: IteratorResult<T>) => void;
			waiter({ value: undefined as unknown as T, done: true });
		}
	}

	async *[Symbol.asyncIterator](): AsyncIterator<T> {
		while (true) {
			if (this.queue.length > 0) {
				yield this.queue.dequeue() as T;
			} else if (this.done) {
				return;
			} else {
				const result = await new Promise<IteratorResult<T>>((resolve) => this.waiting.enqueue(resolve));
				if (result.done) return;
				yield result.value;
			}
		}
	}

	/** The final result. Resolves once the stream completes. */
	result(): Promise<R> {
		return this.finalResultPromise;
	}
}
