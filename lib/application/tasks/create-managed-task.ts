/**
 * Runs the durable managed-issue creation saga and restart-safe reconciliation.
 * Provider issues remain invisible to runtime lifecycle until projection read-back is verified and local state is committed.
 */
import { createHash } from "node:crypto";

import { log as auditLog } from "../../audit.js";
import {
  ISSUE_CREATION_ERROR,
  ISSUE_CREATION_STATUS,
  ISSUE_INTEGRITY_STATUS,
  type IssueCreationFailure,
  type IssueCreationOperation,
  type IssueCreationStatus,
  type IssueProviderId,
  type IssueRuntimeState,
  type NotifyBindingRef,
  type Project,
  REVIEW_POLICY,
  STATE_TYPE,
  TEST_POLICY,
  type WorkflowConfig,
} from "../../domain/index.js";
import {
  isProviderOperationError,
  type Issue,
  type IssueProvider,
  PROVIDER_OPERATION_ERROR,
} from "../../integrations/providers/index.js";
import {
  diffIssueProjection,
  expectedManagedLabels,
  extractIssueCreationMarker,
  extractIssueMetadata,
  metadataMatches,
  renderIssueCreationMarker,
  replaceIssueMetadata,
} from "../../projection/index.js";
import {
  newIssueCreationIdentity,
  readIssueCreationStore,
  updateIssueCreationStore,
  withIssueCreationLock,
  writeIssueRuntimeState,
} from "../../state/issues/index.js";
import { applyManagedLabelDiff } from "../projection/index.js";
import { withCreationPermit } from "./creation-governor.js";

const CREATION_STEPS = {
  PREFLIGHT: "preflight_completed",
  PROVIDER_STARTED: "provider_create_started",
  PROVIDER_CREATED: "provider_created",
  PROJECTION_VERIFIED: "projection_verified",
  LOCAL_COMMITTED: "local_state_committed",
  READY: "ready",
} as const;

/** Structured task creation result that never reports an incomplete provider issue as successful. */
export type CreatedManagedTask = {
  success: boolean;
  status: "ready" | "pending" | "failed" | "manual_repair_required";
  operationId: string;
  idempotencyKey: string;
  project: string;
  issue?: Issue;
  label: string;
  workflowState: string;
  role: string | null;
  completedSteps: string[];
  pendingSteps: string[];
  integrity: "ok" | "pending" | "error";
  error?: IssueCreationFailure;
  recovery?: { automatic: boolean; nextAttemptAt?: string; repairHint?: string };
  auditCorrelationId: string;
  announcementSuffix: string;
};

/** Input required to start or idempotently resume one managed issue creation. */
export type CreateManagedTaskInput = {
  workspaceDir: string;
  project: Pick<Project, "slug" | "channels">;
  providerType: IssueProviderId;
  provider: IssueProvider;
  workflow: WorkflowConfig;
  roles?: string[];
  title: string;
  description: string;
  assignees?: string[];
  notifyTarget?: NotifyBindingRef | null;
  owner?: string | null;
  idempotencyKey: string;
  requestedBy: string;
  workflowState?: string;
  assignedRole?: string | null;
  assignedLevel?: string | null;
};

/**
 * Create or resume one issue creation operation under its idempotency lock.
 * A repeated key with a different payload fails before any provider mutation.
 */
export function createManagedTaskIssue(opts: CreateManagedTaskInput): Promise<CreatedManagedTask> {
  return withIssueCreationLock(opts.workspaceDir, opts.project.slug, opts.idempotencyKey, async () => {
    const operation = await ensureCreationOperation(opts);

    await creationAudit(opts, operation, "issue_creation_requested");

    return withCreationPermit(`${opts.providerType}:${opts.project.slug}`, () => runCreationOperation(opts, operation, false));
  });
}

