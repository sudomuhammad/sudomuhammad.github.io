// Typed access to the CV. Content lives in cv.json, which the ML pipeline
// (ml/build_map.py) also reads; edit it there, then run `npm run map`.
import data from './cv.json';

export interface Role {
  title: string;
  org: string;
  place?: string;
  start: string;
  end: string;
  context: string;
  /** `title` is the short name drawn on the map; `text` is the bullet as written. */
  points: { title: string; text: string }[];
  tech: string[];
}

export interface Education {
  degree: string;
  org: string;
  start: string;
  end: string;
  note?: string;
}

export interface SkillGroup {
  group: string;
  items: string[];
}

export const person = data.person;
export const roles: Role[] = data.roles;
export const education: Education[] = data.education;
export const skills: SkillGroup[] = data.skills;
