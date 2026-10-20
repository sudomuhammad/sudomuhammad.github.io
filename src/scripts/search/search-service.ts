// One entry point for answering a question: keyword search straight away,
// hybrid search once the MiniLM model has loaded in the background.
import { decodeVectors, model, passages } from '../../data/map';
import { createRetriever, expandQuery, type Hit } from './retrieval';
import { loadEmbedder, type LoadStatus } from './semantic';

export interface SearchResult {
  hits: Hit[];
  /** Whether semantic search contributed (false = keywords only). */
  semantic: boolean;
}

type Embed = (text: string) => Promise<Float32Array>;

export class SearchService {
  private readonly retriever = createRetriever(passages, decodeVectors(), model.dims);
  private embed: Embed | null = null;

  constructor(private readonly onStatus: (status: LoadStatus) => void = () => {}) {}

  get semanticReady(): boolean {
    return this.embed !== null;
  }

  /** Start loading the model, unless the visitor's browser asks to save data. Resolves when ready (or not). */
  async warmUp(): Promise<boolean> {
    const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;
    if (this.embed || saveData) return this.semanticReady;
    try {
      this.embed = await loadEmbedder(this.onStatus);
    } catch {
      // Status already reported; keyword search keeps working.
    }
    return this.semanticReady;
  }

  async search(question: string): Promise<SearchResult> {
    if (this.embed) {
      try {
        return { hits: this.retriever.hybrid(question, await this.embed(expandQuery(question))), semantic: true };
      } catch {
        // Fall through to keywords if inference fails.
      }
    }
    return { hits: this.retriever.keyword(question), semantic: false };
  }
}