/** Reconcile bounded unfinished creation operations during heartbeat startup passes. */
export async function reconcileManagedTaskCreations(opts: {
  workspaceDir: string;
  project: Pick<Project, "slug" | "channels">;
  providerType: IssueProviderId;
  provider: IssueProvider;
  workflow: WorkflowConfig;
  roles?: string[];
  maxItems: number;
}): Promise<{ ready: number[]; pending: string[]; manual: string[] }> {
  const store = await readIssueCreationStore(opts.workspaceDir, opts.project.slug);
  const operations = Object.values(store.operations)
    .filter((operation) => operation.status !== ISSUE_CREATION_STATUS.READY)
    .slice(0, opts.maxItems);
  const ready: number[] = [];
  const pending: string[] = [];
  const manual: string[] = [];

  for (const operation of operations) {
    await withIssueCreationLock(opts.workspaceDir, opts.project.slug, operation.idempotencyKey, async () => {
      const current = (await readIssueCreationStore(opts.workspaceDir, opts.project.slug)).operations[operation.idempotencyKey];

      if (!current || current.status === ISSUE_CREATION_STATUS.READY) return;
      const operationOpts = {
        ...opts,
        title: current.input.title,
        description: current.input.body,
        assignees: current.input.assignees,
        notifyTarget: current.input.notifyTarget,
        owner: current.input.owner,
        idempotencyKey: current.idempotencyKey,
        requestedBy: "heartbeat_creation_reconciliation",
        workflowState: current.input.workflowState,
        assignedRole: current.input.assignedRole,
        assignedLevel: current.input.assignedLevel,
      };

      await creationAudit(operationOpts, current, "issue_creation_reconciliation_scheduled");
      const result = await withCreationPermit(
        `${opts.providerType}:${opts.project.slug}`,
        () => runCreationOperation(operationOpts, current, true),
      );

      if (result.success && result.issue) ready.push(result.issue.iid);
      else if (result.status === "manual_repair_required") manual.push(result.operationId);
      else pending.push(result.operationId);
    });
  }

  return { ready, pending, manual };
}

async function ensureCreationOperation(opts: CreateManagedTaskInput): Promise<IssueCreationOperation> {
  const workflowState = opts.workflowState ?? opts.workflow.initial;
  const initialState = requireCreationState(opts.workflow, workflowState);
  const input = {
    title: opts.title,
    body: opts.description,
    assignees: opts.assignees ?? [],
    workflowState,
    workflowLabel: initialState.label,
    assignedRole: opts.assignedRole !== undefined
      ? opts.assignedRole
      : initialState.type === STATE_TYPE.QUEUE ? initialState.role : null,
    assignedLevel: opts.assignedLevel ?? null,
    owner: opts.owner ?? null,
    reviewPolicy: opts.workflow.reviewPolicy ?? REVIEW_POLICY.HUMAN,
    testPolicy: opts.workflow.testPolicy ?? TEST_POLICY.SKIP,
    notifyTarget: opts.notifyTarget ?? null,
    provider: opts.providerType,
  };
  const draft = runtimeStateFor(input, opts.project.slug, 1);
  const expectedLabels = expectedManagedLabels(draft);
  const payloadHash = hashPayload({ projectSlug: opts.project.slug, input, expectedLabels });

  return updateIssueCreationStore(opts.workspaceDir, opts.project.slug, (store) => {
    const existing = store.operations[opts.idempotencyKey];

    if (existing) {
      if (existing.payloadHash !== payloadHash) {
        throw new IssueCreationFailureError({
          code: ISSUE_CREATION_ERROR.IDEMPOTENCY_CONFLICT,
          message: "Idempotency key is already bound to a different creation payload.",
          retryable: false,
        });
      }

      return existing;
    }

    const now = new Date().toISOString();
    const identity = newIssueCreationIdentity();
    const operation: IssueCreationOperation = {
      ...identity,
      idempotencyKey: opts.idempotencyKey,
      payloadHash,
      projectSlug: opts.project.slug,
      requestedBy: opts.requestedBy,
      requestedAt: now,
      updatedAt: now,
      status: ISSUE_CREATION_STATUS.CREATING,
      input,
      expectedLabels,
      completedSteps: [],
      pendingSteps: [
        CREATION_STEPS.PREFLIGHT,
        CREATION_STEPS.PROVIDER_STARTED,
        CREATION_STEPS.PROVIDER_CREATED,
        CREATION_STEPS.PROJECTION_VERIFIED,
        CREATION_STEPS.LOCAL_COMMITTED,
        CREATION_STEPS.READY,
      ],
      attempts: 0,
    };

    store.operations[opts.idempotencyKey] = operation;

    return operation;
  });
}

