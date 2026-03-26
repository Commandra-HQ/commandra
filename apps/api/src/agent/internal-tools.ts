/**
 * Internal tool execution handlers — tools that run server-side without WebSocket routing.
 * Handles: memory, knowledge, agents, plans, local storage.
 */

import type { AgentConfig, SSEEvent } from '@afe/shared';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { agents, conversations, scheduledTasks } from '../db/schema.js';
import { searchUserMemories } from '../db/vector-search.js';
import type { ToolResultBlock, ToolUseBlock } from '../llm/types.js';
import { appendDomainWorkflow } from '../memory/domain.js';
import { type MemoryCategory, saveUserMemory } from '../memory/user.js';
import {
  uploadAgentFile,
  downloadAgentFile,
  listAgentFiles,
} from '../storage/agent-files.js';
import {
  downloadDomainFile,
  listDomainFiles,
  uploadDomainFile,
} from '../storage/domain-files.js';
import { deduplicateLines } from '../utils/text-similarity.js';
import { sendActionRequest } from '../ws/handler.js';
import { getLocalFile, listLocalFiles, saveLocalFile } from '../storage/local.js';
import {
  type StoredPlan,
  loadPlan,
  savePlan,
  updatePlanStep,
} from '../storage/plan-files.js';
import { sendApprovalRequest } from '../ws/handler.js';
import { getFastModel, getProvider } from '../llm/index.js';
import { collectStream } from '../llm/types.js';
import { writeScratchpad, readScratchpad } from '../storage/scratchpad.js';
import { createAgent, loadAgentBySlug } from './agent-registry.js';
import { spawnSubAgent, waitForAgents } from './swarm.js';

/** Set of tool names that are handled internally (not via WS). */
export const INTERNAL_TOOL_NAMES = new Set([
  'save_memory',
  'recall_memory',
  'save_knowledge',
  'read_knowledge',
  'list_knowledge',
  'spawn_agent',
  'wait_for_agents',
  'save_to_local',
  'create_agent',
  'update_agent_files',
  'submit_plan',
  'update_plan',
  'write_scratchpad',
  'read_scratchpad',
  'read_local_file',
  'list_local_files',
  'browse_storage',
  'list_tabs',
  'switch_tab',
]);

export interface InternalToolContext {
  userId: string;
  connectionId: string;
  domain?: string;
  onEvent: (event: SSEEvent) => Promise<void>;
  domainMemory?: string;
  userMemory?: string;
  depth?: number;
  conversationId?: string;
  autonomy?: 'supervised' | 'trusted' | 'autonomous';
  /** Called when switch_tab changes the agent's target tab. Updates the orchestrator context. */
  onTabSwitch?: (newTabId: number) => void;
}

/**
 * Try to execute a tool as an internal tool. Returns null if not an internal tool.
 */
export async function executeInternalTool(
  block: ToolUseBlock,
  ctx: InternalToolContext,
): Promise<ToolResultBlock | null> {
  if (!INTERNAL_TOOL_NAMES.has(block.name)) return null;

  switch (block.name) {
    case 'recall_memory':
      return handleRecallMemory(block, ctx);
    case 'save_knowledge':
      return handleSaveKnowledge(block, ctx);
    case 'read_knowledge':
      return handleReadKnowledge(block, ctx);
    case 'list_knowledge':
      return handleListKnowledge(block, ctx);
    case 'spawn_agent':
      return handleSpawnAgent(block, ctx);
    case 'wait_for_agents':
      return handleWaitForAgents(block, ctx);
    case 'save_memory':
      return handleSaveMemory(block, ctx);
    case 'save_to_local':
      return handleSaveToLocal(block, ctx);
    case 'create_agent':
      return handleCreateAgent(block, ctx);
    case 'update_agent_files':
      return handleUpdateAgentFiles(block, ctx);
    case 'submit_plan':
      return handleSubmitPlan(block, ctx);
    case 'update_plan':
      return handleUpdatePlan(block, ctx);
    case 'write_scratchpad':
      return handleWriteScratchpad(block, ctx);
    case 'read_scratchpad':
      return handleReadScratchpad(block, ctx);
    case 'read_local_file':
      return handleReadLocalFile(block, ctx);
    case 'list_local_files':
      return handleListLocalFiles(block, ctx);
    case 'browse_storage':
      return handleBrowseStorage(block, ctx);
    case 'list_tabs':
      return handleListTabs(block, ctx);
    case 'switch_tab':
      return handleSwitchTab(block, ctx);
    case 'schedule_agent':
      return handleScheduleAgent(block, ctx);
    default:
      return null;
  }
}

