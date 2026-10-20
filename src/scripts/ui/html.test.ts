import { describe, expect, it } from 'vitest';
import { html } from './html';

describe('html', () => {
  it('escapes interpolated text', () => {
    expect(html`<p>${'<img onerror=x> & "q"'}</p>`.value).toBe('<p>&lt;img onerror=x&gt; &amp; &quot;q&quot;</p>');
  });

  it('passes nested html and arrays through unescaped', () => {
    const items = ['a', 'b'].map((t) => html`<li>${t}</li>`);
    expect(html`<ul>${items}</ul>`.value).toBe('<ul><li>a</li><li>b</li></ul>');
  });

  it('drops null, undefined and false', () => {
    expect(html`<p>${null}${undefined}${false}x</p>`.value).toBe('<p>x</p>');
  });
});
