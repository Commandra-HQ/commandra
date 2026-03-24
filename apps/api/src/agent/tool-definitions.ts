/**
 * Internal tool schema definitions for the orchestrator.
 * These tools are handled server-side (not routed through WebSocket).
 */

import { getToolDefinitions } from '../tools/registry.js';

export function buildToolList(
  agentConfig: { tools?: string[]; limits?: { maxDepth?: number } },
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
        keepTab: {
          type: 'boolean',
          description:
            'Keep the tab open after completion for inspection (default: false — tabs close on success)',
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
      'Submit an execution plan for user approval BEFORE executing any multi-step task (3+ steps). Before creating a plan, ALWAYS gather context first: read domain knowledge, check your memory, and review past workflows. This is MANDATORY — you must NOT execute a plan until the user approves it.',
    parameters: {
      type: 'object' as const,
      properties: {
        description: {
          type: 'string',
          description: 'Brief summary of what this plan accomplishes',
        },
        context: {
          type: 'string',
          description:
            'Background context for this plan — what you know about the app, relevant domain knowledge, past workflows, user preferences. This helps you and the user understand WHY each step is chosen.',
        },
        references: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Knowledge sources you consulted: domain files, workflows, past runs, user memories. E.g. ["domain/mail.google.com/WORKFLOWS.md", "agent/gmail-helper/SKILLS.md"]',
        },
        steps: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              label: {
                type: 'string',
                description: 'What this step does (shown in the plan UI)',
              },
              instructions: {
                type: 'string',
                description:
                  'Detailed instructions for this step — specific selectors to use, values to type, what to verify. Include any relevant knowledge from domain files.',
              },
            },
            required: ['label'],
          },
          description: 'Ordered list of steps to execute.',
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
      'Write a knowledge file to persistent storage. Supports three modes: "append" (default) adds new entries without losing existing content — best for adding learnings incrementally. "rewrite" replaces the entire file — use when you want to reorganize or clean up (read_knowledge first!). "merge" intelligently deduplicates your content against existing entries — best for bulk updates. Use for domain knowledge, workflows, agent files, or run summaries.',
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
            'Markdown content to write. For append mode: just the new entries. For rewrite mode: the complete file. For merge mode: all entries (duplicates will be auto-removed).',
        },
        mode: {
          type: 'string',
          enum: ['append', 'rewrite', 'merge'],
          description:
            'How to handle existing content. "append" (default): adds your content after existing content, preserving everything. "rewrite": replaces the entire file — only use after reading current content. "merge": deduplicates your entries against existing ones using similarity matching — best for bulk updates.',
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

  const readLocalFileTool = {
    name: 'read_local_file',
    description:
      'Read a file from local storage (~/.commandra/). Use to read previously saved exports, context files, or downloaded data.',
    parameters: {
      type: 'object' as const,
      properties: {
        path: {
          type: 'string',
          description:
            'Path relative to ~/.commandra/ (e.g. "exports/mail.google.com/report.csv")',
        },
        maxBytes: {
          type: 'number',
          description: 'Max bytes to read (default: 100000). Use smaller values for large files.',
        },
      },
      required: ['path'],
    },
  };

  const listLocalFilesTool = {
    name: 'list_local_files',
    description:
      'List files in local storage (~/.commandra/). Use to discover what exports, context files, or downloads are available.',
    parameters: {
      type: 'object' as const,
      properties: {
        category: {
          type: 'string',
          enum: ['exports', 'context', 'screenshots'],
          description: 'Category of files to list (optional — lists all if omitted)',
        },
        domain: {
          type: 'string',
          description: 'Filter by domain (optional)',
        },
      },
      required: [],
    },
  };

  const writeScratchpadTool = {
    name: 'write_scratchpad',
    description:
      'Write structured data to a shared scratchpad that other agents (coordinator or sub-agents) in this conversation can read. Use for passing extracted tables, parsed data, or intermediate results between agents.',
    parameters: {
      type: 'object' as const,
      properties: {
        key: {
          type: 'string',
          description: 'A short key name for this data (e.g. "instamart-sales", "parsed-report")',
        },
        data: {
          type: 'string',
          description: 'The data to store (JSON string, CSV text, or plain text)',
        },
      },
      required: ['key', 'data'],
    },
  };

  const readScratchpadTool = {
    name: 'read_scratchpad',
    description:
      'Read data from the shared scratchpad that was written by another agent in this conversation. Use to retrieve results from sub-agents or data left by the coordinator.',
    parameters: {
      type: 'object' as const,
      properties: {
        key: {
          type: 'string',
          description: 'The key name of the data to read',
        },
      },
      required: ['key'],
    },
  };

  return [
    ...browserTools,
    saveMemoryTool,
    recallMemoryTool,
    saveKnowledgeTool,
    readKnowledgeTool,
    listKnowledgeTool,
    // Exclude spawn/wait tools at max depth to prevent deep nesting
    ...(currentDepth >= (agentConfig.limits?.maxDepth ?? 2) ? [] : [spawnAgentTool, waitForAgentsTool]),
    saveToLocalTool,
    createAgentTool,
    updateAgentFilesTool,
    submitPlanTool,
    updatePlanTool,
    writeScratchpadTool,
    readScratchpadTool,
    readLocalFileTool,
    listLocalFilesTool,
    {
      name: 'browse_storage',
      description:
        'Browse your persistent S3 storage to discover what files and knowledge exist. Lists files and folders at any path. Use to discover domain knowledge, agent files, run logs, screenshots, and scratchpad data.',
      parameters: {
        type: 'object' as const,
        properties: {
          path: {
            type: 'string',
            description:
              'Path prefix to browse. Examples: "domains/{userId}" (all domains), "{userId}/screenshots" (screenshots), "{userId}/_coordinator" (coordinator files). Leave empty to see top-level.',
          },
        },
        required: [],
      },
    },
  ];
}