// --- Helpers ---

function successResult(toolUseId: string, data: unknown): ToolResultBlock {
  return {
    type: 'tool_result',
    toolUseId,
    content: JSON.stringify(data),
    isError: false,
  };
}

function errorResult(toolUseId: string, error: unknown): ToolResultBlock {
  const errorMsg = error instanceof Error ? error.message : String(error);
  return {
    type: 'tool_result',
    toolUseId,
    content: JSON.stringify({ success: false, error: errorMsg }),
    isError: true,
  };
}

// --- Individual tool handlers ---

async function handleRecallMemory(
  block: ToolUseBlock,
  ctx: InternalToolContext,
): Promise<ToolResultBlock> {
  if (!ctx.domain) {
    return errorResult(block.id, 'No domain context for recall_memory');
  }
  const args = block.input as { query: string };
  try {
    const results = await searchUserMemories(
      args.query,
      ctx.userId,
      ctx.domain,
      5,
    );
    const formatted =
      results.length > 0
        ? results
            .map(
              r => `[${r.category}] ${r.content} (confidence: ${r.confidence})`,
            )
            .join('\n')
        : 'No matching memories found.';
    return successResult(block.id, {
      success: true,
      memories: formatted,
      count: results.length,
    });
  } catch (err) {
    return errorResult(block.id, err);
  }
}

async function handleSaveKnowledge(
  block: ToolUseBlock,
  ctx: InternalToolContext,
): Promise<ToolResultBlock> {
  const args = block.input as {
    category: string;
    key: string;
    filename: string;
    content: string;
    mode?: 'append' | 'rewrite' | 'merge';
  };
  const mode = args.mode || 'append';

  try {
    const download =
      args.category === 'domain'
        ? () => downloadDomainFile(ctx.userId, args.key, args.filename)
        : args.category === 'agent'
          ? () => downloadAgentFile(ctx.userId, args.key, args.filename)
          : null;

    const upload =
      args.category === 'domain'
        ? (content: string) => uploadDomainFile(ctx.userId, args.key, args.filename, content)
        : args.category === 'agent'
          ? (content: string) => uploadAgentFile(ctx.userId, args.key, args.filename, content)
          : null;

    if (args.category === 'run' || !upload) {
      // Run logs always overwrite (each run is unique)
      const { getSupabase } = await import('../storage/supabase.js');
      const supabase = getSupabase();
      const path = `runs/${ctx.userId}/${args.key}/${args.filename}`;
      await supabase.storage
        .from('agents')
        .upload(path, args.content, { upsert: true, contentType: 'text/plain' });
      return successResult(block.id, {
        success: true,
        mode: 'rewrite',
        saved: `${args.category}/${args.key}/${args.filename}`,
      });
    }

    const finalContent = await resolveWriteMode(mode, download!, args.content);
    await upload(finalContent);

    return successResult(block.id, {
      success: true,
      mode,
      linesWritten: finalContent.split('\n').filter((l) => l.trim().startsWith('- ')).length,
      saved: `${args.category}/${args.key}/${args.filename}`,
    });
  } catch (err) {
    return errorResult(block.id, err);
  }
}

const MAX_FILE_LINES = 500;

/**
 * Resolve content based on the agent's chosen write mode.
 * - append: add new content after existing content (safe default)
 * - rewrite: replace entirely (agent must read first)
 * - merge: deduplicate new entries against existing using similarity
 */
