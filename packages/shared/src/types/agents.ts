export type AgentAutonomy = 'supervised' | 'trusted' | 'autonomous';

export interface HookMatch {
  tools?: string[];
  labelPattern?: string;
  urlPattern?: string;
}

export type HookAction =
  | { type: 'block'; reason: string }
  | { type: 'log'; message: string }
  | { type: 'screenshot' }
  | { type: 'llm_check'; prompt: string }
  | { type: 'require_screenshot' };

export interface HookRule {
  match?: HookMatch;
  action: HookAction;
}

export interface AgentHooks {
  preToolUse?: HookRule[];
  postToolUse?: HookRule[];
  onComplete?: HookRule[];
}

export interface AgentLLMConfig {
  temperature?: number;
  topP?: number;
  maxOutputTokens?: number;
  thinkingBudget?: number;
  thinkingEnabled?: boolean;
}

export interface AgentLimits {
  maxConcurrentSubAgents?: number;
  maxDepth?: number;
  maxRetries?: number;
  retryDelays?: number[];
  selfImproveCap?: number;
}

export interface AgentConfig {
  id: string;
  slug: string;
  userId: string;
  name: string;
  description: string;
  model?: 'strong' | 'fast' | string;
  maxIterations?: number;
  tools?: string[];
  domains?: string[];
  soul?: string;
  skills?: string;
  learnings?: string;
  errors?: string;
  memory?: string;
  hooks?: AgentHooks;
  llm?: AgentLLMConfig;
  limits?: AgentLimits;
  domainAutonomy?: Record<string, AgentAutonomy>;
  trigger?: { cron?: string; enabled?: boolean };
  autonomy?: AgentAutonomy;
}
