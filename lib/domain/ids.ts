export type ProjectSlug = string;
export type ChannelId = string;
export type IssueId = number;
export type WorkflowStateKey = string;
export type WorkflowLabel = string;
export type RoleId = string;
export type LevelId = string;
export type SessionKey = string;
export type ProviderKind = "github" | "gitlab";

export function projectSlug(value: string): ProjectSlug {
  return value;
}

export function issueId(value: number): IssueId {
  return value;
}

export function workflowStateKey(value: string): WorkflowStateKey {
  return value;
}

export function workflowLabel(value: string): WorkflowLabel {
  return value;
}

