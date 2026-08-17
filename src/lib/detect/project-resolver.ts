import type { Project, ProjectMatch } from '@/lib/types';
import { containsPhrase, normalizeKey } from './normalize-text';

/**
 * Resolves free-text project names against the alias registry.
 *
 * The registry is passed in (loaded from the database), so this module has no
 * knowledge of any specific project — adding "Olympus Tower 2" is a row in
 * `project_aliases`, not a code change (requirement 2).
 */
export class ProjectResolver {
  private readonly byKey = new Map<string, { project: Project; alias: string }>();
  /** Aliases sorted longest-first so "Marina Golden Bay" beats "Marina". */
  private readonly ordered: { key: string; alias: string; project: Project }[] = [];

  private readonly projects: Project[];

  constructor(projects: Project[]) {
    this.projects = projects;
    for (const project of projects) {
      const all = [project.name, project.code, ...project.aliases];
      for (const alias of all) {
        const key = normalizeKey(alias);
        if (!key) continue;
        if (!this.byKey.has(key)) {
          this.byKey.set(key, { project, alias });
          this.ordered.push({ key, alias, project });
        }
      }
    }
    this.ordered.sort((a, b) => b.key.length - a.key.length);
  }

  /** Exact match on the whole string (after normalisation). */
  exact(text: string): ProjectMatch | null {
    const hit = this.byKey.get(normalizeKey(text));
    if (!hit) return null;
    return match(hit.project, hit.alias, 'cell', 1);
  }

  /**
   * Finds the best alias occurring anywhere in `text`.
   *
   * Confidence reflects how much of the string the alias explains, so a file
   * named "VTR.xlsx" scores higher than a 300-character sentence containing
   * "VTR" in passing.
   */
  find(text: string, matchedIn: ProjectMatch['matchedIn']): ProjectMatch | null {
    const key = normalizeKey(text);
    if (!key) return null;

    const exactHit = this.byKey.get(key);
    if (exactHit) return match(exactHit.project, exactHit.alias, matchedIn, 1);

    for (const entry of this.ordered) {
      // Single/double-character aliases are too noisy for substring matching.
      if (entry.key.length < 3) continue;
      if (!key.includes(entry.key)) continue;

      // Re-check on the spaced form so "VTR" cannot match inside "convtreport".
      //
      // A run-together name like "VTRAdvance.xlsx" has no separator for the
      // boundary check to find, so an edge match on the punctuation-stripped
      // key is also accepted — but only for aliases long enough to be
      // unambiguous. Without that length guard a three-letter code like "GEN"
      // would claim "General Ledger".
      const edgeMatch =
        entry.key.length >= 4 && (key.startsWith(entry.key) || key.endsWith(entry.key));

      if (!containsPhrase(text, entry.alias) && !edgeMatch) continue;
      const coverage = entry.key.length / key.length;
      const confidence = Math.max(0.35, Math.min(0.95, 0.45 + coverage * 0.5));
      return match(entry.project, entry.alias, matchedIn, confidence);
    }
    return null;
  }

  /**
   * Resolves a file by looking at its name, then its sheet names, then the
   * first rows of text — the order finance staff would read it themselves.
   */
  resolveFile(fileName: string, sheetNames: string[], sampleText: string[]): ProjectMatch {
    const fromFile = this.find(fileName, 'file-name');
    if (fromFile && fromFile.confidence >= 0.5) return fromFile;

    for (const sheet of sheetNames) {
      const hit = this.find(sheet, 'sheet-name');
      if (hit && hit.confidence >= 0.5) return hit;
    }

    for (const text of sampleText) {
      const hit = this.find(text, 'cell');
      if (hit && hit.confidence >= 0.6) return hit;
    }

    // Fall back to the weak file-name signal rather than giving up entirely.
    return fromFile ?? unresolved();
  }

  get all(): Project[] {
    return this.projects;
  }

  byId(id: string): Project | null {
    return this.projects.find((p) => p.id === id) ?? null;
  }
}

function match(
  project: Project,
  alias: string,
  matchedIn: ProjectMatch['matchedIn'],
  confidence: number,
): ProjectMatch {
  return {
    projectId: project.id,
    projectCode: project.code,
    projectName: project.name,
    matchedAlias: alias,
    matchedIn,
    confidence,
  };
}

export function unresolved(): ProjectMatch {
  return {
    projectId: null,
    projectCode: null,
    projectName: null,
    matchedAlias: null,
    matchedIn: null,
    confidence: 0,
  };
}