async function resolveWriteMode(
  mode: 'append' | 'rewrite' | 'merge',
  download: () => Promise<string | null>,
  newContent: string,
): Promise<string> {
  if (mode === 'rewrite') return newContent;

  let existing: string | null = null;
  try {
    existing = await download();
  } catch {
    // File doesn't exist — write as-is
  }
  if (!existing) return newContent;

  const existingLines = existing.split('\n');
  const newLines = newContent.split('\n');
  const existingEntries = existingLines.filter((l) => l.trim().startsWith('- '));
  const newEntries = newLines.filter((l) => l.trim().startsWith('- '));

  // Extract header (lines before first entry) from existing file
  const firstEntryIdx = existingLines.findIndex((l) => l.trim().startsWith('- '));
  const headerLines = firstEntryIdx >= 0 ? existingLines.slice(0, firstEntryIdx) : existingLines;

  if (mode === 'merge') {
    // Deduplicate: only add entries that are genuinely new
    if (existingEntries.length > 0 && newEntries.length > 0) {
      const genuinelyNew = deduplicateLines(existingEntries, newEntries);
      if (genuinelyNew.length === 0) return existing;
      const allEntries = [...existingEntries, ...genuinelyNew];
      const capped = allEntries.length > MAX_FILE_LINES
        ? allEntries.slice(allEntries.length - MAX_FILE_LINES)
        : allEntries;
      return [...headerLines, ...capped, ''].join('\n');
    }
    // Non-list content: append with separator if not already contained
    if (newContent.trim() && !existing.includes(newContent.trim())) {
      return capLines(`${existing.trimEnd()}\n\n---\n\n${newContent.trimStart()}`);
    }
    return existing;
  }

  // mode === 'append' (default)
  if (existingEntries.length > 0 && newEntries.length > 0) {
    // List-based: append new entries after existing ones
    const allEntries = [...existingEntries, ...newEntries];
    const capped = allEntries.length > MAX_FILE_LINES
      ? allEntries.slice(allEntries.length - MAX_FILE_LINES)
      : allEntries;
    return [...headerLines, ...capped, ''].join('\n');
  }
  // Freeform: append with separator
  return capLines(`${existing.trimEnd()}\n\n${newContent.trimStart()}`);
}

function capLines(content: string): string {
  const lines = content.split('\n');
  if (lines.length > MAX_FILE_LINES) {
    return lines.slice(lines.length - MAX_FILE_LINES).join('\n');
  }
  return content;
}

async function handleReadKnowledge(
  block: ToolUseBlock,
  ctx: InternalToolContext,
): Promise<ToolResultBlock> {
  const args = block.input as {
    category: string;
    key: string;
    filename: string;
  };
  try {
    let content: string | null = null;
    if (args.category === 'domain') {
      content = await downloadDomainFile(ctx.userId, args.key, args.filename);
    } else if (args.category === 'agent') {
      content = await downloadAgentFile(ctx.userId, args.key, args.filename);
    } else if (args.category === 'run') {
      const { getSupabase } = await import('../storage/supabase.js');
      const supabase = getSupabase();
      const path = `runs/${ctx.userId}/${args.key}/${args.filename}`;
      const { data, error } = await supabase.storage
        .from('agents')
        .download(path);
      if (error) {
        if (
          error.message?.includes('not found') ||
          error.message?.includes('Not Found')
        ) {
          content = null;
        } else {
          throw error;
        }
      } else {
        content = await data.text();
      }
    }
    return successResult(block.id, {
      success: true,
      content: content || '(file not found)',
      exists: content !== null,
    });
  } catch (err) {
    return errorResult(block.id, err);
  }
}

async function handleListKnowledge(
  block: ToolUseBlock,
  ctx: InternalToolContext,
): Promise<ToolResultBlock> {
  const args = block.input as { category: string; key: string };
  try {
    let files: { name: string; size: number }[] = [];
    if (args.category === 'domain') {
      files = (await listDomainFiles(ctx.userId, args.key)).map(f => ({
        name: f.name,
        size: f.size,
      }));
    } else if (args.category === 'agent') {
      files = (await listAgentFiles(ctx.userId, args.key)).map(f => ({
        name: f.name,
        size: f.size,
      }));
    } else if (args.category === 'run') {
      const { listRunLogs } = await import('../storage/run-files.js');
      files = await listRunLogs(ctx.userId, args.key);
    }
    return successResult(block.id, {
      success: true,
      files,
      count: files.length,
    });
  } catch (err) {
    return errorResult(block.id, err);
  }
}

