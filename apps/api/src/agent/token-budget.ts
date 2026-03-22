/**
 * Token budget management — estimation and trimming for context windows.
 */

import type {
  ContentBlock,
  ImageBlock,
  Message,
  TextBlock,
  ThinkingContentBlock,
  ToolResultBlock,
  ToolUseBlock,
} from '../llm/types.js';

// Rough token estimate: ~4 chars per token for English text
// Images are counted by pixel dimensions, NOT by base64 string length
// Anthropic: ~1,600 tokens per 1280x720 image. OpenAI: ~1,100 tokens for high detail.
// We use a flat 2,000 tokens per image as a safe estimate.
export const IMAGE_TOKEN_ESTIMATE = 2_000;
export const CHARS_PER_TOKEN = 4;

// Default context limit — overridden per provider/model in the orchestrator
export let MAX_INPUT_TOKENS = 200_000;

export function setMaxInputTokens(tokens: number): void {
	MAX_INPUT_TOKENS = tokens;
}

/**
 * Estimate total character count across all messages (including content blocks).
 */
export function estimateMessageChars(messages: Message[]): number {
  let total = 0;
  for (const m of messages) {
    if (typeof m.content === 'string') {
      total += m.content.length;
    } else if (Array.isArray(m.content)) {
      for (const block of m.content) {
        if (block.type === 'text') total += (block as TextBlock).text.length;
        else if (block.type === 'image') {
          // Images are counted by pixel dimensions, not base64 length.
          // Use flat token estimate × CHARS_PER_TOKEN to stay in char units.
          total += IMAGE_TOKEN_ESTIMATE * CHARS_PER_TOKEN;
        } else if (block.type === 'tool_result') {
          const tr = block as ToolResultBlock;
          if (typeof tr.content === 'string') total += tr.content.length;
          else if (Array.isArray(tr.content)) {
            for (const sub of tr.content) {
              if (sub.type === 'text') total += sub.text.length;
              else if (sub.type === 'image') total += IMAGE_TOKEN_ESTIMATE * CHARS_PER_TOKEN;
            }
          }
        } else if (block.type === 'tool_use') {
          total += JSON.stringify((block as ToolUseBlock).input).length;
        } else if (block.type === 'thinking') {
          total += ((block as ThinkingContentBlock).thinking || '').length;
        }
      }
    }
  }
  return total;
}

/**
 * Trim messages to stay within token budget.
 * Strategy:
 * 1. Strip base64 image data from all but the most recent screenshot
 * 2. If still over budget, summarize old tool results to just success/error
 * 3. If still over budget, drop the oldest message pairs
 */
export function trimMessagesForTokenBudget(messages: Message[]): Message[] {
  const maxChars = MAX_INPUT_TOKENS * CHARS_PER_TOKEN;
  let result = [...messages];

  // Phase 1: Strip old screenshots — keep only the last image block
  let lastImageIdx = -1;
  for (let i = result.length - 1; i >= 0; i--) {
    const content = result[i].content;
    if (Array.isArray(content)) {
      for (const block of content) {
        if (block.type === 'image') {
          lastImageIdx = i;
          break;
        }
        if (block.type === 'tool_result') {
          const tr = block as ToolResultBlock;
          if (Array.isArray(tr.content)) {
            for (const sub of tr.content) {
              if (sub.type === 'image') {
                lastImageIdx = i;
                break;
              }
            }
          }
        }
      }
      if (lastImageIdx >= 0) break;
    }
  }

  // Replace older image blocks with a placeholder
  result = result.map((m, idx) => {
    if (idx >= lastImageIdx || !Array.isArray(m.content)) return m;
    const cleaned = (m.content as ContentBlock[]).map(block => {
      if (block.type === 'image') {
        return {
          type: 'text' as const,
          text: '[screenshot removed to save context]',
        };
      }
      if (block.type === 'tool_result') {
        const tr = block as ToolResultBlock;
        if (Array.isArray(tr.content)) {
          const hasImage = tr.content.some(sub => sub.type === 'image');
          if (hasImage) {
            return {
              ...tr,
              content: tr.content.map(sub =>
                sub.type === 'image'
                  ? { type: 'text' as const, text: '[screenshot removed]' }
                  : sub,
              ),
            } as ToolResultBlock;
          }
        }
      }
      return block;
    });
    return { ...m, content: cleaned };
  });

  // Phase 2: If still over budget, truncate long tool result strings
  if (estimateMessageChars(result) > maxChars) {
    result = result.map(m => {
      if (!Array.isArray(m.content)) return m;
      const cleaned = (m.content as ContentBlock[]).map(block => {
        if (block.type === 'tool_result') {
          const tr = block as ToolResultBlock;
          if (typeof tr.content === 'string' && tr.content.length > 2000) {
            return {
              ...tr,
              content: tr.content.slice(0, 2000) + '...[truncated]',
            };
          }
        }
        return block;
      });
      return { ...m, content: cleaned };
    });
  }

  // Phase 3: If still over budget, drop oldest assistant+user pairs (keep first + last 4)
  if (estimateMessageChars(result) > maxChars && result.length > 6) {
    const keep = 4; // Keep last N messages
    const trimmed = [result[0], ...result.slice(-keep)];
    console.log(
      `[Orchestrator] Token budget exceeded, dropped ${result.length - trimmed.length} messages`,
    );
    result = trimmed;
  }

  return result;
}
