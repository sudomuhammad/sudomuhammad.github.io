import { describe, expect, it } from 'vitest';
import fixtures from './__fixtures__/queries.json';
import { decodeVectors, model, passages } from '../../data/map';
import { Bm25, MIN_SIMILARITY, createRetriever, expandQuery, fuse, tokenize } from './retrieval';

const retriever = createRetriever(passages, decodeVectors(), model.dims);
const fixture = (question: string) => {
  const q = fixtures.queries.find((f) => f.question === question);
  if (!q) throw new Error(`no fixture for "${question}"; add it to ml/query_fixtures.py`);
  return { ...q, vector: Float32Array.from(q.vector) };
};
const titlesOf = (ids: { id: number }[]) => ids.map(({ id }) => passages[id].title);

describe('fixtures', () => {
  it('were embedded with the same model as the map', () => {
    const { dims: _, ...loaded } = model;
    expect(fixtures.model).toEqual(loaded);
  });

  it('were embedded from exactly the text expandQuery produces (Python and TS agree)', () => {
    for (const q of fixtures.queries) expect(expandQuery(q.question)).toBe(q.embedded);
  });
});

describe('expandQuery', () => {
  it('expands acronyms case-insensitively and keeps the original word', () => {
    expect(expandQuery('Shipped RAG?')).toBe('Shipped retrieval-augmented generation RAG?');
    expect(expandQuery('ci/cd and llms')).toContain('continuous integration');
  });

  it('leaves other words alone', () => {
    expect(expandQuery('Docker on Fargate')).toBe('Docker on Fargate');
  });
});

describe('tokenize', () => {
  it('drops stop words and keeps tech tokens', () => {
    expect(tokenize('Does he have experience with C# and PyTorch?')).toEqual(['c#', 'pytorch']);
  });
});

describe('Bm25', () => {
  // Equal-length docs, so term frequency alone decides the order (BM25 also favours shorter docs).
  const index = new Bm25([10, 11, 12], ['docker docker', 'docker fargate', 'pytorch models']);

  it('only returns docs containing a query term, best first', () => {
    expect(index.search('docker').map((h) => h.id)).toEqual([10, 11]);
    expect(index.search('kubernetes')).toEqual([]);
  });
});

describe('fuse', () => {
  it('rewards items ranked well by both lists', () => {
    const scores = fuse([
      [1, 2, 3],
      [2, 1, 4],
    ]);
    const order = [...scores.entries()].sort((p, q) => q[1] - p[1]).map(([id]) => id);
    expect(order.slice(0, 2).sort()).toEqual([1, 2]);
    expect(order.at(-1)).toBe(4);
  });
});

describe('keyword search (before the model loads)', () => {
  it('finds the RAG bullet through acronym expansion', () => {
    expect(titlesOf(retriever.keyword('Has he shipped RAG?'))).toContain('RAG with Qdrant and Pinecone');
  });

  it('finds nothing for terms not in the CV', () => {
    expect(retriever.keyword('Kubernetes')).toEqual([]);
  });

  it('does not drag in "web" passages for AWS', () => {
    expect(titlesOf(retriever.keyword('Can you deploy on AWS?'))).not.toContain('Web scraper, 500k records');
  });

  it('drops incidental matches far weaker than the best one', () => {
    const hits = retriever.keyword('Are you open to relocation?');
    expect(passages[hits[0].id].kind).toBe('fact');
    expect(titlesOf(hits)).not.toContain('Open-source LLM features');
  });
});

describe('hybrid search (real MiniLM query vectors)', () => {
  const ask = (question: string) => retriever.hybrid(question, fixture(question).vector);

  it.each([
    ['Has he shipped RAG to production?', 'RAG with Qdrant and Pinecone'],
    ['What agent frameworks does he use?', 'Money Means toolkit'],
    ['Can he deploy on AWS?', 'APIs and deployment'],
    ['prompt caching', 'Prompt caching'],
  ])('"%s" returns "%s" in the top 3', (question, title) => {
    expect(titlesOf(ask(question))).toContain(title);
  });

  it('answers relocation and availability from the facts', () => {
    expect(passages[ask('Is he open to relocation?')[0].id].kind).toBe('fact');
    expect(passages[ask('When can he start?')[0].id].text).toBe('Available to start now.');
  });

  it.each(['favourite pizza topping', 'Does he know Kubernetes?'])('returns nothing for "%s"', (question) => {
    expect(ask(question)).toEqual([]);
  });

  it('only returns hits that clear the similarity bar or match a keyword', () => {
    for (const q of fixtures.queries) {
      for (const hit of ask(q.question)) expect(hit.keyword || (hit.similarity ?? 0) >= MIN_SIMILARITY).toBe(true);
    }
  });
});