async function runCreationOperation(
  opts: CreateManagedTaskInput,
  operation: IssueCreationOperation,
  recovering: boolean,
): Promise<CreatedManagedTask> {
  let current = operation;

  if (current.status === ISSUE_CREATION_STATUS.READY) return resultFromOperation(current);
  if (current.status === ISSUE_CREATION_STATUS.MANUAL_REPAIR_REQUIRED) return resultFromOperation(current);
  if (current.status === ISSUE_CREATION_STATUS.CREATION_FAILED && current.lastError?.retryable === false) {
    return resultFromOperation(current);
  }

  if (current.retryAfter && Date.parse(current.retryAfter) > Date.now()) return resultFromOperation(current);

  if (!current.providerIssue) {
    if (recovering && current.completedSteps.includes(CREATION_STEPS.PROVIDER_STARTED)) {
      current = await failOperation(opts, current, ISSUE_CREATION_STATUS.MANUAL_REPAIR_REQUIRED, {
        code: ISSUE_CREATION_ERROR.PROVIDER_CREATE_UNKNOWN,
        message: "Gateway restarted after provider create began but before provider identity was persisted.",
        retryable: false,
      });

      return resultFromOperation(current);
    }

    const quota = await safeRateLimit(opts.provider);
    const estimatedRequests = 4;

    if (quota && quota.remaining < estimatedRequests) {
      current = await failOperation(opts, current, ISSUE_CREATION_STATUS.CREATION_FAILED, {
        code: ISSUE_CREATION_ERROR.PROVIDER_RATE_LIMITED,
        message: "Provider quota is below the conservative creation request budget.",
        retryable: true,
        retryAfter: quota.resetAt ?? new Date(Date.now() + 60_000).toISOString(),
      });

      return resultFromOperation(current);
    }

    current = await markStep(opts, current, CREATION_STEPS.PREFLIGHT, ISSUE_CREATION_STATUS.CREATING);
    await creationAudit(opts, current, "issue_creation_preflight_completed");
    current = await markStep(opts, current, CREATION_STEPS.PROVIDER_STARTED, ISSUE_CREATION_STATUS.CREATING, true);
    await creationAudit(opts, current, "issue_creation_provider_started");

    try {
      const providerIssue = await opts.provider.createIssue({
        title: current.input.title,
        body: appendCreationMarker(current.input.body, current.operationId),
        labels: current.expectedLabels,
        assignees: current.input.assignees,
      });

      current = await updateOperation(opts, current.idempotencyKey, (target) => {
        transitionStatus(target, ISSUE_CREATION_STATUS.PROVIDER_CREATED);
        target.providerIssue = { issueId: providerIssue.iid, url: providerIssue.web_url, createdAt: new Date().toISOString() };
        completeStep(target, CREATION_STEPS.PROVIDER_CREATED);
        target.lastError = undefined;
        target.retryAfter = undefined;
      });
      await creationAudit(opts, current, "issue_creation_provider_created");
    } catch (error) {
      const failure = creationFailureFromProvider(error);
      const status = failure.code === ISSUE_CREATION_ERROR.PROVIDER_CREATE_UNKNOWN
        ? ISSUE_CREATION_STATUS.MANUAL_REPAIR_REQUIRED
        : ISSUE_CREATION_STATUS.CREATION_FAILED;

      current = await failOperation(opts, current, status, failure);

      return resultFromOperation(current);
    }
  }

  if (current.status === ISSUE_CREATION_STATUS.CREATION_FAILED && current.providerIssue) {
    current = await updateOperation(opts, current.idempotencyKey, (target) => transitionStatus(target, ISSUE_CREATION_STATUS.PROVIDER_CREATED));
  }

  if (current.status === ISSUE_CREATION_STATUS.CREATION_FAILED && !current.providerIssue) {
    current = await updateOperation(opts, current.idempotencyKey, (target) => {
      transitionStatus(target, ISSUE_CREATION_STATUS.CREATING);
      target.completedSteps = target.completedSteps.filter((step) => step !== CREATION_STEPS.PROVIDER_STARTED);
    });

    return runCreationOperation(opts, current, false);
  }

  if (current.status === ISSUE_CREATION_STATUS.PROVIDER_CREATED && current.providerIssue) {
    try {
      await creationAudit(opts, current, "issue_creation_projection_started");
      current = await reconcileCreatedProviderIssue(opts, current);
      await creationAudit(opts, current, "issue_creation_projection_verified");
    } catch (error) {
      const failure = error instanceof IssueCreationFailureError
        ? error.failure
        : {
          code: ISSUE_CREATION_ERROR.PROJECTION_APPLY_FAILED,
          message: error instanceof Error ? error.message : String(error),
          retryable: true,
        };

      current = await failOperation(opts, current, ISSUE_CREATION_STATUS.PROVIDER_CREATED, failure);

      return resultFromOperation(current);
    }
  }

  if (current.status === ISSUE_CREATION_STATUS.PROJECTION_VERIFIED && current.providerIssue) {
    try {
      const providerIssue = await opts.provider.getIssue(current.providerIssue.issueId);

      await writeIssueRuntimeState({
        workspaceDir: opts.workspaceDir,
        project: opts.project,
        issue: providerIssue,
        providerType: current.input.provider,
        creationOperationId: current.operationId,
        workflow: opts.workflow,
        workflowLabel: current.input.workflowLabel,
        workflowState: current.input.workflowState,
        assignedRole: current.input.assignedRole,
        assignedLevel: current.input.assignedLevel,
        owner: current.input.owner,
        notifyTarget: current.input.notifyTarget,
        reviewPolicy: current.input.reviewPolicy,
        testPolicy: current.input.testPolicy,
        integrityStatus: ISSUE_INTEGRITY_STATUS.OK,
      });
      current = await markStep(opts, current, CREATION_STEPS.LOCAL_COMMITTED, ISSUE_CREATION_STATUS.PROJECTION_VERIFIED);
      await creationAudit(opts, current, "issue_creation_local_state_committed");
      current = await markStep(opts, current, CREATION_STEPS.READY, ISSUE_CREATION_STATUS.READY);
      await creationAudit(opts, current, recovering ? "issue_creation_reconciled" : "issue_creation_ready");
    } catch (error) {
      current = await failOperation(opts, current, ISSUE_CREATION_STATUS.PROJECTION_VERIFIED, {
        code: ISSUE_CREATION_ERROR.LOCAL_COMMIT_FAILED,
        message: error instanceof Error ? error.message : String(error),
        retryable: true,
      });
    }
  }

  return resultFromOperation(current);
}

