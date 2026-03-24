/**
 * Token budget management — estimation and trimming for context windows.
 *
 * Trimming pipeline (runs every iteration):
 *   Phase 0: Expire "seen" screenshots (assistant already responded to them)
 *   Phase 1: Strip old screenshots — keep only the most recent image
 *   Phase 1.5: Trim thinking blocks in older messages
 *   Phase 2: Truncate long tool results (aggressive for older messages)
 *   Phase 2.5: Collapse old page-state results to summaries
 *   Phase 3: Drop oldest message pairs as a last resort
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
 * Check if a message contains an image block (top-level or inside tool_result).
 */
function messageHasImage(m: Message): boolean {
  if (!Array.isArray(m.content)) return false;
  for (const block of m.content as ContentBlock[]) {
    if (block.type === 'image') return true;
    if (block.type === 'tool_result') {
      const tr = block as ToolResultBlock;
      if (Array.isArray(tr.content)) {
        if (tr.content.some((sub) => sub.type === 'image')) return true;
      }
    }
  }
  return false;
}

/**
 * Replace image blocks in a message with a text placeholder.
 */
function replaceImagesWithPlaceholder(m: Message, placeholder: string): Message {
  if (!Array.isArray(m.content)) return m;
  const cleaned = (m.content as ContentBlock[]).map((block) => {
    if (block.type === 'image') {
      return { type: 'text' as const, text: placeholder };
    }
    if (block.type === 'tool_result') {
      const tr = block as ToolResultBlock;
      if (Array.isArray(tr.content) && tr.content.some((sub) => sub.type === 'image')) {
        return {
          ...tr,
          content: tr.content.map((sub) =>
            sub.type === 'image' ? { type: 'text' as const, text: placeholder } : sub,
          ),
        } as ToolResultBlock;
      }
    }
    return block;
  });
  return { ...m, content: cleaned };
}

/**
 * Phase 0: Expire screenshots the agent has already "seen" and responded to.
 * If an assistant message with text follows a message containing an image,
 * that image has been consumed and can be replaced with a placeholder.
 */
function expireSeenScreenshots(messages: Message[]): Message[] {
  const result = [...messages];
  let lastImageMsgIdx = -1;

  for (let i = 0; i < result.length; i++) {
    if (messageHasImage(result[i])) {
      // If there was a PREVIOUS image that was followed by an assistant response,
      // expire it now — the agent already saw it
      if (lastImageMsgIdx >= 0 && lastImageMsgIdx < i) {
        result[lastImageMsgIdx] = replaceImagesWithPlaceholder(
          result[lastImageMsgIdx],
          '[screenshot: already processed]',
        );
      }
      lastImageMsgIdx = i;
    } else if (result[i].role === 'assistant' && lastImageMsgIdx >= 0) {
      // Assistant responded after seeing the image — but don't expire yet,
      // wait until the NEXT image or end of messages
      const hasText = typeof result[i].content === 'string'
        ? result[i].content.length > 0
        : Array.isArray(result[i].content) &&
          (result[i].content as ContentBlock[]).some(
            (b) => b.type === 'text' && (b as TextBlock).text.length > 10,
          );
      if (hasText && lastImageMsgIdx >= 0 && i < result.length - 1) {
        // Mark for expiry — will be expired when we find the next image or at the end
      }
    }
  }

  // Expire the last tracked image ONLY if it's not in the last 2 messages
  // (the agent may still need it for the current turn)
  if (lastImageMsgIdx >= 0 && lastImageMsgIdx < result.length - 2) {
    // Check if an assistant message followed it
    const hasAssistantAfter = result
      .slice(lastImageMsgIdx + 1)
      .some((m) => m.role === 'assistant');
    if (hasAssistantAfter) {
      result[lastImageMsgIdx] = replaceImagesWithPlaceholder(
        result[lastImageMsgIdx],
        '[screenshot: already processed]',
      );
    }
  }

  return result;
}

/**
 * Phase 1.5: Trim thinking blocks in older messages.
 * Extended thinking tokens accumulate fast and have diminishing value
 * for past iterations. Keep only a summary for older messages.
 */
function trimThinkingBlocks(messages: Message[]): Message[] {
  const KEEP_RECENT = 2; // Keep full thinking for last N messages
  return messages.map((m, idx) => {
    if (idx >= messages.length - KEEP_RECENT) return m;
    if (!Array.isArray(m.content)) return m;

    const cleaned = (m.content as ContentBlock[]).map((block) => {
      if (block.type === 'thinking') {
        const tb = block as ThinkingContentBlock;
        if (tb.thinking && tb.thinking.length > 500) {
          return {
            ...tb,
            thinking: '...' + tb.thinking.slice(-500),
          };
        }
      }
      return block;
    });
    return { ...m, content: cleaned };
  });
}

