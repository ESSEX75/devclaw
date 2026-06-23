import type { IssueRuntimeState } from "../issues/index.js";

export type ProjectionMetadata = {
  projectSlug: string;
  issueId: number;
  projectionVersion: number;
  stateRef?: string;
  managedAt?: string;
};

export type ProjectionDiff = {
  expectedManagedLabels: string[];
  actualManagedLabels: string[];
  unmanagedLabels: string[];
  missingManagedLabels: string[];
  unexpectedManagedLabels: string[];
};

export type ManagedLabelOptions = {
  stateLabels: string[];
  roles?: string[];
};

export type ProjectionInput = {
  state: IssueRuntimeState;
  actualLabels: string[];
  options: ManagedLabelOptions;
};