async function reconcileCreatedProviderIssue(
  opts: CreateManagedTaskInput,
  operation: IssueCreationOperation,
): Promise<IssueCreationOperation> {
  const providerRef = operation.providerIssue;

  if (!providerRef) throw new Error("Provider identity is missing from provider_created operation.");
  let issue = await opts.provider.getIssue(providerRef.issueId);
  const draft = runtimeStateFor(operation.input, operation.projectSlug, issue.iid);
  const diff = diffIssueProjection({
    state: draft,
    actualLabels: issue.labels,
    options: { stateLabels: Object.values(opts.workflow.states).map((state) => state.label), roles: opts.roles },
  });

  await applyManagedLabelDiff({ issueId: issue.iid, provider: opts.provider, diff, workflow: opts.workflow, roles: opts.roles ?? [] });
  const metadata = { projectSlug: operation.projectSlug, issueId: issue.iid, projectionVersion: 1 };

  if (!metadataMatches(extractIssueMetadata(issue.description), metadata)) {
    await opts.provider.editIssue(issue.iid, { body: replaceIssueMetadata(issue.description, metadata) });
  }

  issue = await opts.provider.getIssue(issue.iid);
  const verifiedDiff = diffIssueProjection({
    state: draft,
    actualLabels: issue.labels,
    options: { stateLabels: Object.values(opts.workflow.states).map((state) => state.label), roles: opts.roles },
  });
  const verifiedMetadata = metadataMatches(extractIssueMetadata(issue.description), metadata);
  const markerMatches = extractIssueCreationMarker(issue.description) === operation.operationId;
  const bodyMatches = operation.input.body.trim() === ""
    || (issue.description ?? "").includes(operation.input.body.trim());

  if (
    issue.title !== operation.input.title
    || !bodyMatches
    || verifiedDiff.missingManagedLabels.length > 0
    || verifiedDiff.unexpectedManagedLabels.length > 0
    || !verifiedMetadata
    || !markerMatches
  ) {
    throw new IssueCreationFailureError({
      code: ISSUE_CREATION_ERROR.PROJECTION_VERIFICATION_FAILED,
      message: "Provider read-back does not match the expected creation projection.",
      retryable: true,
    });
  }

  return updateOperation(opts, operation.idempotencyKey, (target) => {
    transitionStatus(target, ISSUE_CREATION_STATUS.PROJECTION_VERIFIED);
    completeStep(target, CREATION_STEPS.PROJECTION_VERIFIED);
    target.lastError = undefined;
    target.retryAfter = undefined;
  });
}

