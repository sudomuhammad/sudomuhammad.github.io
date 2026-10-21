// The scroll story, derived once from the CV and the map. Astro renders the
// cards from it and the browser builds each step's scene from it, so the two
// can't drift apart.
import { approach } from './approach';
import { chapterCopy } from './copy';
import { education, roles, skills, sourceOf, type Education, type Role } from './cv';
import { mappedPassages, passages, passagesFrom, themes, type MappedPassage, type Theme } from './map';

/** A "How I work" principle with its evidence resolved to map passages. */
export interface Principle {
  title: string;
  text: string;
  evidence: MappedPassage[];
}

/** A role on the Experience card, with the passages it lights on the map. */
export interface RoleEntry {
  role: Role;
  passages: number[];
}

export type Step =
  | { kind: 'intro'; id: string }
  | { kind: 'chapter'; id: string; chapter: ChapterId }
  | { kind: 'section'; id: string; theme: Theme; evidence: MappedPassage[]; skills: string[] }
  | { kind: 'approach'; id: string; principles: Principle[] }
  | { kind: 'experience'; id: string; roles: RoleEntry[]; education: Education[] }
  | { kind: 'method'; id: string }
  | { kind: 'contact'; id: string };

export type ChapterId = keyof typeof chapterCopy;

export interface Chapter {
  id: ChapterId;
  /** Short name for the menu. */
  nav: string;
  title: string;
  lede: string;
  steps: Step[];
}

// ------------------------------------------------------------------ work: one step per section, in themes.json order
// Every bullet point and the MSc appear under exactly one section, so the sections together
// carry the whole CV's detail; the Experience card only needs titles and dates.
const sectionSteps: Step[] = themes.map((theme) => ({
  kind: 'section',
  id: `work-${theme.key}`,
  theme,
  evidence: mappedPassages.filter((p) => p.theme === theme.id && (p.kind === 'point' || p.kind === 'education')),
  skills: skills.find((s) => s.theme === theme.key)?.items ?? [],
}));

// ------------------------------------------------------------------ approach: one step, all principles
const passageByTitle = new Map(mappedPassages.map((p) => [p.title, p]));

function evidenceFor(title: string): MappedPassage {
  const passage = passageByTitle.get(title);
  // Fail the build rather than ship a principle pointing at nothing.
  if (!passage) throw new Error(`approach.ts: no map passage titled "${title}"`);
  return passage;
}

const principles: Principle[] = approach.principles.map((p) => ({ ...p, evidence: p.evidence.map(evidenceFor) }));

// ------------------------------------------------------------------ experience: every role and degree on one card
const roleEntries: RoleEntry[] = roles.map((role) => ({
  role,
  passages: passagesFrom(sourceOf(role))
    .filter((p) => p.x !== null && p.kind !== 'tools')
    .map((p) => p.id),
}));

// ------------------------------------------------------------------ chapters
export const chapters: Chapter[] = [
  { id: 'work', ...chapterCopy.work, steps: [{ kind: 'chapter', id: 'work', chapter: 'work' }, ...sectionSteps] },
  { id: 'approach', ...chapterCopy.approach, steps: [{ kind: 'approach', id: 'approach', principles }] },
  {
    id: 'experience',
    ...chapterCopy.experience,
    steps: [{ kind: 'experience', id: 'experience', roles: roleEntries, education }],
  },
  { id: 'method', ...chapterCopy.method, steps: [{ kind: 'method', id: 'method' }] },
  { id: 'contact', ...chapterCopy.contact, steps: [{ kind: 'contact', id: 'contact' }] },
];

export const introStep: Step = { kind: 'intro', id: 'top' };

const orderedSteps: Step[] = [introStep, ...chapters.flatMap((c) => c.steps)];

/** Every step, in scroll order, by id. */
export const stepsById = new Map<string, Step>(orderedSteps.map((step) => [step.id, step]));

// ------------------------------------------------------------------ reading progress
// A scroll story has no visible page length, so the page shows how far through it the
// reader is, counted as the CV tokens (MiniLM WordPiece) its cards have shown so far.

const tokensOf = new Map(passages.map((p) => [p.id, p.tokens]));
const sum = (ids: number[]) => [...new Set(ids)].reduce((n, id) => n + (tokensOf.get(id) ?? 0), 0);
const contextOf = (role: Role) => passagesFrom(sourceOf(role)).filter((p) => p.kind === 'context');

const TOKENS_SHOWN: { [K in Step['kind']]: (step: Extract<Step, { kind: K }>) => number } = {
  intro: () => 0,
  chapter: () => 0,
  section: (step) => sum(step.evidence.map((p) => p.id)),
  approach: (step) => sum(step.principles.flatMap((p) => p.evidence.map((e) => e.id))),
  experience: (step) => sum(step.roles.flatMap(({ role }) => contextOf(role).map((p) => p.id))),
  method: () => 0,
  contact: () => 0,
};

const tokensShown = (step: Step) => (TOKENS_SHOWN[step.kind] as (s: Step) => number)(step);

export interface Progress {
  /** Tokens shown by this step and every step before it. */
  read: number;
  /** The chapter the step belongs to, for the label; null for the intro. */
  chapter: string | null;
}

export const READING_TOTAL = orderedSteps.reduce((n, step) => n + tokensShown(step), 0);

export const progressById: Map<string, Progress> = (() => {
  const chapterOf = new Map(chapters.flatMap((c) => c.steps.map((s) => [s.id, c.nav] as const)));
  let read = 0;
  return new Map(
    orderedSteps.map((step) => {
      read += tokensShown(step);
      return [step.id, { read, chapter: chapterOf.get(step.id) ?? null }];
    }),
  );
})();
