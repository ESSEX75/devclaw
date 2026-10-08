/** Owns provider fake call records used by behavioral tests; mirrors supported external capability payloads. */

import type { CreateIssueInput, StateLabel } from "../integrations/providers/contracts/index.js";

/** Recorded ensureLabel capability invocation, independent of workflow selection. */
type EnsureLabelCall = {
  /** Stable provider capability identity for this recorded invocation. */
  method: "ensureLabel";
  /** Exact invocation payload retained as behavioral test evidence. */
  args: {
    /** Explicit provider label name selected by application. */
    name: string;
    /** Application-selected label color. */
    color: string;
  };
};

/** Recorded createIssue capability invocation, independent of workflow selection. */
type CreateIssueCall = {
  /** Stable provider capability identity for this recorded invocation. */
  method: "createIssue";
  /** Exact invocation payload retained as behavioral test evidence. */
  args: CreateIssueInput;
};

/** Recorded listIssuesByLabel capability invocation, independent of workflow selection. */
type ListIssuesByLabelCall = {
  /** Stable provider capability identity for this recorded invocation. */
  method: "listIssuesByLabel";
  /** Exact invocation payload retained as behavioral test evidence. */
  args: {
    /** Exact provider label used as an observation filter or effect. */
    label: StateLabel;
  };
};

/** Recorded listIssues capability invocation, independent of workflow selection. */
type ListIssuesCall = {
  /** Stable provider capability identity for this recorded invocation. */
  method: "listIssues";
  /** Exact invocation payload retained as behavioral test evidence. */
  args: {
    /** Exact provider label used as an observation filter or effect. */
    label?: string;
    /** Explicit provider-side lifecycle collection filter. */
    state?: string;
  };
};

/** Recorded getIssue capability invocation, independent of workflow selection. */
type GetIssueCall = {
  /** Stable provider capability identity for this recorded invocation. */
  method: "getIssue";
  /** Exact invocation payload retained as behavioral test evidence. */
  args: {
    /** Provider-local issue identity whose effect or observation is recorded. */
    issueId: number;
  };
};

/** Recorded listComments capability invocation, independent of workflow selection. */
type ListCommentsCall = {
  /** Stable provider capability identity for this recorded invocation. */
  method: "listComments";
  /** Exact invocation payload retained as behavioral test evidence. */
  args: {
    /** Provider-local issue identity whose effect or observation is recorded. */
    issueId: number;
  };
};

/** Recorded addLabels capability invocation, independent of workflow selection. */
type AddLabelsCall = {
  /** Stable provider capability identity for this recorded invocation. */
  method: "addLabels";
  /** Exact invocation payload retained as behavioral test evidence. */
  args: {
    /** Provider-local issue identity whose effect or observation is recorded. */
    issueId: number;
    /** Exact provider labels selected for this effect. */
    labels: string[];
  };
};

/** Recorded addLabel capability invocation, independent of workflow selection. */
type AddLabelCall = {
  /** Stable provider capability identity for this recorded invocation. */
  method: "addLabel";
  /** Exact invocation payload retained as behavioral test evidence. */
  args: {
    /** Provider-local issue identity whose effect or observation is recorded. */
    issueId: number;
    /** Exact provider label used as an observation filter or effect. */
    label: string;
  };
};

/** Recorded removeLabels capability invocation, independent of workflow selection. */
type RemoveLabelsCall = {
  /** Stable provider capability identity for this recorded invocation. */
  method: "removeLabels";
  /** Exact invocation payload retained as behavioral test evidence. */
  args: {
    /** Provider-local issue identity whose effect or observation is recorded. */
    issueId: number;
    /** Exact provider labels selected for this effect. */
    labels: string[];
  };
};

/** Recorded closeIssue capability invocation, independent of workflow selection. */
type CloseIssueCall = {
  /** Stable provider capability identity for this recorded invocation. */
  method: "closeIssue";
  /** Exact invocation payload retained as behavioral test evidence. */
  args: {
    /** Provider-local issue identity whose effect or observation is recorded. */
    issueId: number;
  };
};

/** Recorded reopenIssue capability invocation, independent of workflow selection. */
type ReopenIssueCall = {
  /** Stable provider capability identity for this recorded invocation. */
  method: "reopenIssue";
  /** Exact invocation payload retained as behavioral test evidence. */
  args: {
    /** Provider-local issue identity whose effect or observation is recorded. */
    issueId: number;
  };
};