function runtimeStateFor(
  input: IssueCreationOperation["input"],
  projectSlug: string,
  issueId: number,
): IssueRuntimeState {
  const now = new Date().toISOString();

  return {
    projectSlug,
    issueId,
    provider: input.provider,
    workflowState: input.workflowState,
    workflowLabel: input.workflowLabel,
    assignedRole: input.assignedRole,
    assignedLevel: input.assignedLevel,
    owner: input.owner,
    reviewPolicy: input.reviewPolicy,
    testPolicy: input.testPolicy,
    notifyTarget: input.notifyTarget,
    activeWorker: null,
    integrityStatus: ISSUE_INTEGRITY_STATUS.OK,
    integrityErrors: [],
    projectionVersion: 1,
    createdAt: now,
    updatedAt: now,
  };
}

function requireCreationState(workflow: WorkflowConfig, workflowState: string) {
  const initialState = workflow.states[workflowState];

  if (!initialState) throw new Error(`Creation workflow state "${workflowState}" not found.`);
  if (initialState.type !== STATE_TYPE.HOLD && initialState.type !== STATE_TYPE.QUEUE) {
    throw new Error(`Creation workflow state "${workflowState}" must be hold or queue.`);
  }

  return initialState;
}

function appendCreationMarker(body: string, operationId: string): string {
  const marker = renderIssueCreationMarker(operationId);

  return body.trim() ? `${body.trimEnd()}\n\n${marker}` : marker;
}

async function markStep(
  opts: CreateManagedTaskInput,
  operation: IssueCreationOperation,
  step: string,
  status: IssueCreationStatus,
  incrementAttempt = false,
): Promise<IssueCreationOperation> {
  return updateOperation(opts, operation.idempotencyKey, (target) => {
    transitionStatus(target, status);
    completeStep(target, step);
    if (incrementAttempt) target.attempts += 1;
  });
}

async function failOperation(
  opts: CreateManagedTaskInput,
  operation: IssueCreationOperation,
  status: IssueCreationStatus,
  failure: IssueCreationFailure,
): Promise<IssueCreationOperation> {
  const updated = await updateOperation(opts, operation.idempotencyKey, (target) => {
    transitionStatus(target, status);
    target.lastError = failure;
    target.retryAfter = failure.retryAfter;
  });

  await creationAudit(opts, updated, status === ISSUE_CREATION_STATUS.MANUAL_REPAIR_REQUIRED
    ? "issue_creation_manual_repair_required"
    : "issue_creation_failed");

  return updated;
}

async function updateOperation(
  opts: Pick<CreateManagedTaskInput, "workspaceDir" | "project">,
  idempotencyKey: string,
  update: (operation: IssueCreationOperation) => void,
): Promise<IssueCreationOperation> {
  return updateIssueCreationStore(opts.workspaceDir, opts.project.slug, (store) => {
    const operation = store.operations[idempotencyKey];

    if (!operation) throw new Error(`Issue creation operation "${idempotencyKey}" disappeared.`);
    update(operation);
    operation.updatedAt = new Date().toISOString();

    return operation;
  });
}

function transitionStatus(operation: IssueCreationOperation, next: IssueCreationStatus): void {
  const allowed: Record<IssueCreationStatus, readonly IssueCreationStatus[]> = {
    [ISSUE_CREATION_STATUS.CREATING]: [
      ISSUE_CREATION_STATUS.CREATING,
      ISSUE_CREATION_STATUS.PROVIDER_CREATED,
      ISSUE_CREATION_STATUS.CREATION_FAILED,
      ISSUE_CREATION_STATUS.MANUAL_REPAIR_REQUIRED,
    ],
    [ISSUE_CREATION_STATUS.PROVIDER_CREATED]: [
      ISSUE_CREATION_STATUS.PROVIDER_CREATED,
      ISSUE_CREATION_STATUS.PROJECTION_VERIFIED,
      ISSUE_CREATION_STATUS.CREATION_FAILED,
    ],
    [ISSUE_CREATION_STATUS.PROJECTION_VERIFIED]: [
      ISSUE_CREATION_STATUS.PROJECTION_VERIFIED,
      ISSUE_CREATION_STATUS.READY,
      ISSUE_CREATION_STATUS.CREATION_FAILED,
    ],
    [ISSUE_CREATION_STATUS.READY]: [ISSUE_CREATION_STATUS.READY],
    [ISSUE_CREATION_STATUS.CREATION_FAILED]: [
      ISSUE_CREATION_STATUS.CREATING,
      ISSUE_CREATION_STATUS.PROVIDER_CREATED,
      ISSUE_CREATION_STATUS.CREATION_FAILED,
      ISSUE_CREATION_STATUS.MANUAL_REPAIR_REQUIRED,
    ],
    [ISSUE_CREATION_STATUS.MANUAL_REPAIR_REQUIRED]: [ISSUE_CREATION_STATUS.MANUAL_REPAIR_REQUIRED],
  };

  if (!allowed[operation.status].includes(next)) {
    throw new Error(`Invalid issue creation transition ${operation.status} -> ${next}.`);
  }

  operation.status = next;
}

