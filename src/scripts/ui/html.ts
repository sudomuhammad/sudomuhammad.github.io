// A tiny tagged template for building markup safely: every interpolated value is
// escaped unless it's already markup built by `html` itself.

const ENTITIES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export class SafeHtml {
  constructor(readonly value: string) {}
  toString() {
    return this.value;
  }
}

export const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (ch) => ENTITIES[ch]);

type Value = string | number | SafeHtml | null | undefined | false | Value[];

function render(value: Value): string {
  if (value === null || value === undefined || value === false) return '';
  if (Array.isArray(value)) return value.map(render).join('');
  if (value instanceof SafeHtml) return value.value;
  return escapeHtml(String(value));
}

/** html`<p>${userText}</p>` escapes userText; nested html`` and arrays of it pass through. */
export function html(strings: TemplateStringsArray, ...values: Value[]): SafeHtml {
  return new SafeHtml(strings.reduce((out, s, i) => out + s + (i < values.length ? render(values[i]) : ''), ''));
}
