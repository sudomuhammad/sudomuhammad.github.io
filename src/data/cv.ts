// Typed access to the CV. Content lives in cv.json, which the ML pipeline
// (ml/build_map.py) also reads; edit it there, then run `npm run map`.
import data from './cv.json';

/** The downloadable CV, served from public/. A public copy: no phone number. */
export const CV_PDF = '/Muhammad_Uzair_CV.pdf';

/** A theme key from themes.json. */
export type ThemeKey = string;

export interface Role {
  title: string;
  org: string;
  place?: string;
  /** MM/YYYY */
  start: string;
  /** MM/YYYY or "Present" */
  end: string;
  theme: ThemeKey;
  context: string;
  /** `title` is the short name drawn on the map; `text` is the bullet as written. A point takes the role's theme unless it names one. */
  points: { title: string; text: string; theme?: ThemeKey }[];
  tech: string[];
}

export interface Education {
  degree: string;
  org: string;
  start: string;
  end: string;
  theme?: ThemeKey;
  note?: string;
}

export interface SkillGroup {
  theme: ThemeKey;
  items: string[];
}

export const person = data.person;
export const roles: Role[] = data.roles;
export const education: Education[] = data.education;
export const skills: SkillGroup[] = data.skills;

/** How ml/build_map.py names a role's passages: "AI Engineer, Money Means". */
export const sourceOf = (role: Role) => `${role.title}, ${role.org}`;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const month = (date: string) => {
  const [mm, yyyy] = date.split('/');
  return yyyy ? `${MONTHS[Number(mm) - 1]} ${yyyy}` : date;
};

/** "08/2025", "10/2026" -> "Aug 2025 – Oct 2026" */
export const period = ({ start, end }: { start: string; end: string }) => `${month(start)} – ${month(end)}`;
