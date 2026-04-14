export interface Session {
  id: string; // UUID
  name: string;
  created_at: string;
  updated_at: string;
  metadata: Record<string, any>;
}

export interface Message {
  id: number;
  session_id: string;
  role: 'system' | 'user' | 'assistant';
  content: string;
  model: string | null;
  token_count: number | null;
  created_at: string;
  metadata: Record<string, any>;
}

export interface StructuredResponseArtifact {
  family: string;
  title: string;
  source_tool: string;
  data: Record<string, any>;
}

export interface StructuredResponseCitation {
  source_id: string;
  title: string;
  url: string;
  snippet?: string | null;
}

export interface StructuredResponseContentItem {
  content_type: string;
  text: string;
  citation?: StructuredResponseCitation | null;
  artifact?: StructuredResponseArtifact | null;
}

export interface StructuredResponseOutputItem {
  id?: string;
  item_type: string;
  role: string;
  content: StructuredResponseContentItem[];
  status: string;
}

export interface StructuredResponseEnvelope {
  warnings?: string[];
  policy_decisions?: any[];
  audit_events?: any[];
  turn_context?: Record<string, any>;
  output?: StructuredResponseOutputItem[];
}

export interface QuantlabRunStatusMetadata {
  command: 'quantlab_run';
  status: 'running' | 'success' | 'error';
  started_at: string;
  finished_at?: string | null;
  prompt?: string | null;
  input?: Record<string, any> | null;
  run_id?: string | null;
  artifact_count?: number | null;
  error_count?: number | null;
  last_event?: string | null;
}

export interface ExecutionCommandStatusMetadata {
  command: 'quantlab_run' | 'goal_run' | 'reasoning_run' | 'pipeline_run';
  status: 'running' | 'success' | 'error';
  started_at: string;
  finished_at?: string | null;
  prompt?: string | null;
  input?: Record<string, any> | null;
  run_id?: string | null;
  artifact_count?: number | null;
  error_count?: number | null;
  last_event?: string | null;
}

export interface AutomationCommandStatusMetadata {
  command: 'cron_create' | 'trigger_create';
  status: 'running' | 'success' | 'error';
  started_at: string;
  finished_at?: string | null;
  prompt?: string | null;
  input?: Record<string, any> | null;
  automation_id?: string | null;
  automation_kind?: 'cron_job' | 'trigger' | null;
  last_event?: string | null;
}

export interface CreateSessionRequest {
  name: string;
  metadata?: Record<string, any>;
}

export interface UpdateSessionRequest {
  name?: string;
  metadata?: Record<string, any>;
}

export interface CreateMessageRequest {
  role: string;
  content: string;
  model?: string;
  token_count?: number;
  metadata?: Record<string, any>;
}

export interface WsServerMessage {
  type: 'chunk' | 'done' | 'error' | 'status';
  content: string;
}

export interface WsClientMessage {
  type: 'message' | 'cancel';
  content: string;
  stream?: boolean;
  search?: boolean;
  reason?: boolean;
  workspace_context?: WorkspaceContextPack | null;
}

export interface WorkspaceContextPack {
  version: 'v1';
  workspaceId?: string | null;
  conversationId?: string | null;
  summary?: string | null;
  sections: Array<{
    id: string;
    kind: string;
    title?: string | null;
    text: string;
    priority: number;
    token_estimate: number;
    provenance: Array<{
      source_kind: string;
      source_id: string;
      label?: string | null;
      path?: string | null;
      line_start?: number | null;
      line_end?: number | null;
      inclusion_reason: string;
      score?: number | null;
    }>;
  }>;
  tokenBudget: {
    totalTokens: number;
    reservedForOutput: number;
    availableForContext: number;
    usedForContext: number;
  };
  diagnostics: {
    retrievalStrategy: string;
    assemblyNotes: string[];
  };
}

export interface PaginationQuery {
  limit?: number;
  offset?: number;
}
export interface MemoryUsageEntry {
  tag: string;
  usage_bytes: number;
}

export interface SystemStats {
  total_sessions: number;
  total_messages: number;
  total_tokens: number;
  db_size_bytes: number;
  memory_usage: MemoryUsageEntry[];
}

export interface ProviderInfo {
  id: string;
  active: boolean;
  supported_models: string[];
  status: 'online' | 'offline' | 'unverified';
}

export interface Pipeline {
  id: number;
  name: string;
  definition: {
    stages: Array<{
      stage_type: string;
      config: Record<string, any>;
    }>;
  };
  created_at: string;
  updated_at: string;
}

export interface PipelineExecuteResult {
  final_answer: string;
  trace: string[];
  tool_calls: any[];
  intermediate_results: any[];
}

export interface StepbitCoreStatus {
  online: boolean;
  message: string;
}

export interface QuantlabRunRequest {
  prompt: string;
  strategy: string;
  ticker: string;
  start: string;
  end: string;
  interval?: string | null;
  rsi_buy_max?: number | null;
  rsi_sell_min?: number | null;
  cooldown_days?: number | null;
  timeout_seconds?: number | null;
  run_label?: string | null;
}

