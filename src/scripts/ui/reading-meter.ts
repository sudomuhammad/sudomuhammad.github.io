// Updates the reading-progress meter as the story moves from step to step.
import { progressById, READING_TOTAL, type Step } from '../../data/story';

export class ReadingMeter {
  private readonly chapter: HTMLElement;
  private readonly read: HTMLElement;
  private readonly fill: HTMLElement;

  constructor(private readonly root: HTMLElement) {
    this.chapter = root.querySelector('[data-chapter]')!;
    this.read = root.querySelector('[data-read]')!;
    this.fill = root.querySelector('[data-fill]')!;
  }

  show(step: Step): void {
    const progress = progressById.get(step.id);
    // Hidden during the intro, where the name is the whole screen.
    this.root.dataset.visible = String(Boolean(progress?.chapter));
    if (!progress?.chapter) return;
    this.chapter.textContent = progress.chapter;
    this.read.textContent = progress.read.toLocaleString('en-GB');
    this.fill.style.transform = `scaleX(${progress.read / READING_TOTAL})`;
    this.root.setAttribute('aria-valuenow', String(progress.read));
  }
}
