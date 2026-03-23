/**
 * OpenAI provider adapter — uses the Responses API.
 * Translates our generic types ↔ OpenAI Responses API types.
 * Supports reasoning summaries (streamed as thinking_delta events).
 */

import OpenAI from 'openai';
import type { Responses } from 'openai/resources/responses/responses';
import type {
  ChatParams,
  ContentBlock,
  LLMProvider,
  Message,
  StreamEvent,
  Tool,
} from '../types.js';

// Model aliases → actual OpenAI model IDs
// Any model string not in this map passes through as-is to the OpenAI API
const MODEL_MAP: Record<string, string> = {
  'gpt-4o': 'gpt-4o',
  'gpt-4o-mini': 'gpt-4o-mini',
  'gpt-4.1': 'gpt-4.1',
  'gpt-4.1-mini': 'gpt-4.1-mini',
  'gpt-4.1-nano': 'gpt-4.1-nano',
  'gpt-5': 'gpt-5',
  'gpt-5-mini': 'gpt-5-mini',
  'gpt-5-nano': 'gpt-5-nano',
  'gpt-5.2': 'gpt-5.2',
  'o3-mini': 'o3-mini',
  o3: 'o3',
  'o4-mini': 'o4-mini',
};

function resolveModel(model: string): string {
  return MODEL_MAP[model] || model;
}

export class OpenAIProvider implements LLMProvider {
  id = 'openai';
  supportsVision = true;
  supportsToolUse = true;

  private client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  async *chat(params: ChatParams): AsyncIterable<StreamEvent> {
    const input = toResponsesInput(params.system, params.messages);
    const tools = params.tools ? toResponsesTools(params.tools) : undefined;

    const createParams: Record<string, unknown> = {
      model: resolveModel(params.model),
      input,
      instructions: params.system,
      max_output_tokens: params.maxTokens ?? 4096,
      tools,
      stream: true,
      store: false,
    };

    // Enable reasoning with summaries for models that support it (gpt-5+, o-series)
    const resolved = resolveModel(params.model);
    const supportsReasoning = /^(gpt-5|o[34])/.test(resolved);
    if (params.thinking && supportsReasoning) {
      createParams.reasoning = {
        effort: 'medium',
        summary: 'auto',
      };
    }

    const response = await this.client.responses.create(
      createParams as unknown as Responses.ResponseCreateParamsStreaming,
      params.signal ? { signal: params.signal } : undefined,
    );

    // Track function calls by item_id (the item's `id` field, used in delta events)
    // Maps item_id → { callId (for our tool result matching), name, json }
    const functionCalls = new Map<
      string,
      { callId: string; name: string; json: string }
    >();

    for await (const event of response as AsyncIterable<Responses.ResponseStreamEvent>) {
      switch (event.type) {
        // Text content deltas
        case 'response.output_text.delta':
          yield { type: 'text', text: event.delta };
          break;

        // Reasoning summary deltas → map to thinking_delta
        case 'response.reasoning_summary_text.delta':
          yield { type: 'thinking_delta', text: event.delta };
          break;

        // Function call: item added with name + empty args
        case 'response.output_item.added': {
          const item = event.item;
          if (item.type === 'function_call') {
            const fc = item as Responses.ResponseFunctionToolCall & {
              id?: string;
            };
            // item_id in delta events = the item's `id`, NOT `call_id`
            const itemId = fc.id || fc.call_id;
            console.log(
              `[OpenAI] function_call added: itemId=${itemId} callId=${fc.call_id} name=${fc.name}`,
            );
            functionCalls.set(itemId, {
              callId: fc.call_id,
              name: fc.name,
              json: '',
            });
            yield { type: 'tool_use_start', id: fc.call_id, name: fc.name };
          }
          break;
        }

        // Function call arguments streaming
        case 'response.function_call_arguments.delta': {
          const existing = functionCalls.get(event.item_id);
          if (existing) {
            existing.json += event.delta;
            yield {
              type: 'tool_use_delta',
              id: existing.callId,
              partialJson: event.delta,
            };
          }
          break;
        }

        // Function call arguments done
        case 'response.function_call_arguments.done': {
          const fc = functionCalls.get(event.item_id);
          if (fc) {
            let input: Record<string, unknown> = {};
            try {
              input = JSON.parse(event.arguments || '{}');
            } catch {
              /* empty */
            }
            yield { type: 'tool_use_end', id: fc.callId, name: fc.name, input };
            functionCalls.delete(event.item_id);
          }
          break;
        }

        // Response completed — determine stop reason
        case 'response.completed': {
          const resp = event.response;
          const hasToolCalls = resp.output.some(
            (o: Responses.ResponseOutputItem) => o.type === 'function_call',
          );
          const isIncomplete = resp.status === 'incomplete';
          yield {
            type: 'message_end',
            stopReason: hasToolCalls
              ? 'tool_use'
              : isIncomplete
                ? 'max_tokens'
                : 'end_turn',
          };
          break;
        }

        // Response failed or incomplete
        case 'response.failed':
        case 'response.incomplete':
          yield { type: 'message_end', stopReason: 'end_turn' };
          break;
      }
    }
  }
}