async function handleSpawnAgent(
  block: ToolUseBlock,
  ctx: InternalToolContext,
): Promise<ToolResultBlock> {
  const args = block.input as {
    task: string;
    targetUrl: string;
    agentSlug?: string;
    timeout?: number;
    keepTab?: boolean;
  };
  try {
    let subAgentConfig: AgentConfig | undefined;
    if (args.agentSlug) {
      const loaded = await loadAgentBySlug(args.agentSlug, ctx.userId);
      if (loaded) subAgentConfig = loaded;
    }
    const result = await spawnSubAgent({
      userId: ctx.userId,
      connectionId: ctx.connectionId,
      task: args.task,
      targetUrl: args.targetUrl,
      domainMemory: ctx.domainMemory,
      userMemory: ctx.userMemory,
      domain: ctx.domain,
      timeout: args.timeout,
      onEvent: ctx.onEvent,
      signal: undefined,
      agentConfig: subAgentConfig,
      depth: (ctx.depth ?? 0) + 1,
      keepTab: args.keepTab,
      conversationId: ctx.conversationId,
    });
    return {
      type: 'tool_result',
      toolUseId: block.id,
      content: JSON.stringify(
        result.error
          ? { success: false, error: result.error }
          : {
              success: true,
              agentId: result.agentId,
              message: 'Sub-agent spawned. Use wait_for_agents to get results.',
            },
      ),
      isError: !!result.error,
    };
  } catch (err) {
    return errorResult(block.id, err);
  }
}

async function handleWaitForAgents(
  block: ToolUseBlock,
  ctx: InternalToolContext,
): Promise<ToolResultBlock> {
  const args = block.input as { agentIds: string[] };
  try {
    const results = await waitForAgents(ctx.userId, args.agentIds);
    return successResult(block.id, { success: true, results });
  } catch (err) {
    return errorResult(block.id, err);
  }
}

async function handleSaveMemory(
  block: ToolUseBlock,
  ctx: InternalToolContext,
): Promise<ToolResultBlock> {
  if (!ctx.domain) {
    return errorResult(block.id, 'No domain context for save_memory');
  }
  const args = block.input as { category: string; content: string };
  try {
    await saveUserMemory(
      ctx.userId,
      ctx.domain,
      args.category as MemoryCategory,
      args.content,
      'explicit',
    );
    await ctx.onEvent({
      type: 'tool_start',
      toolName: 'save_memory',
      label: args.content.slice(0, 60),
      args: block.input,
    });
    await ctx.onEvent({
      type: 'tool_end',
      toolName: 'save_memory',
      success: true,
      result: { success: true, saved: args.content },
    });
    return successResult(block.id, { success: true, message: 'Memory saved' });
  } catch (err) {
    return errorResult(block.id, err);
  }
}

async function handleSaveToLocal(
  block: ToolUseBlock,
  ctx: InternalToolContext,
): Promise<ToolResultBlock> {
  if (!ctx.domain) {
    return errorResult(block.id, 'No domain context for save_to_local');
  }
  const args = block.input as {
    filename: string;
    content: string;
    category: 'exports' | 'context';
  };
  try {
    const saved = saveLocalFile(
      args.category,
      ctx.domain,
      args.filename,
      args.content,
    );
    await ctx.onEvent({
      type: 'tool_start',
      toolName: 'save_to_local',
      label: args.filename,
      args: block.input,
    });
    await ctx.onEvent({
      type: 'tool_end',
      toolName: 'save_to_local',
      success: true,
      result: { success: true, path: saved.path, sizeBytes: saved.sizeBytes },
    });
    return successResult(block.id, {
      success: true,
      message: `File saved to ~/.commandra/${saved.path}`,
      sizeBytes: saved.sizeBytes,
    });
  } catch (err) {
    return errorResult(block.id, err);
  }
}