/** Recorded deleteIssue capability invocation, independent of workflow selection. */
type DeleteIssueCall = {
  /** Stable provider capability identity for this recorded invocation. */
  method: "deleteIssue";
  /** Exact invocation payload retained as behavioral test evidence. */
  args: {
    /** Provider-local issue identity whose effect or observation is recorded. */
    issueId: number;
  };
};

/** Recorded getMergedMRUrl capability invocation, independent of workflow selection. */
type GetMergedMRUrlCall = {
  /** Stable provider capability identity for this recorded invocation. */
  method: "getMergedMRUrl";
  /** Exact invocation payload retained as behavioral test evidence. */
  args: {
    /** Provider-local issue identity whose effect or observation is recorded. */
    issueId: number;
  };
};

/** Recorded getPrStatus capability invocation, independent of workflow selection. */
type GetPrStatusCall = {
  /** Stable provider capability identity for this recorded invocation. */
  method: "getPrStatus";
  /** Exact invocation payload retained as behavioral test evidence. */
  args: {
    /** Provider-local issue identity whose effect or observation is recorded. */
    issueId: number;
  };
};

/** Recorded mergePr capability invocation, independent of workflow selection. */
type MergePrCall = {
  /** Stable provider capability identity for this recorded invocation. */
  method: "mergePr";
  /** Exact invocation payload retained as behavioral test evidence. */
  args: {
    /** Provider-local issue identity whose effect or observation is recorded. */
    issueId: number;
  };
};

/** Recorded getPrDiff capability invocation, independent of workflow selection. */
type GetPrDiffCall = {
  /** Stable provider capability identity for this recorded invocation. */
  method: "getPrDiff";
  /** Exact invocation payload retained as behavioral test evidence. */
  args: {
    /** Provider-local issue identity whose effect or observation is recorded. */
    issueId: number;
  };
};

/** Recorded getPrReviewComments capability invocation, independent of workflow selection. */
type GetPrReviewCommentsCall = {
  /** Stable provider capability identity for this recorded invocation. */
  method: "getPrReviewComments";
  /** Exact invocation payload retained as behavioral test evidence. */
  args: {
    /** Provider-local issue identity whose effect or observation is recorded. */
    issueId: number;
  };
};

/** Recorded addComment capability invocation, independent of workflow selection. */
type AddCommentCall = {
  /** Stable provider capability identity for this recorded invocation. */
  method: "addComment";
  /** Exact invocation payload retained as behavioral test evidence. */
  args: {
    /** Provider-local issue identity whose effect or observation is recorded. */
    issueId: number;
    /** Complete text submitted for the recorded mutation. */
    body: string;
  };
};

/** Recorded editIssue capability invocation, independent of workflow selection. */
type EditIssueCall = {
  /** Stable provider capability identity for this recorded invocation. */
  method: "editIssue";
  /** Exact invocation payload retained as behavioral test evidence. */
  args: {
    /** Provider-local issue identity whose effect or observation is recorded. */
    issueId: number;
    /** Application-selected title/body edits for this call. */
    updates: {
      /** Explicit replacement title when supplied. */
      title?: string;
      /** Complete text submitted for the recorded mutation. */
      body?: string;
    };
  };
};

/** Recorded healthCheck capability invocation, independent of workflow selection. */
type HealthCheckCall = {
  /** Stable provider capability identity for this recorded invocation. */
  method: "healthCheck";
  /** Exact invocation payload retained as behavioral test evidence. */
  args: Record<string, never>;
};

/** Discriminated call evidence used to assert explicit provider effects and recovery ordering. */
export type ProviderCall = | EnsureLabelCall
  | CreateIssueCall
  | ListIssuesByLabelCall
  | ListIssuesCall
  | GetIssueCall
  | ListCommentsCall
  | AddLabelsCall
  | AddLabelCall
  | RemoveLabelsCall
  | CloseIssueCall
  | ReopenIssueCall
  | DeleteIssueCall
  | GetMergedMRUrlCall
  | GetPrStatusCall
  | MergePrCall
  | GetPrDiffCall
  | GetPrReviewCommentsCall
  | AddCommentCall
  | EditIssueCall
  | HealthCheckCall;
