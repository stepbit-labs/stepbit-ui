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
