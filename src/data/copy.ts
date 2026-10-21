// The page's own words: everything a visitor reads that isn't taken from the CV.
// CV facts live in cv.json, the "How I work" principles in approach.ts, and each
// control's labels in its component.
import { approach } from './approach';

export const meta = {
  title: 'Muhammad Uzair, AI Engineer',
  description:
    'Muhammad Uzair builds language-model agents for real products. Five years in data science and machine learning, most recently AI Engineer on Aida at Money Means. Available now.',
};

export const intro = {
  /** Before the most recent employer, e.g. "AI Engineer, most recently at Money Means". */
  recently: 'most recently at',
  hint: 'Scroll to explore the map of my work',
};

/** Chapter headings, in page order. `nav` is the short name for the menu. */
export const chapterCopy = {
  work: {
    nav: 'Work',
    title: 'What I work on',
    lede: 'Five areas, each lit on the map in turn. Where a point sits comes from embedding my CV; its colour is the area I filed it under.',
  },
  approach: { nav: approach.title, title: approach.title, lede: '' },
  experience: {
    nav: 'Experience',
    title: 'Experience',
    lede: 'Point at a role to see where its work sits on the map.',
  },
  method: { nav: 'How it’s made', title: 'How this map is made', lede: '' },
  contact: {
    nav: 'Contact',
    title: 'Let’s talk',
    lede: 'Hiring for an AI engineer? Email is quickest.',
  },
};

/** The "How this map is made" card. Counts come from map.json; the evaluation figures from ml/eval/results.md. */
export const method = {
  steps: ({ passages, dims }: { passages: number; dims: number }) => [
    {
      title: 'Embedded',
      text: `${passages} passages from my CV, each turned into a list of ${dims} numbers by a small sentence model (MiniLM) that also runs in your browser.`,
    },
    {
      title: 'Laid out',
      text: 'UMAP places similar work close together. Where a point sits is computed; its colour is the section I filed it under, because clustering grouped short sentences by shared words rather than by the work.',
    },
    {
      title: 'Searched',
      text: 'Ask combines keyword search with the same model, on your device. A question my CV can’t answer gets no answer, not the nearest wrong one.',
    },
    {
      title: 'Measured',
      text: 'I tested five small models on 62 recruiter-style questions. Newer ones found more answers but also “answered” things my CV doesn’t say, like Kubernetes, so I kept this one.',
    },
  ],
  source: { label: 'Read the code and the evaluation', href: 'https://github.com/sudomuhammad/sudomuhammad.github.io' },
};

export const notFound = {
  title: 'Page not found',
  text: 'There’s nothing at this address. Everything is on one page.',
  back: 'Back to the map',
};

/** Questions offered in the ask bar. */
export const askSuggestions = [
  'Have you shipped RAG to production?',
  'Which agent frameworks do you use?',
  'Can you deploy on AWS?',
  'When can you start?',
];
