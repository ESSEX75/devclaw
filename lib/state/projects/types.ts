/**
 * Defines the persisted projects-registry envelope owned by the state layer.
 */
import type { Project } from "../../domain/index.js";

/** Data structure persisted in the projects registry store. */
export type ProjectsData = {
  /** Map of project slugs to project configurations. */
  projects: Record<string, Project>;
};

/** Immutable replacement returned by a projects-registry transaction. */
export type ProjectsUpdate<T> = {
  /** Complete registry value to persist after validation. */
  data: ProjectsData;
  /** Operation-specific result returned to the caller. */
  result: T;
};
