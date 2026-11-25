/**
 * Tokenising and BM25 for the lexical retrieval arm.
 *
 * Provenance: the ranking function is the standard Okapi BM25, reimplemented
 * here in-project rather than vendored. MiniSearch was the planned source, but
 * the runtime ships only `node-pty` in `vendor/node_modules`, and the project
 * rule is that new runtime code may not depend on packages that are absent from
 * it. BM25 is about eighty lines, so it is written here and covered by its own
 * test instead.
 */

const STOPWORDS = new Set(
	`a about above after again against all am an and any are aren't as at be because been before being below between both but by can cannot could couldn't did didn't do does doesn't doing don't down during each few for from further had hadn't has hasn't have haven't having he her here hers herself him himself his how i i'm if in into is isn't it it's its itself let's me more most mustn't my myself no nor not of off on once only or other ought our ours ourselves out over own same shan't she should shouldn't so some such than that that's the their theirs them themselves then there there's these they this those through to too under until up very was wasn't we were weren't what what's when where which while who whom why with won't would wouldn't you your yours yourself yourselves`
		.split(/\s+/)
		.filter(Boolean),
);

/**
 * Reduce a word to a comparison stem.
 *
 * Deliberately small: plural folding and the `ing`/`ed` endings. A real stemmer
 * would conflate more, but it would also conflate words the user distinguishes,
 * and the semantic arm exists for the cases this cannot reach.
 */
export function stem(word: string): string {
	let value = word;
	if (value.length > 4 && value.endsWith("ies")) value = `${value.slice(0, -3)}y`;
	else if (value.length > 4 && /(?:s|x|z|ch|sh)es$/.test(value)) value = value.slice(0, -2);
	else if (value.length > 3 && value.endsWith("s") && !value.endsWith("ss")) value = value.slice(0, -1);
	if (value.length > 4 && value.endsWith("ing")) value = value.slice(0, -3);
	else if (value.length > 3 && value.endsWith("ed")) value = value.slice(0, -2);
	return value;
}

/** Split text into stemmed tokens, keeping every word including stopwords. */
export function tokenise(text: string): string[] {
	const words = String(text ?? "")
		.toLowerCase()
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "")
		.split(/[^a-z0-9]+/)
		.filter((word) => word.length > 0);
	return words.map(stem);
}

/** Split text into stemmed content tokens, dropping stopwords and one-letter words. */
export function contentTerms(text: string): string[] {
	const words = String(text ?? "")
		.toLowerCase()
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "")
		.split(/[^a-z0-9]+/)
		.filter((word) => word.length > 1 && !STOPWORDS.has(word));
	return words.map(stem);
}

export function isStopword(word: string): boolean {
	return STOPWORDS.has(word.toLowerCase());
}

export interface ScoredId {
	id: string;
	score: number;
}

interface Posting {
	length: number;
	terms: Map<string, number>;
}

/**
 * A BM25 index over a fixed set of documents.
 *
 * `k1` and `b` are the usual values. They are not tuned here: the arm only has
 * to produce a plausible ranking, because fusion and reranking decide the order
 * that reaches the model.
 */
export class Bm25Index {
	private postings = new Map<string, Posting>();
	private documentFrequency = new Map<string, number>();
	private averageLength = 0;
	private readonly k1: number;
	private readonly b: number;

	constructor(documents: { id: string; text: string }[], options: { k1?: number; b?: number } = {}) {
		this.k1 = options.k1 ?? 1.2;
		this.b = options.b ?? 0.75;
		let total = 0;
		for (const document of documents) {
			const tokens = tokenise(document.text);
			const terms = new Map<string, number>();
			for (const token of tokens) terms.set(token, (terms.get(token) ?? 0) + 1);
			this.postings.set(document.id, { length: tokens.length, terms });
			total += tokens.length;
			for (const term of terms.keys()) this.documentFrequency.set(term, (this.documentFrequency.get(term) ?? 0) + 1);
		}
		this.averageLength = documents.length > 0 ? total / documents.length : 0;
	}

	get size(): number {
		return this.postings.size;
	}

	/** Rank every document that shares a term with the query. */
	search(query: string, limit: number): ScoredId[] {
		const terms = contentTerms(query);
		if (terms.length === 0) return [];
		const total = this.postings.size;
		const scores = new Map<string, number>();
		for (const term of new Set(terms)) {
			const df = this.documentFrequency.get(term) ?? 0;
			if (df === 0) continue;
			const idf = Math.log(1 + (total - df + 0.5) / (df + 0.5));
			for (const [id, posting] of this.postings) {
				const frequency = posting.terms.get(term) ?? 0;
				if (frequency === 0) continue;
				const normalisation = this.averageLength > 0 ? 1 - this.b + (this.b * posting.length) / this.averageLength : 1;
				const contribution = (idf * frequency * (this.k1 + 1)) / (frequency + this.k1 * normalisation);
				scores.set(id, (scores.get(id) ?? 0) + contribution);
			}
		}
		return [...scores.entries()]
			.map(([id, score]) => ({ id, score }))
			.sort((left, right) => right.score - left.score)
			.slice(0, Math.max(0, limit));
	}
}
