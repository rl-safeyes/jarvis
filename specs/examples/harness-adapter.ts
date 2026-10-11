/**
 * Proposed Jarvis contract, independent from provider SDKs.
 * Identifiers reference trusted registries; no credentials belong in requests.
 * Transport DTOs must additionally be validated at runtime.
 */
/** Extensible registry identifier; a string is not proof of an installed integration. */
export type HarnessName = string;
/** Omitted execution selection has exactly the same meaning as inherit. */
export type ExecutionSelection =
  | { mode: "inherit" }
  | { mode: "profile"; profile_ref: string };

export interface SpaceRuntimeSettings {
  defaultExecutionProfileId: string | null;
  revision: number;
}

export interface ExecutionProfileVersion {
  profileId: string;
  versionId: string;
  harnessInstallationId: string;
  accountProfileId: string;
  modelPolicyRef: string;
}

export interface ResolvedRuntime {
  profileId: string;
  profileVersionId: string;
  source: "default" | "agent";
  defaultRevision?: number;
  harnessInstallationId: string;
  harness: HarnessName;
  harnessVersion: string;
  adapterVersion: string;
  runtimeImageDigest: string;
}
export type Capability = "resume" | "permissions" | "structuredOutput" | "usage" | "cancel";
export type AccountState = "disconnected" | "connecting" | "ready" | "reauth_required" | "rate_limited" | "disabled";

export interface HarnessCapabilities {
  harness: HarnessName;
  harnessVersion: string;
  adapterVersion: string;
  supported: Capability[];
}

export interface AccountStatus {
  state: AccountState;
  verifiedModelIds: string[];
  checkedAt: string;
  retryAt?: string;
}

export interface RunRequest {
  runId: string;
  missionId: string;
  taskId: string;
  agentVersionId: string;
  resolvedRuntime: ResolvedRuntime;
  accountProfileId: string;
  modelId: string;
  workspaceId: string;
  inputArtifactIds: string[];
  objective: string;
  policyVersion: string;
  capabilityGrantIds: string[];
  budgetReservationId: string;
  deadlineAt: string;
}

export interface RunHandle {
  runId: string;
  nativeSessionId: string;
  resolvedRuntime: ResolvedRuntime;
  harness: HarnessName;
  harnessVersion: string;
  accountProfileId: string;
  workspaceId: string;
}

export type RunEvent = {
  eventId: string;
  runId: string;
  sequence: number;
  occurredAt: string;
} & (
  | { type: "run.started"; actualModelId: string }
  | { type: "text.delta"; text: string }
  | { type: "permission.requested"; requestId: string; actionDigest: string; actionSummary: string }
  | { type: "artifact.created"; artifactId: string }
  | { type: "usage.updated"; inputTokens?: number; outputTokens?: number; estimatedCostUsd?: number; measurement: "reported" | "estimated" | "unavailable" }
  | { type: "run.completed"; resultArtifactId: string }
  | { type: "run.failed"; code: "auth_required" | "quota" | "timeout" | "capability_missing" | "execution_error"; retryable: boolean; message: string }
  | { type: "run.cancelled"; remainingExternalEffects: string[] }
);

export interface AuthorizedPermissionDecision {
  requestId: string;
  actionDigest: string;
  decision: "allow_once" | "deny";
  policyDecisionId: string;
  expiresAt: string;
}

export interface HarnessAdapter {
  capabilities(): Promise<HarnessCapabilities>;
  /** Metadata-only check; inference probes are separate, budgeted operations. */
  accountStatus(accountProfileId: string): Promise<AccountStatus>;
  /** Idempotent on runId. Reusing runId with a different request must fail. */
  start(request: RunRequest): Promise<RunHandle>;
  /** Reattach to an existing run without implicitly starting another model turn. */
  attach(runId: string): Promise<RunHandle | null>;
  /** New attempt with explicit lineage and retained rights checks. */
  resume(previous: RunHandle, nextAttempt: RunRequest, checkpointArtifactId: string): Promise<RunHandle>;
  /** Normalized events are persisted by the execution service for replay. */
  events(handle: RunHandle, afterSequence?: number): AsyncIterable<RunEvent>;
  /** Verify policy decision, action digest and expiry before forwarding. */
  respondToPermission(handle: RunHandle, decision: AuthorizedPermissionDecision): Promise<void>;
  /** Completion means descendants are stopped or explicitly reported as unresolved. */
  cancel(handle: RunHandle, reason: string): Promise<{ stopped: boolean; unresolvedProcessIds: string[] }>;
}