async function handleCreateAgent(
  block: ToolUseBlock,
  ctx: InternalToolContext,
): Promise<ToolResultBlock> {
  const args = block.input as {
    slug: string;
    name: string;
    description: string;
    soul: string;
    domains?: string[];
    cron?: string;
  };
  try {
    // Approval gate — ask user before creating an agent (skip for autonomous)
    const autoApprove = ctx.autonomy === 'autonomous';
    if (!autoApprove) {
      const agentApprovalId = `${block.id}-agent-approval`;
      await ctx.onEvent({
        type: 'approval_inline',
        requestId: agentApprovalId,
        action: 'create_agent',
        label: `Create agent "${args.name}" (${args.slug})`,
        reason: args.description,
        approvalType: 'agent',
        agentPreview: {
          slug: args.slug,
          name: args.name,
          description: args.description,
          soul: args.soul.slice(0, 300),
          domains: args.domains,
          cron: args.cron,
        },
      });

      const approval = await sendApprovalRequest(ctx.connectionId, {
        type: 'agent_approval',
        agentName: args.name,
        agentSlug: args.slug,
        description: args.description,
        soul: args.soul.slice(0, 500),
        domains: args.domains,
        cron: args.cron,
      }, 60000, agentApprovalId);

      if (!approval.approved) {
        return successResult(block.id, {
          success: false,
          approved: false,
          reason: approval.reason || 'User declined agent creation',
          message: 'Agent creation was rejected by the user. Ask what they would like to change.',
        });
      }
    }

    const agent = await createAgent(ctx.userId, {
      slug: args.slug,
      name: args.name,
      description: args.description,
      domains: args.domains,
      trigger: args.cron ? { cron: args.cron, enabled: true } : undefined,
    });
    await uploadAgentFile(ctx.userId, args.slug, 'SOUL.md', args.soul);

    // Auto-extract initial SKILLS.md from the agent's purpose (fire-and-forget)
    extractInitialSkills(ctx.userId, args.slug, args.name, args.description, args.soul).catch(
      (err) => console.warn(`[Agent] Failed to extract initial skills for "${args.slug}":`, err),
    );

    await ctx.onEvent({
      type: 'tool_start',
      toolName: 'create_agent',
      label: `Created agent: ${args.name}`,
      args: block.input,
    });
    await ctx.onEvent({
      type: 'tool_end',
      toolName: 'create_agent',
      success: true,
      result: { success: true, agentId: agent.id, slug: agent.slug },
    });
    return successResult(block.id, {
      success: true,
      agentId: agent.id,
      slug: agent.slug,
      message: `Agent "${args.name}" created with slug "${args.slug}". SOUL.md saved. Initial SKILLS.md is being generated.${args.cron ? ` Scheduled: ${args.cron}` : ''}${args.domains?.length ? ` Domains: ${args.domains.join(', ')}` : ''}`,
    });
  } catch (err) {
    return errorResult(block.id, err);
  }
}

async function handleUpdateAgentFiles(
  block: ToolUseBlock,
  ctx: InternalToolContext,
): Promise<ToolResultBlock> {
  const args = block.input as {
    agentSlug: string;
    filename: string;
    content: string;
  };
  try {
    await uploadAgentFile(
      ctx.userId,
      args.agentSlug,
      args.filename,
      args.content,
    );
    await ctx.onEvent({
      type: 'tool_start',
      toolName: 'update_agent_files',
      label: `${args.agentSlug}/${args.filename}`,
      args: block.input,
    });
    await ctx.onEvent({
      type: 'tool_end',
      toolName: 'update_agent_files',
      success: true,
      result: { success: true, file: args.filename },
    });
    return successResult(block.id, {
      success: true,
      message: `Updated ${args.filename} for agent "${args.agentSlug}"`,
    });
  } catch (err) {
    return errorResult(block.id, err);
  }
}

async function handleSubmitPlan(
  block: ToolUseBlock,
  ctx: InternalToolContext,
): Promise<ToolResultBlock> {
  const args = block.input as {
    description: string;
    context?: string;
    references?: string[];
    steps: (string | { label: string; instructions?: string })[];
  };
  try {
    // Check for existing in-progress plan
    if (ctx.conversationId) {
      const existingPlan = await loadPlan(ctx.userId, ctx.conversationId);
      if (existingPlan) {
        const hasActiveSteps = existingPlan.steps.some(
          (s: { status: string }) => s.status === 'in_progress',
        );
        if (hasActiveSteps) {
          return errorResult(
            block.id,
            'A plan is already in progress. Use update_plan to track step completion instead of submitting a new plan.',
          );
        }
      }
    }

    const plan: StoredPlan = {
      description: args.description,
      context: args.context,
      references: args.references,
      steps: args.steps.map((s) => {
        if (typeof s === 'string') return { label: s, status: 'pending' as const };
        return { label: s.label, instructions: s.instructions, status: 'pending' as const };
      }),
    };

    if (ctx.conversationId) {
      await savePlan(ctx.userId, ctx.conversationId, plan);
      db.update(conversations)
        .set({
          planStatus: {
            totalSteps: plan.steps.length,
            completedSteps: 0,
            status: 'pending' as const,
          },
          updatedAt: new Date(),
        })
        .where(eq(conversations.id, ctx.conversationId))
        .catch(() => {});
    }

    const planId = ctx.conversationId || 'plan';
    const autoApprovePlan =
      ctx.autonomy === 'trusted' || ctx.autonomy === 'autonomous';

    const planApprovalId = `${block.id}-plan-approval`;
    if (!autoApprovePlan) {
      await ctx.onEvent({
        type: 'approval_inline',
        requestId: planApprovalId,
        action: 'submit_plan',
        label: args.description,
        reason: `Plan with ${args.steps.length} steps`,
        approvalType: 'plan',
        planSteps: plan.steps.map((s) => s.label),
      });
    }

    const approval = autoApprovePlan
      ? { approved: true }
      : await sendApprovalRequest(ctx.connectionId, {
          type: 'plan_approval',
          planId,
          description: args.description,
          steps: plan.steps.map((s) => s.label),
        }, 60000, planApprovalId);

    if (approval.approved) {
      if (ctx.conversationId) {
        const approvedPlan: StoredPlan = {
          ...plan,
          steps: plan.steps.map(s => ({ ...s })),
        };
        await savePlan(ctx.userId, ctx.conversationId, approvedPlan);
        db.update(conversations)
          .set({
            planStatus: {
              totalSteps: plan.steps.length,
              completedSteps: 0,
              status: 'approved' as const,
            },
            updatedAt: new Date(),
          })
          .where(eq(conversations.id, ctx.conversationId))
          .catch(() => {});
      }

      await ctx.onEvent({ type: 'plan_approved', planId });
      await ctx.onEvent({
        type: 'plan_state',
        plan: { description: plan.description, steps: plan.steps },
      });

      return successResult(block.id, {
        success: true,
        approved: true,
        message:
          'Plan approved by user. Proceed with execution. Call update_plan with stepIndex and status as you complete each step.',
      });
    }

    await ctx.onEvent({
      type: 'plan_rejected',
      planId,
      reason: approval.reason,
    });
    return successResult(block.id, {
      success: true,
      approved: false,
      reason: approval.reason || 'User rejected the plan',
      message: 'Plan rejected. Ask the user what they would like to change.',
    });
  } catch (err) {
    return errorResult(block.id, err);
  }
}