function completeStep(operation: IssueCreationOperation, step: string): void {
  if (!operation.completedSteps.includes(step)) operation.completedSteps.push(step);
  operation.pendingSteps = operation.pendingSteps.filter((candidate) => candidate !== step);
}

function resultFromOperation(operation: IssueCreationOperation): CreatedManagedTask {
  const ready = operation.status === ISSUE_CREATION_STATUS.READY;
  const manual = operation.status === ISSUE_CREATION_STATUS.MANUAL_REPAIR_REQUIRED;
  const failed = operation.status === ISSUE_CREATION_STATUS.CREATION_FAILED && !operation.lastError?.retryable;
  const issue = operation.providerIssue ? {
    iid: operation.providerIssue.issueId,
    title: operation.input.title,
    description: operation.input.body,
    labels: operation.expectedLabels,
    state: "opened",
    web_url: operation.providerIssue.url,
  } : undefined;

  return {
    success: ready,
    status: ready ? "ready" : manual ? "manual_repair_required" : failed ? "failed" : "pending",
    operationId: operation.operationId,
    idempotencyKey: operation.idempotencyKey,
    project: operation.projectSlug,
    issue,
    label: operation.input.workflowLabel,
    workflowState: operation.input.workflowState,
    role: operation.input.assignedRole,
    completedSteps: operation.completedSteps,
    pendingSteps: operation.pendingSteps,
    integrity: ready ? "ok" : manual || failed ? "error" : "pending",
    error: operation.lastError,
    recovery: ready ? undefined : {
      automatic: !manual && operation.lastError?.retryable !== false,
      nextAttemptAt: operation.retryAfter,
      repairHint: operation.providerIssue
        ? `Run issue_repair for provider issue #${operation.providerIssue.issueId} after creation reconciliation stops retrying.`
        : undefined,
    },
    auditCorrelationId: operation.auditCorrelationId,
    announcementSuffix: ready
      ? operation.input.assignedRole
        ? "\nQueued for heartbeat dispatch."
        : "\nWaiting in the initial hold state. Use task_start when the task is ready for dispatch."
      : "\nCreation is pending reconciliation; the issue is not available to heartbeat or workers.",
  };
}

async function safeRateLimit(provider: IssueProvider) {
  try {
    return await provider.getRateLimitStatus?.();
  } catch {
    return undefined;
  }
}

function creationFailureFromProvider(error: unknown): IssueCreationFailure {
  if (isProviderOperationError(error)) {
    if (error.outcomeUnknown) {
      return { code: ISSUE_CREATION_ERROR.PROVIDER_CREATE_UNKNOWN, message: error.message, retryable: false };
    }

    if (error.code === PROVIDER_OPERATION_ERROR.RATE_LIMITED) {
      return { code: ISSUE_CREATION_ERROR.PROVIDER_RATE_LIMITED, message: error.message, retryable: true, retryAfter: error.retryAfter };
    }

    return { code: ISSUE_CREATION_ERROR.PROVIDER_CREATE_FAILED, message: error.message, retryable: error.retryable };
  }

  return {
    code: ISSUE_CREATION_ERROR.PROVIDER_CREATE_UNKNOWN,
    message: error instanceof Error ? error.message : String(error),
    retryable: false,
  };
}

function hashPayload(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function creationAudit(opts: CreateManagedTaskInput, operation: IssueCreationOperation, event: string): Promise<void> {
  await auditLog(opts.workspaceDir, event, {
    operationId: operation.operationId,
    idempotencyKey: operation.idempotencyKey,
    correlationId: operation.auditCorrelationId,
    projectSlug: operation.projectSlug,
    requestedBy: operation.requestedBy,
    status: operation.status,
    providerIssueId: operation.providerIssue?.issueId,
    completedSteps: operation.completedSteps,
    pendingSteps: operation.pendingSteps,
    error: operation.lastError,
  });
}

class IssueCreationFailureError extends Error {
  readonly failure: IssueCreationFailure;

  constructor(failure: IssueCreationFailure) {
    super(failure.message);
    this.name = "IssueCreationFailureError";
    this.failure = failure;
  }
}
