// The "How I work" card: pointing at a principle lights its evidence on the map.
// Hover and keyboard focus preview it; a click or tap pins it until clicked again.

export class Principles {
  private readonly buttons: HTMLButtonElement[];
  private pinned: number | null = null;

  constructor(
    root: HTMLElement,
    private readonly onEmphasis: (index: number | null) => void,
  ) {
    this.buttons = [...root.querySelectorAll<HTMLButtonElement>('[data-principle]')];
    this.buttons.forEach((button, i) => {
      button.addEventListener('pointerenter', (e) => e.pointerType === 'mouse' && this.preview(i));
      button.addEventListener('pointerleave', (e) => e.pointerType === 'mouse' && this.preview(null));
      button.addEventListener('focus', () => this.preview(i));
      button.addEventListener('blur', () => this.preview(null));
      button.addEventListener('click', () => this.pin(this.pinned === i ? null : i));
    });
  }

  /** Clear any pin, e.g. when the visitor scrolls to another step. */
  reset(): void {
    this.pinned = null;
    this.show(null);
  }

  private preview(index: number | null): void {
    this.show(index ?? this.pinned);
  }

  private pin(index: number | null): void {
    this.pinned = index;
    this.show(index);
  }

  private show(index: number | null): void {
    this.buttons.forEach((b, i) => b.setAttribute('aria-pressed', String(i === index)));
    this.onEmphasis(index);
  }
}
