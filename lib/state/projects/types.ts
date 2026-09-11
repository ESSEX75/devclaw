/**
 * Defines the persisted projects-registry envelope owned by the state layer.
 */
import type { Project } from "../../domain/index.js";

/** Data structure persisted in the projects registry store. */
export type ProjectsData = {
  /** Map of project slugs to project configurations. */
  projects: Record<string, Project>;
};
