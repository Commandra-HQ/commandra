/**
 * Internal tool schema definitions for the orchestrator.
 * These tools are handled server-side (not routed through WebSocket).
 */

import { getToolDefinitions } from '../tools/registry.js';

export function buildToolList(
  agentConfig: { tools?: string[] },
  currentDepth: number,
) {
  const browserTools = getToolDefinitions(agentConfig.tools);

  const saveMemoryTool = {
    name: 'save_memory',
    description:
      'Save something to remember about this user for future sessions. Use when the user explicitly asks you to remember something, or when you notice a strong preference or correction worth preserving.',
    parameters: {
      type: 'object' as const,
      properties: {
        category: {
          type: 'string',
          enum: ['preference', 'correction', 'terminology', 'workflow'],
          description:
            'Category: preference (how they like things), correction (something they corrected you on), terminology (their shorthand/jargon), workflow (repeated patterns)',
        },
        content: {
          type: 'string',
          description: 'What to remember — be specific and concise',
        },
      },
      required: ['category', 'content'],
    },
  };

  const recallMemoryTool = {
    name: 'recall_memory',
    description:
      'Search your memories about this user and domain for specific information. Use when you need context not in the system prompt — e.g., past workflows, preferences, or domain knowledge.',
    parameters: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description:
            'What to search for — natural language description of the information you need',
        },
      },
      required: ['query'],
    },
  };

  const spawnAgentTool = {
    name: 'spawn_agent',
    description:
      'Spawn a sub-agent to perform a task in a separate browser context. Use for parallel operations like reading data from multiple pages simultaneously. You can target a specific agent by slug via `agentSlug`, or let the system use the default coordinator.',
    parameters: {
      type: 'object' as const,
      properties: {
        task: {
          type: 'string',
          description:
            'Natural language description of the task for the sub-agent',
        },
        targetUrl: {
          type: 'string',
          description: 'URL the sub-agent should navigate to first',
        },
        agentSlug: {
          type: 'string',
          description:
            'Optional slug of a specific agent to use for this task (e.g. "email-drafter")',
        },
        timeout: {
          type: 'number',
          description: 'Max execution time in milliseconds (default: 60000)',
        },
      },
      required: ['task', 'targetUrl'],
    },
  };

  const waitForAgentsTool = {
    name: 'wait_for_agents',
    description:
      'Wait for one or more spawned sub-agents to complete and get their results. Call this after spawning agents to collect their findings.',
    parameters: {
      type: 'object' as const,
      properties: {
        agentIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of agent IDs returned by spawn_agent',
        },
      },
      required: ['agentIds'],
    },
  };

  const saveToLocalTool = {
    name: 'save_to_local',
    description:
      "Save a file to persistent local storage on the user's computer (~/.commandra/). Use for exports, extracted data, or context files the user wants to keep.",
    parameters: {
      type: 'object' as const,
      properties: {
        filename: {
          type: 'string',
          description: 'Filename to save as (e.g. "report.json", "data.csv")',
        },
        content: {
          type: 'string',
          description: 'File content to save',
        },
        category: {
          type: 'string',
          enum: ['exports', 'context'],
          description:
            'Category: exports (user-requested data) or context (reference material)',
        },
      },
      required: ['filename', 'content', 'category'],
    },
  };

  const createAgentTool = {
    name: 'create_agent',
    description:
      'Create a new persistent agent that specializes in a task or domain. Use when the user describes a repeatable workflow, asks you to "remember how to do this", wants a scheduled task, or explicitly asks for an agent. The agent will retain its personality and skills across sessions.',
    parameters: {
      type: 'object' as const,
      properties: {
        slug: {
          type: 'string',
          description:
            'URL-safe identifier (lowercase, hyphens, underscores). e.g. "gmail-summarizer", "jira-triager"',
        },
        name: {
          type: 'string',
          description: 'Human-readable name. e.g. "Gmail Morning Summarizer"',
        },
        description: {
          type: 'string',
          description:
            'What this agent does — one sentence. e.g. "Summarizes unread emails from key contacts every morning"',
        },
        soul: {
          type: 'string',
          description:
            'The agent\'s personality and behavioral instructions (becomes SOUL.md). Write in second person: "You are a..."',
        },
        domains: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Domains this agent works on. e.g. ["mail.google.com", "*.github.com"]',
        },
        cron: {
          type: 'string',
          description:
            'Optional cron schedule (5-field). e.g. "0 9 * * 1-5" for weekdays at 9am. Only if the user wants it to run automatically.',
        },
      },
      required: ['slug', 'name', 'description', 'soul'],
    },
  };

  const updateAgentFilesTool = {
    name: 'update_agent_files',
    description:
      "Write or update a file for an existing agent (SOUL.md, SKILLS.md, LEARNINGS.md, ERRORS.md). Use after create_agent to add initial skills, or to update an agent's personality/capabilities.",
    parameters: {
      type: 'object' as const,
      properties: {
        agentSlug: {
          type: 'string',
          description: 'Slug of the agent to update',
        },
        filename: {
          type: 'string',
          enum: ['SOUL.md', 'SKILLS.md', 'LEARNINGS.md', 'ERRORS.md'],
          description: 'Which file to write',
        },
        content: {
          type: 'string',
          description: 'Full file content (replaces existing)',
        },
      },
      required: ['agentSlug', 'filename', 'content'],
    },
  };

  const submitPlanTool = {
    name: 'submit_plan',
    description:
      'Submit an execution plan for user approval BEFORE executing any multi-step task (3+ steps). This is MANDATORY — you must NOT execute a plan until the user approves it. The plan will be shown to the user and you must wait for their approval or rejection.',
    parameters: {
      type: 'object' as const,
      properties: {
        description: {
          type: 'string',
          description: 'Brief summary of what this plan accomplishes',
        },
        steps: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Ordered list of steps to execute. Each should be a clear, actionable description.',
        },
      },
      required: ['description', 'steps'],
    },
  };

  const updatePlanTool = {
    name: 'update_plan',
    description:
      'Update the status of a plan step after executing it. Call this after each step completes (success or failure) to keep the plan up to date.',
    parameters: {
      type: 'object' as const,
      properties: {
        stepIndex: {
          type: 'number',
          description: 'Zero-based index of the step to update',
        },
        status: {
          type: 'string',
          enum: ['in_progress', 'completed', 'failed'],
          description: 'New status for the step',
        },
        error: {
          type: 'string',
          description: 'Error message if step failed',
        },
      },
      required: ['stepIndex', 'status'],
    },
  };

  const saveKnowledgeTool = {
    name: 'save_knowledge',
    description:
      'Write a knowledge file to persistent storage. Use this to save domain knowledge (how an app works, page structure, useful selectors), workflows (proven multi-step procedures), or any other knowledge worth preserving for future sessions. Files are markdown. You can create or overwrite files.',
    parameters: {
      type: 'object' as const,
      properties: {
        category: {
          type: 'string',
          enum: ['domain', 'agent', 'run'],
          description:
            'Where to save: domain (per-website knowledge), agent (per-agent files), run (run logs/summaries)',
        },
        key: {
          type: 'string',
          description:
            'The domain name (e.g. "mail.google.com") for domain category, agent slug for agent category, or date (YYYY-MM-DD) for run category',
        },
        filename: {
          type: 'string',
          description:
            'Filename to write (e.g. "KNOWLEDGE.md", "WORKFLOWS.md", "MEMORY.md", "SKILLS.md"). Use .md extension.',
        },
        content: {
          type: 'string',
          description:
            'Full markdown content to write. Include headers and structure.',
        },
      },
      required: ['category', 'key', 'filename', 'content'],
    },
  };

  const readKnowledgeTool = {
    name: 'read_knowledge',
    description:
      'Read a knowledge file from persistent storage. Use this to check what you already know about a domain, read your own agent files, or review past run summaries.',
    parameters: {
      type: 'object' as const,
      properties: {
        category: {
          type: 'string',
          enum: ['domain', 'agent', 'run'],
          description: 'Where to read from: domain, agent, or run',
        },
        key: {
          type: 'string',
          description: 'Domain name, agent slug, or date (YYYY-MM-DD)',
        },
        filename: {
          type: 'string',
          description: 'Filename to read (e.g. "KNOWLEDGE.md", "WORKFLOWS.md")',
        },
      },
      required: ['category', 'key', 'filename'],
    },
  };

  const listKnowledgeTool = {
    name: 'list_knowledge',
    description:
      'List knowledge files stored for a domain or agent. Use to discover what knowledge exists before reading or updating.',
    parameters: {
      type: 'object' as const,
      properties: {
        category: {
          type: 'string',
          enum: ['domain', 'agent', 'run'],
          description: 'Where to list: domain, agent, or run',
        },
        key: {
          type: 'string',
          description: 'Domain name, agent slug, or date (YYYY-MM-DD)',
        },
      },
      required: ['category', 'key'],
    },
  };

  return [
    ...browserTools,
    saveMemoryTool,
    recallMemoryTool,
    saveKnowledgeTool,
    readKnowledgeTool,
    listKnowledgeTool,
    // Exclude spawn/wait tools at depth >= 2 to prevent deep nesting
    ...(currentDepth >= 2 ? [] : [spawnAgentTool, waitForAgentsTool]),
    saveToLocalTool,
    createAgentTool,
    updateAgentFilesTool,
    submitPlanTool,
    updatePlanTool,
  ];
}