async function handleUpdatePlan(
  block: ToolUseBlock,
  ctx: InternalToolContext,
): Promise<ToolResultBlock> {
  const args = block.input as {
    stepIndex: number;
    status: 'in_progress' | 'completed' | 'failed';
    error?: string;
  };
  if (!ctx.conversationId) {
    return errorResult(block.id, 'No conversation context for plan updates');
  }
  try {
    const updated = await updatePlanStep(
      ctx.userId,
      ctx.conversationId,
      args.stepIndex,
      args.status,
      args.error,
    );

    if (!updated) {
      return errorResult(block.id, 'Plan not found or invalid step index');
    }

    const completedSteps = updated.steps.filter(
      s => s.status === 'completed',
    ).length;
    const failedSteps = updated.steps.filter(s => s.status === 'failed').length;
    const allDone = completedSteps + failedSteps === updated.steps.length;

    db.update(conversations)
      .set({
        planStatus: {
          totalSteps: updated.steps.length,
          completedSteps,
          status: allDone
            ? failedSteps > 0
              ? ('failed' as const)
              : ('completed' as const)
            : ('in_progress' as const),
        },
        updatedAt: new Date(),
      })
      .where(eq(conversations.id, ctx.conversationId))
      .catch(() => {});

    // Extract workflow when plan completes successfully
    if (allDone && failedSteps === 0 && ctx.domain) {
      appendDomainWorkflow(ctx.userId, ctx.domain, {
        name: updated.steps
          .map(s => s.label)
          .join(' → ')
          .slice(0, 80),
        steps: updated.steps.map(s => s.label),
        source: `conversation:${ctx.conversationId}`,
      }).catch(() => {});
    }

    await ctx.onEvent({
      type: 'plan_step_updated',
      planId: ctx.conversationId,
      stepIndex: args.stepIndex,
      status: args.status,
      error: args.error,
    });
    await ctx.onEvent({
      type: 'plan_state',
      plan: { description: updated.description, steps: updated.steps },
    });

    return successResult(block.id, {
      success: true,
      completedSteps,
      totalSteps: updated.steps.length,
      allDone,
    });
  } catch (err) {
    return errorResult(block.id, err);
  }
}

async function handleWriteScratchpad(
  block: ToolUseBlock,
  ctx: InternalToolContext,
): Promise<ToolResultBlock> {
  if (!ctx.conversationId) {
    return errorResult(block.id, 'No conversation context for scratchpad');
  }
  const args = block.input as { key: string; data: string };
  try {
    let parsed: unknown;
    try {
      parsed = JSON.parse(args.data);
    } catch {
      parsed = args.data;
    }
    await writeScratchpad(ctx.userId, ctx.conversationId, args.key, parsed);
    return successResult(block.id, {
      success: true,
      message: `Wrote "${args.key}" to scratchpad`,
    });
  } catch (err) {
    return errorResult(block.id, err);
  }
}

