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
  contact: {
    nav: 'Contact',
    title: 'Let’s talk',
    lede: 'Hiring for an AI engineer? Email is quickest.',
  },
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