// --- Translators ---

/**
 * Convert our generic Message[] to Responses API input items.
 * The system message goes into the `instructions` param, not the input array.
 */
function toResponsesInput(
  _system: string,
  messages: Message[],
): Responses.ResponseInput {
  const result: Responses.ResponseInputItem[] = [];

  for (const m of messages) {
    if (typeof m.content === 'string') {
      result.push({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content,
        type: 'message',
      });
    } else {
      const blocks = m.content as ContentBlock[];

      if (m.role === 'assistant') {
        // Text parts → assistant message
        const textParts = blocks.filter(b => b.type === 'text');
        if (textParts.length > 0) {
          result.push({
            role: 'assistant',
            content: textParts.map(b => (b as { text: string }).text).join(''),
            type: 'message',
          });
        }

        // Tool use blocks → function_call items
        const toolParts = blocks.filter(b => b.type === 'tool_use');
        for (const b of toolParts) {
          const tu = b as {
            id: string;
            name: string;
            input: Record<string, unknown>;
          };
          result.push({
            type: 'function_call',
            call_id: tu.id,
            name: tu.name,
            arguments: JSON.stringify(tu.input),
          } as Responses.ResponseFunctionToolCall);
        }
      } else {
        // User message — could contain tool results, text, images
        const toolResults = blocks.filter(b => b.type === 'tool_result');
        const otherBlocks = blocks.filter(
          b => b.type !== 'tool_result' && b.type !== 'thinking',
        );

        // Tool results → function_call_output items
        // For array content (e.g. screenshot results with [TextBlock, ImageBlock]),
        // extract text for the output string and images for a follow-up user message.
        const toolResultImages: Array<{ type: 'input_image'; image_url: string; detail: 'auto' }> = [];
        for (const tr of toolResults) {
          const toolResult = tr as {
            toolUseId: string;
            content: string | unknown[];
          };
          let output: string;
          if (typeof toolResult.content === 'string') {
            output = toolResult.content;
          } else if (Array.isArray(toolResult.content)) {
            // Extract text parts for function output, images separately
            const textParts: string[] = [];
            for (const sub of toolResult.content) {
              const subBlock = sub as { type: string; text?: string; data?: string; mediaType?: string; url?: string };
              if (subBlock.type === 'text' && subBlock.text) {
                textParts.push(subBlock.text);
              } else if (subBlock.type === 'image' && (subBlock.url || subBlock.data)) {
                const imgUrl = subBlock.url || `data:${subBlock.mediaType || 'image/jpeg'};base64,${subBlock.data}`;
                toolResultImages.push({
                  type: 'input_image',
                  image_url: imgUrl,
                  detail: 'auto',
                });
              }
            }
            output = textParts.join('\n') || JSON.stringify(toolResult.content);
          } else {
            output = JSON.stringify(toolResult.content);
          }
          result.push({
            type: 'function_call_output',
            call_id: toolResult.toolUseId,
            output,
          } as Responses.ResponseInputItem.FunctionCallOutput);
        }

        // Images extracted from tool results → user message so the model can see them
        if (toolResultImages.length > 0) {
          result.push({
            role: 'user',
            content: [
              { type: 'input_text', text: 'Screenshot from the tool result above:' },
              ...toolResultImages,
            ] as Responses.ResponseInputMessageContentList,
            type: 'message',
          });
        }

        // Text + image blocks → user message
        const contentParts: Array<
          | { type: 'input_text'; text: string }
          | { type: 'input_image'; image_url: string; detail: 'auto' }
        > = [];
        for (const block of otherBlocks) {
          if (block.type === 'text') {
            contentParts.push({ type: 'input_text', text: block.text });
          } else if (block.type === 'image') {
            const imgUrl = (block as { url?: string }).url || `data:${block.mediaType};base64,${block.data}`;
            contentParts.push({
              type: 'input_image',
              image_url: imgUrl,
              detail: 'auto',
            });
          }
        }
        if (contentParts.length > 0) {
          result.push({
            role: 'user',
            content: contentParts as Responses.ResponseInputMessageContentList,
            type: 'message',
          });
        }
      }
    }
  }

  return result;
}

function toResponsesTools(tools: Tool[]): Responses.FunctionTool[] {
  return tools.map(t => ({
    type: 'function' as const,
    name: t.name,
    description: t.description,
    parameters: {
      type: 'object',
      properties: t.parameters.properties,
      required: t.parameters.required || [],
    },
    strict: false,
  }));
}