export interface GoalRunRequest {
  prompt: string;
  goal: string;
}

export interface ReasoningRunRequest {
  prompt: string;
  question: string;
  max_tokens?: number | null;
}

export interface PipelineRunRequest {
  prompt: string;
  pipeline_id?: number | null;
  pipeline_name?: string | null;
  question: string;
}

export interface ExecutionCommandResponse {
  message_id: number;
  run_id: string;
  summary: string;
  structured_response: StructuredResponseEnvelope & {
    metadata?: Record<string, any>;
  };
}

export type AutomationExecutionType = 'Goal' | 'ReasoningGraph' | 'Pipeline';
export type AutomationActionKind = 'goal' | 'reasoning' | 'pipeline';
export type AutomationConditionOperator = 'equals' | 'contains' | 'gt' | 'lt';
export type RetryBackoffStrategy = 'Fixed' | 'Exponential';

export interface RetryPolicy {
  max_retries: number;
  backoff_strategy: RetryBackoffStrategy;
  initial_delay_seconds: number;
}

export interface CronCreateRequest {
  prompt: string;
  job_id: string;
  schedule: string;
  execution_type: AutomationExecutionType;
  enabled?: boolean | null;
  goal?: string | null;
  reasoning_prompt?: string | null;
  max_tokens?: number | null;
  pipeline_id?: number | null;
  pipeline_name?: string | null;
  input_json?: Record<string, any> | null;
  retry_policy?: RetryPolicy | null;
}

export type TriggerCondition =
  | { Equals: { path: string; value: unknown } }
  | { Contains: { path: string; value: unknown } }
  | { GreaterThan: { path: string; value: unknown } }
  | { LessThan: { path: string; value: unknown } }
  | { And: TriggerCondition[] }
  | { Or: TriggerCondition[] }
  | { Not: TriggerCondition };

export type TriggerAction =
  | { Goal: { goal: string } }
  | { ReasoningGraph: { graph: Record<string, any> } }
  | { Pipeline: { pipeline: Record<string, any> } };

export interface TriggerCreateRequest {
  prompt: string;
  trigger_id: string;
  event_type: string;
  action_kind: AutomationActionKind;
  goal?: string | null;
  reasoning_prompt?: string | null;
  max_tokens?: number | null;
  pipeline_id?: number | null;
  pipeline_name?: string | null;
  condition?: TriggerCondition | null;
}

export interface AutomationCommandResponse {
  message_id: number;
  automation_id: string;
  automation_kind: 'cron_job' | 'trigger';
  summary: string;
  metadata: Record<string, any>;
}

export type ExecutionKind = 'goal' | 'pipeline' | 'reasoning' | 'cron_job' | 'trigger';
export type ExecutionStatus = 'queued' | 'running' | 'completed' | 'failed';
export type ExecutionStepStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface ExecutionLinks {
  goal_run_id?: string | null;
  response_id?: string | null;
  cron_job_id?: string | null;
  trigger_id?: string | null;
}

export interface ExecutionStep {
  id: string;
  kind: string;
  title: string;
  status: ExecutionStepStatus;
  created_at: number;
  updated_at: number;
  summary?: string | null;
  payload?: Record<string, any> | null;
}

export interface ExecutionArtifact {
  id: string;
  family: string;
  title: string;
  source?: string | null;
  data: Record<string, any>;
}

export interface ExecutionEvent {
  id: string;
  run_id: string;
  event_type: string;
  timestamp: number;
  payload?: Record<string, any> | null;
}

export interface ExecutionRun {
  id: string;
  kind: ExecutionKind;
  parent_id?: string | null;
  title: string;
  status: ExecutionStatus;
  created_at: number;
  updated_at: number;
  summary?: string | null;
  results?: Record<string, any> | null;
  error?: string | null;
  tags: string[];
  links?: ExecutionLinks;
  steps: ExecutionStep[];
  artifacts: ExecutionArtifact[];
}

export interface CronStatus {
  scheduler_running: boolean;
  total_jobs: number;
  failing_jobs: number;
  retrying_jobs: number;
}

export interface CronJob {
  id: string;
  schedule: string;
  execution_type: AutomationExecutionType;
  payload: Record<string, any>;
  enabled: boolean;
  failure_count: number;
  last_failure_at?: number | null;
  next_retry_at?: number | null;
  last_run_at?: number | null;
  retry_policy?: RetryPolicy | null;
}

export interface TriggerDefinition {
  id: string;
  event_type: string;
  condition?: TriggerCondition | null;
  action: TriggerAction;
}

export interface RecentAutomationEvent {
  id: string;
  event_type: string;
  payload: Record<string, any>;
  timestamp: string;
  source_node?: string | null;
  related_execution_id?: string | null;
  related_goal_run_id?: string | null;
  related_response_id?: string | null;
  related_cron_job_id?: string | null;
  related_trigger_id?: string | null;
}