async function handleReadScratchpad(
  block: ToolUseBlock,
  ctx: InternalToolContext,
): Promise<ToolResultBlock> {
  if (!ctx.conversationId) {
    return errorResult(block.id, 'No conversation context for scratchpad');
  }
  const args = block.input as { key: string };
  try {
    const data = await readScratchpad(ctx.userId, ctx.conversationId, args.key);
    return successResult(block.id, {
      success: true,
      exists: data !== null,
      data: data ?? '(not found)',
    });
  } catch (err) {
    return errorResult(block.id, err);
  }
}

async function handleReadLocalFile(
  block: ToolUseBlock,
  _ctx: InternalToolContext,
): Promise<ToolResultBlock> {
  const args = block.input as { path: string; maxBytes?: number };
  try {
    const result = getLocalFile(args.path);
    if (!result) {
      return successResult(block.id, { success: false, error: 'File not found' });
    }
    const maxBytes = args.maxBytes || 100_000;
    const content = result.length > maxBytes ? result.slice(0, maxBytes) + '\n...[truncated]' : result;
    return successResult(block.id, { success: true, content, sizeBytes: result.length });
  } catch (err) {
    return errorResult(block.id, err);
  }
}

async function handleListLocalFiles(
  block: ToolUseBlock,
  _ctx: InternalToolContext,
): Promise<ToolResultBlock> {
  const args = block.input as { category?: string; domain?: string };
  try {
    const categories = args.category
      ? [args.category as 'exports' | 'context' | 'screenshots']
      : (['exports', 'context', 'screenshots'] as const);
    const allFiles = categories.flatMap((cat) => listLocalFiles(cat, args.domain));
    return successResult(block.id, { success: true, files: allFiles, count: allFiles.length });
  } catch (err) {
    return errorResult(block.id, err);
  }
}

/**
 * Auto-extract initial SKILLS.md for a newly created agent.
 * Uses the fast model to generate skills based on the agent's purpose.
 * Fire-and-forget — doesn't block agent creation.
 */
async function extractInitialSkills(
  userId: string,
  agentSlug: string,
  agentName: string,
  description: string,
  soul: string,
): Promise<void> {
  const provider = getProvider();
  const model = getFastModel();

  const stream = provider.chat({
    model,
    system: 'You are a concise agent skills writer. Output only markdown.',
    messages: [
      {
        role: 'user',
        content: `An agent called "${agentName}" was just created.

Description: ${description}
Identity (SOUL.md): ${soul}

Generate an initial SKILLS.md file for this agent. Include:
1. The key workflows this agent should be able to perform (based on its purpose)
2. Specific steps for each workflow (be concrete — include example selectors, URLs, navigation paths where applicable)
3. Common pitfalls or tips for the domains this agent works on

Format as markdown with ## headers for each skill. Keep it under 50 lines. Be specific and actionable, not generic.`,
      },
    ],
    maxTokens: 1000,
  });

  const response = await collectStream(stream);
  const skills = response.content
    .filter((b: { type: string }) => b.type === 'text')
    .map((b: { type: string; text?: string }) => (b as { text: string }).text)
    .join('');

  if (skills.trim()) {
    await uploadAgentFile(userId, agentSlug, 'SKILLS.md', `# Skills\n\n${skills}`);
    console.log(`[Agent] Auto-extracted SKILLS.md for "${agentSlug}" (${skills.length} chars)`);
  }
}

async function handleBrowseStorage(
  block: ToolUseBlock,
  ctx: InternalToolContext,
): Promise<ToolResultBlock> {
  const args = block.input as { path?: string };
  try {
    const { getSupabase } = await import('../storage/supabase.js');
    const supabase = getSupabase();
    const prefix = args.path || '';

    const { data, error } = await supabase.storage.from('agents').list(prefix, {
      limit: 100,
      sortBy: { column: 'updated_at', order: 'desc' },
    });

    if (error) throw error;

    const items = (data || []).map((f) => ({
      name: f.name,
      isFolder: !f.id, // Folders have null id
      size: f.metadata?.size,
      updatedAt: f.updated_at,
    }));

    return successResult(block.id, {
      success: true,
      path: prefix || '(root)',
      items,
      count: items.length,
    });
  } catch (err) {
    return errorResult(block.id, err);
  }
}

