// Hybrid retrieval over CV passages: BM25 keywords plus (once loaded) MiniLM
// sentence embeddings, fused with reciprocal-rank fusion. Pure functions, so
// it runs the same in the browser and in tests.
import acronyms from '../../data/acronyms.json';

export interface Doc {
  id: number;
  title: string;
  text: string;
}

export interface Hit {
  id: number;
  /** Fused score; only meaningful for ordering. */
  score: number;
  /** Cosine similarity to the question, when semantic search ran. */
  similarity?: number;
  /** Whether the question's words appear in the passage. */
  keyword: boolean;
}

/**
 * Below this cosine similarity a passage isn't treated as an answer on
 * semantic grounds alone. Measured on the CV: unrelated questions ("favourite
 * pizza", "Kubernetes", "PhD") top out at 0.15-0.20; relevant ones score 0.28+.
 */
export const MIN_SIMILARITY = 0.27;

// Expanded before searching; see acronyms.json for why.
const ACRONYMS: Record<string, string> = acronyms.terms;

/** Keyword hits scoring below this share of the best hit are dropped as incidental matches. */
export const MIN_KEYWORD_SHARE = 0.5; // measured: incidental hits score 35-45% of the best

export function expandQuery(query: string): string {
  return query.replace(/[\w/+#.-]+/g, (word) => ACRONYMS[word.toLowerCase()] ?? word);
}

const STOP_WORDS = new Set(
  (
    'a an and any are as at be by can could did do does done for from had has have he her his how i if in into ' +
    'is it its me my of on or our she so than that the their them they this to us was we were what when where ' +
    'which who why will with would you your about experience tell know worked work used use ever'
  ).split(' '),
);

export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9+#]+/g) ?? []).filter((t) => t.length > 1 && !STOP_WORDS.has(t));
}

/** Okapi BM25 over a small, fixed corpus. */
export class Bm25 {
  private readonly docs: Map<string, number>[];
  private readonly lengths: number[];
  private readonly avgLength: number;
  private readonly idf = new Map<string, number>();

  constructor(
    private readonly ids: number[],
    texts: string[],
    private readonly k1 = 1.2,
    private readonly b = 0.75,
  ) {
    this.docs = texts.map((t) => {
      const tf = new Map<string, number>();
      for (const token of tokenize(t)) tf.set(token, (tf.get(token) ?? 0) + 1);
      return tf;
    });
    this.lengths = this.docs.map((tf) => [...tf.values()].reduce((s, n) => s + n, 0));
    this.avgLength = this.lengths.reduce((s, n) => s + n, 0) / Math.max(1, this.lengths.length);
    const df = new Map<string, number>();
    for (const tf of this.docs) for (const token of tf.keys()) df.set(token, (df.get(token) ?? 0) + 1);
    const n = this.docs.length;
    for (const [token, count] of df) this.idf.set(token, Math.log(1 + (n - count + 0.5) / (count + 0.5)));
  }

  /** Scores for every doc with at least one query term, best first. */
  search(query: string): { id: number; score: number }[] {
    const terms = [...new Set(tokenize(query))];
    const out: { id: number; score: number }[] = [];
    this.docs.forEach((tf, i) => {
      let score = 0;
      for (const term of terms) {
        const f = tf.get(term);
        if (!f) continue;
        const norm = this.k1 * (1 - this.b + (this.b * this.lengths[i]) / this.avgLength);
        score += (this.idf.get(term) ?? 0) * ((f * (this.k1 + 1)) / (f + norm));
      }
      if (score > 0) out.push({ id: this.ids[i], score });
    });
    return out.sort((p, q) => q.score - p.score);
  }
}

/** Cosine similarity of a unit query vector against row-major unit vectors. */
export function cosineAll(query: Float32Array, vectors: Float32Array, dims: number): Float32Array {
  const n = vectors.length / dims;
  const out = new Float32Array(n);
  for (let r = 0; r < n; r++) {
    let dot = 0;
    for (let d = 0; d < dims; d++) dot += query[d] * vectors[r * dims + d];
    out[r] = dot;
  }
  return out;
}

/** Reciprocal-rank fusion: robust to the two rankers' scores being on different scales. */
export function fuse(rankings: number[][], k = 60): Map<number, number> {
  const scores = new Map<number, number>();
  for (const ranking of rankings) {
    ranking.forEach((id, rank) => scores.set(id, (scores.get(id) ?? 0) + 1 / (k + rank + 1)));
  }
  return scores;
}

export interface Retriever {
  /** Keyword-only search; available immediately. */
  keyword(query: string, limit?: number): Hit[];
  /** Hybrid search given the question's embedding (from the same model as the passages). */
  hybrid(query: string, queryVector: Float32Array, limit?: number): Hit[];
}

/**
 * `vectors` holds one unit vector per doc, in the same order as `docs`
 * (row-major, `dims` wide).
 */
export function createRetriever(docs: Doc[], vectors: Float32Array, dims: number): Retriever {
  const index = new Bm25(
    docs.map((d) => d.id),
    docs.map((d) => `${d.title} ${d.text}`),
  );

  /** BM25 hits, minus incidental ones (e.g. "open" matching "open-source" for a relocation question). */
  function strongKeywordHits(query: string) {
    const hits = index.search(expandQuery(query));
    const best = hits[0]?.score ?? 0;
    return hits.filter((h) => h.score >= best * MIN_KEYWORD_SHARE);
  }

  const keyword = (query: string, limit = 3): Hit[] =>
    strongKeywordHits(query)
      .slice(0, limit)
      .map(({ id, score }) => ({ id, score, keyword: true }));

  function hybrid(query: string, queryVector: Float32Array, limit = 3): Hit[] {
    const sims = cosineAll(queryVector, vectors, dims);
    const keywordHits = strongKeywordHits(query);
    const keywordIds = new Set(keywordHits.map((h) => h.id));
    const semanticIds = docs
      .map((d, i) => ({ id: d.id, sim: sims[i] }))
      .filter((h) => h.sim >= MIN_SIMILARITY)
      .sort((p, q) => q.sim - p.sim)
      .map((h) => h.id);
    const fused = fuse([semanticIds, keywordHits.map((h) => h.id)]);
    const simById = new Map(docs.map((d, i) => [d.id, sims[i]]));
    return [...fused.entries()]
      .sort((p, q) => q[1] - p[1])
      .slice(0, limit)
      .map(([id, score]) => ({ id, score, similarity: simById.get(id), keyword: keywordIds.has(id) }));
  }

  return { keyword, hybrid };
}