/**
 * Phase 2.5: Collapse old page-state tool results to compact summaries.
 * get_page_state / refresh_page_state results include full element lists
 * that are only useful for the most recent occurrence.
 */
function collapseOldPageState(messages: Message[]): Message[] {
  // Find the index of the last page-state result
  let lastPageStateIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (!Array.isArray(messages[i].content)) continue;
    for (const block of messages[i].content as ContentBlock[]) {
      if (block.type === 'tool_result') {
        const tr = block as ToolResultBlock;
        if (typeof tr.content === 'string' && tr.content.includes('"elements"')) {
          lastPageStateIdx = i;
          break;
        }
      }
    }
    if (lastPageStateIdx >= 0) break;
  }

  return messages.map((m, idx) => {
    if (idx >= lastPageStateIdx || !Array.isArray(m.content)) return m;
    const cleaned = (m.content as ContentBlock[]).map((block) => {
      if (block.type === 'tool_result') {
        const tr = block as ToolResultBlock;
        if (typeof tr.content === 'string' && tr.content.includes('"elements"') && tr.content.length > 500) {
          // Collapse to a compact summary
          try {
            const parsed = JSON.parse(tr.content);
            const elementCount = parsed.data?.elements?.length ?? parsed.elements?.length ?? '?';
            const url = parsed.data?.url ?? parsed.url ?? '';
            return {
              ...tr,
              content: JSON.stringify({
                success: true,
                summary: `Page state: ${elementCount} elements`,
                url,
                note: 'Full element list trimmed — use refresh_page_state to get current elements',
              }),
            };
          } catch {
            return { ...tr, content: tr.content.slice(0, 300) + '...[page state trimmed]' };
          }
        }
      }
      return block;
    });
    return { ...m, content: cleaned };
  });
}

/**
 * Trim messages to stay within token budget.
 *
 * Pipeline:
 *   Phase 0: Expire screenshots the agent already responded to
 *   Phase 1: Keep only the most recent screenshot, replace older ones
 *   Phase 1.5: Trim thinking blocks in older messages
 *   Phase 2: Truncate long tool results
 *   Phase 2.5: Collapse old page-state results
 *   Phase 3: Drop oldest message pairs as last resort
 */
export function trimMessagesForTokenBudget(messages: Message[]): Message[] {
  const maxChars = MAX_INPUT_TOKENS * CHARS_PER_TOKEN;
  let result = [...messages];

  // Phase 0: Expire screenshots the agent has already seen and responded to
  result = expireSeenScreenshots(result);

  // Phase 1: Strip old screenshots — keep only the last image block
  let lastImageIdx = -1;
  for (let i = result.length - 1; i >= 0; i--) {
    if (messageHasImage(result[i])) {
      lastImageIdx = i;
      break;
    }
  }

  if (lastImageIdx >= 0) {
    result = result.map((m, idx) => {
      if (idx >= lastImageIdx) return m;
      return replaceImagesWithPlaceholder(m, '[screenshot removed to save context]');
    });
  }

  // Phase 1.5: Trim thinking blocks in older messages
  result = trimThinkingBlocks(result);

  // Phase 2: Truncate long tool result strings
  if (estimateMessageChars(result) > maxChars) {
    const RECENT_THRESHOLD = 4;
    result = result.map((m, idx) => {
      if (!Array.isArray(m.content)) return m;
      // More aggressive truncation for older messages
      const maxLen = idx >= result.length - RECENT_THRESHOLD ? 2000 : 1000;
      const cleaned = (m.content as ContentBlock[]).map((block) => {
        if (block.type === 'tool_result') {
          const tr = block as ToolResultBlock;
          if (typeof tr.content === 'string' && tr.content.length > maxLen) {
            return {
              ...tr,
              content: tr.content.slice(0, maxLen) + '...[truncated]',
            };
          }
        }
        return block;
      });
      return { ...m, content: cleaned };
    });
  }

  // Phase 2.5: Collapse old page-state results to compact summaries
  if (estimateMessageChars(result) > maxChars * 0.8) {
    result = collapseOldPageState(result);
  }

  // Phase 3: If still over budget, drop oldest assistant+user pairs (keep first + last 4)
  if (estimateMessageChars(result) > maxChars && result.length > 6) {
    const keep = 4;
    const trimmed = [result[0], ...result.slice(-keep)];
    console.log(
      `[Orchestrator] Token budget exceeded, dropped ${result.length - trimmed.length} messages`,
    );
    result = trimmed;
  }

  return result;
}