// --- Tab Management Tools ---

async function handleListTabs(
  block: ToolUseBlock,
  ctx: InternalToolContext,
): Promise<ToolResultBlock> {
  try {
    const result = await sendActionRequest(
      ctx.connectionId,
      'list_tabs',
      { action: 'list_tabs' },
      10000,
    );
    const data = result as { success?: boolean; data?: unknown; error?: string } | null;
    if (!data?.success) {
      return errorResult(block.id, new Error(data?.error || 'Failed to list tabs'));
    }
    return successResult(block.id, data.data);
  } catch (err) {
    return errorResult(block.id, err);
  }
}

async function handleSwitchTab(
  block: ToolUseBlock,
  ctx: InternalToolContext,
): Promise<ToolResultBlock> {
  const args = block.input as { tabId: number };
  if (!args.tabId) {
    return errorResult(block.id, new Error('tabId is required'));
  }
  try {
    const result = await sendActionRequest(
      ctx.connectionId,
      'switch_tab',
      { action: 'switch_tab', tabId: args.tabId },
      10000,
    );
    const data = result as { success?: boolean; data?: unknown; error?: string } | null;
    if (!data?.success) {
      return errorResult(block.id, new Error(data?.error || 'Failed to switch tab'));
    }
    // Update the orchestrator's tab context so subsequent actions target the new tab
    ctx.onTabSwitch?.(args.tabId);

    return successResult(block.id, {
      switched: true,
      tabId: args.tabId,
      ...(data.data as object),
      note: 'All subsequent actions will target this tab. Use get_page_state or refresh_page_state to see the page elements.',
    });
  } catch (err) {
    return errorResult(block.id, err);
  }
}

async function handleScheduleAgent(
  block: ToolUseBlock,
  ctx: InternalToolContext,
): Promise<ToolResultBlock> {
  const args = block.input as {
    agentSlug: string;
    task: string;
    runAt?: string;
    cron?: string;
  };

  if (!args.agentSlug || !args.task) {
    return errorResult(block.id, new Error('agentSlug and task are required'));
  }
  if (!args.runAt && !args.cron) {
    return errorResult(block.id, new Error('Either runAt (ISO datetime for one-time) or cron (expression for recurring) is required'));
  }

  try {
    // Find the agent by slug
    const [agent] = await db
      .select()
      .from(agents)
      .where(eq(agents.slug, args.agentSlug))
      .limit(1);

    if (!agent) {
      return errorResult(block.id, new Error(`Agent "${args.agentSlug}" not found. Check the slug.`));
    }
    if (agent.userId !== ctx.userId) {
      return errorResult(block.id, new Error(`Agent "${args.agentSlug}" does not belong to you.`));
    }

    // One-time task via runAt
    if (args.runAt) {
      const runAt = new Date(args.runAt);
      if (isNaN(runAt.getTime())) {
        return errorResult(block.id, new Error(`Invalid runAt datetime: "${args.runAt}". Use ISO 8601 format.`));
      }
      if (runAt.getTime() < Date.now()) {
        return errorResult(block.id, new Error('runAt must be in the future.'));
      }

      const [task] = await db.insert(scheduledTasks).values({
        userId: ctx.userId,
        agentId: agent.id,
        task: args.task,
        runAt,
        status: 'pending',
      }).returning();

      return successResult(block.id, {
        scheduled: true,
        type: 'one-time',
        taskId: task.id,
        agentSlug: args.agentSlug,
        agentName: agent.name,
        runAt: runAt.toISOString(),
        task: args.task,
        note: `Task scheduled. Agent "${agent.name}" will run at ${runAt.toLocaleString()}. The user's browser must be open with the extension running.`,
      });
    }

    // Recurring via cron
    if (args.cron) {
      await db.update(agents).set({
        trigger: { cron: args.cron, enabled: true },
      }).where(eq(agents.id, agent.id));

      return successResult(block.id, {
        scheduled: true,
        type: 'recurring',
        agentSlug: args.agentSlug,
        agentName: agent.name,
        cron: args.cron,
        task: args.task,
        note: `Recurring schedule set on agent "${agent.name}" with cron: ${args.cron}. The agent's description will be used as the task. The user's browser must be open with the extension running.`,
      });
    }

    return errorResult(block.id, new Error('Unreachable'));
  } catch (err) {
    return errorResult(block.id, err);
  }
}
