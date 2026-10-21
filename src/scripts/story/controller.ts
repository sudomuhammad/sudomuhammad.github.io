// Watches the story's steps and applies the scene for whichever one sits in the
// middle of the viewport. Normal scrolling drives everything; nothing is hijacked.
import { stepsById, type Step } from '../../data/story';
import type { MapStage } from '../map/stage';
import { sceneFor, type SceneContext } from './scenes';

export class StoryController {
  private current: Step | null = null;
  private emphasis: number | null = null;
  private readonly elements = new Map<string, HTMLElement>();
  private readonly observer: IntersectionObserver;

  constructor(
    private readonly stage: MapStage,
    private readonly context: () => Omit<SceneContext, 'stage' | 'emphasis'>,
    private readonly onStep: (step: Step) => void = () => {},
  ) {
    // A thin band across the middle of the viewport: the step crossing it is the active one.
    this.observer = new IntersectionObserver(
      (entries) => {
        const hit = entries.find((e) => e.isIntersecting);
        if (hit) this.activate((hit.target as HTMLElement).dataset.step!);
      },
      { rootMargin: '-48% 0px -48% 0px' },
    );
  }

  observe(elements: Iterable<HTMLElement>): void {
    for (const el of elements) {
      this.elements.set(el.dataset.step!, el);
      this.observer.observe(el);
    }
  }

  activate(id: string): void {
    const step = stepsById.get(id);
    if (!step || step === this.current) return;
    if (this.current) delete this.elements.get(this.current.id)?.dataset.active;
    this.current = step;
    this.emphasis = null;
    this.elements.get(id)?.setAttribute('data-active', '');
    this.render();
    this.onStep(step);
  }

  /** Point at one item in the active card (e.g. a principle), or none. */
  emphasise(index: number | null): void {
    if (index === this.emphasis) return;
    this.emphasis = index;
    this.render();
  }

  /** Re-apply the current step's scene, e.g. after a resize or when an answer is dismissed. */
  render(): void {
    if (!this.current) return;
    this.stage.ask(null);
    this.stage.apply(sceneFor(this.current, { stage: this.stage, ...this.context(), emphasis: this.emphasis }));
  }
}
