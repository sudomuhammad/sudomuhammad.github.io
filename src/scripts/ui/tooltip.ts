// The hover tooltip for points on the map.
import { clusterOf, orgOf } from '../../data/map';
import type { Anchor } from '../map/stage';
import { html } from './html';

const OFFSET = 14;
const MARGIN = 12;

export class Tooltip {
  constructor(private readonly el: HTMLElement) {}

  show(anchor: Anchor | null, x: number, y: number): void {
    if (!anchor) {
      this.el.hidden = true;
      return;
    }
    this.el.innerHTML = String(this.content(anchor));
    this.el.hidden = false;
    // Above the point, kept inside the viewport.
    const left = Math.min(x + OFFSET, innerWidth - this.el.offsetWidth - MARGIN);
    const top = Math.max(MARGIN, y - this.el.offsetHeight - OFFSET);
    this.el.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  }

  private content(anchor: Anchor) {
    if (anchor.type === 'passage') {
      const { passage } = anchor;
      return html`<span class="tip-source">${orgOf(passage.source)}</span><strong>${passage.title}</strong><br />${passage.text}`;
    }
    const { term, cluster, passages } = anchor.label;
    const n = passages.length;
    return html`<span class="tip-source">${clusterOf(cluster).name}</span><strong>${term}</strong> · ${n} ${n === 1 ? 'passage' : 'passages'}`;
  }
}
