// The ask bar: a question box at the bottom of the screen whose answers grow
// upwards from it, so asking and answering happen in one place.
import { orgOf, passages } from '../../data/map';
import type { SearchResult, SearchService } from '../search/search-service';
import type { LoadStatus } from '../search/semantic';
import { OVERVIEW } from '../map/scene';
import type { MapStage } from '../map/stage';
import { html } from './html';

const passageById = new Map(passages.map((p) => [p.id, p]));

const STATUS_TEXT: { [K in LoadStatus['state']]?: (s: Extract<LoadStatus, { state: K }>) => string } = {
  loading: (s) => `Keyword search for now · loading the MiniLM model (${Math.round(s.progress)}%)`,
  ready: () => 'Semantic search: MiniLM running in your browser.',
  failed: () => 'Keyword search (the language model couldn’t load).',
};

export const statusText = (s: LoadStatus): string | null =>
  (STATUS_TEXT[s.state] as ((s: LoadStatus) => string) | undefined)?.(s) ?? null;

interface Options {
  stage: MapStage;
  search: SearchService;
  /** Called when the answer is cleared, so the story can restore its scene. */
  onDismiss: () => void;
}

export class AskBar {
  private readonly input: HTMLInputElement;
  private readonly thread: HTMLElement;
  private readonly status: HTMLElement;
  /** Submits a typed question; suggestions answer on click. Disabled while the box is empty. */
  private readonly send: HTMLButtonElement;
  private latest = '';
  private latestWasSemantic = false;

  constructor(
    private readonly root: HTMLElement,
    private readonly options: Options,
  ) {
    this.input = root.querySelector('input')!;
    this.thread = root.querySelector('[data-thread]')!;
    this.status = root.querySelector('[data-status]')!;
    this.send = root.querySelector('button[type="submit"]')!;
    this.bind();
  }

  /** Called by the page when the model's load status changes. */
  setStatus(status: LoadStatus): void {
    const text = statusText(status);
    if (text) this.status.textContent = text;
  }

  open(focus = true): void {
    this.root.dataset.open = 'true';
    if (focus) this.input.focus();
    void this.upgradeWhenReady();
  }

  /** Load the model in the background; re-answer a keyword-only answer once semantic search is ready. */
  private async upgradeWhenReady(): Promise<void> {
    const ready = await this.options.search.warmUp();
    if (ready && this.latest && !this.latestWasSemantic) await this.answer(this.latest);
  }

  /** Collapse back to the pill, handing keyboard focus to it so it isn't lost with the panel. */
  close(): void {
    this.root.dataset.open = 'false';
    this.clear();
    this.root.querySelector<HTMLButtonElement>('[data-open]')?.focus();
  }

  private bind(): void {
    this.root.querySelector('form')!.addEventListener('submit', (e) => {
      e.preventDefault();
      const question = this.input.value.trim();
      if (question) void this.answer(question);
    });
    this.input.addEventListener('focus', () => this.open(false));
    this.input.addEventListener('input', () => {
      const empty = !this.input.value.trim();
      this.send.disabled = empty;
      if (empty) this.clear();
    });
    this.root.querySelector('[data-open]')?.addEventListener('click', () => this.open());
    this.root.querySelector('[data-close]')?.addEventListener('click', () => this.close());
    this.root.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.root.dataset.open === 'true') {
        e.preventDefault();
        this.close();
      }
    });
    this.root.querySelectorAll<HTMLButtonElement>('[data-question]').forEach((button) =>
      button.addEventListener('click', () => {
        this.input.value = button.dataset.question!;
        this.send.disabled = false;
        this.open(false);
        void this.answer(this.input.value);
      }),
    );
  }

  private async answer(question: string): Promise<void> {
    this.latest = question;
    const result = await this.options.search.search(question);
    if (question !== this.latest) return; // a newer question arrived meanwhile
    this.latestWasSemantic = result.semantic;
    this.render(question, result);
    const ids = result.hits.map((h) => h.id);
    const { stage } = this.options;
    // No matches: nothing to show on the map, so the story's own scene comes back.
    if (!ids.length) return this.options.onDismiss();
    // Only the matches are named, so the answer reads clearly over whatever was on screen.
    stage.apply({ ...OVERVIEW, lit: ids, labels: { kind: 'none' } });
    const bar = this.input.getBoundingClientRect();
    stage.ask(ids, { x: bar.left + bar.width / 2, y: bar.top });
  }

  private clear(): void {
    if (!this.latest) return;
    this.latest = '';
    this.thread.innerHTML = '';
    this.options.onDismiss();
  }

  private render(question: string, { hits, semantic }: SearchResult): void {
    this.thread.innerHTML = String(
      hits.length
        ? html`<article class="answer">
            <h2 class="answer-title">From my CV</h2>
            <ul class="answer-quotes">
              ${hits.map((hit) => {
                const p = passageById.get(hit.id)!;
                const score = hit.similarity !== undefined ? hit.similarity.toFixed(2) : 'keyword';
                return html`<li>
                  <span class="answer-source">${p.title} · ${orgOf(p.source)}<span class="answer-score">${score}</span></span>
                  ${p.text}
                </li>`;
              })}
            </ul>
            <p class="answer-method">${semantic ? 'Semantic + keyword search' : 'Keyword search'}. Quoted, not generated.</p>
          </article>`
        : html`<article class="answer">
            <h2 class="answer-title">That isn’t in my CV</h2>
            <p>Nothing I’ve written matches “${question}”. Try a suggestion, or ask about agents, RAG, NLP or deployment.</p>
          </article>`,
    );
  }
}
