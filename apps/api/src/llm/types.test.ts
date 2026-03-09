import { describe, expect, it } from 'vitest';
import { collectStream } from './types.js';
import type { StreamEvent } from './types.js';

describe('collectStream', () => {
	async function* makeStream(events: StreamEvent[]): AsyncIterable<StreamEvent> {
		for (const event of events) {
			yield event;
		}
	}

	it('collects text events into a single text block', async () => {
		const events: StreamEvent[] = [
			{ type: 'text', text: 'Hello ' },
			{ type: 'text', text: 'world' },
			{ type: 'message_end', stopReason: 'end_turn' },
		];

		const result = await collectStream(makeStream(events));
		expect(result.content).toHaveLength(1);
		expect(result.content[0]).toEqual({ type: 'text', text: 'Hello world' });
		expect(result.stopReason).toBe('end_turn');
	});

	it('collects tool use events', async () => {
		const events: StreamEvent[] = [
			{ type: 'text', text: 'Let me click that.' },
			{ type: 'tool_use_start', id: 'tool-1', name: 'click_element' },
			{ type: 'tool_use_delta', id: 'tool-1', partialJson: '{"selector":' },
			{ type: 'tool_use_delta', id: 'tool-1', partialJson: '"#btn"}' },
			{
				type: 'tool_use_end',
				id: 'tool-1',
				name: 'click_element',
				input: { selector: '#btn' },
			},
			{ type: 'message_end', stopReason: 'tool_use' },
		];

		const result = await collectStream(makeStream(events));
		expect(result.content).toHaveLength(2);
		expect(result.content[0]).toEqual({ type: 'text', text: 'Let me click that.' });
		expect(result.content[1]).toEqual({
			type: 'tool_use',
			id: 'tool-1',
			name: 'click_element',
			input: { selector: '#btn' },
		});
		expect(result.stopReason).toBe('tool_use');
	});

	it('handles empty stream', async () => {
		const events: StreamEvent[] = [{ type: 'message_end', stopReason: 'end_turn' }];

		const result = await collectStream(makeStream(events));
		expect(result.content).toHaveLength(0);
		expect(result.stopReason).toBe('end_turn');
	});

	it('handles multiple tool uses', async () => {
		const events: StreamEvent[] = [
			{
				type: 'tool_use_start',
				id: 'tool-1',
				name: 'navigate',
			},
			{
				type: 'tool_use_end',
				id: 'tool-1',
				name: 'navigate',
				input: { url: 'https://x.com' },
			},
			{ type: 'text', text: 'Navigated. Now clicking.' },
			{
				type: 'tool_use_start',
				id: 'tool-2',
				name: 'click_element',
			},
			{
				type: 'tool_use_end',
				id: 'tool-2',
				name: 'click_element',
				input: { selector: '#btn' },
			},
			{ type: 'message_end', stopReason: 'tool_use' },
		];

		const result = await collectStream(makeStream(events));
		expect(result.content).toHaveLength(3);
		expect(result.content[0].type).toBe('tool_use');
		expect(result.content[1].type).toBe('text');
		expect(result.content[2].type).toBe('tool_use');
	});

	it('defaults stopReason to end_turn', async () => {
		const events: StreamEvent[] = [{ type: 'text', text: 'hello' }];

		const result = await collectStream(makeStream(events));
		expect(result.stopReason).toBe('end_turn');
	});

	it('handles max_tokens stop reason', async () => {
		const events: StreamEvent[] = [
			{ type: 'text', text: 'truncated...' },
			{ type: 'message_end', stopReason: 'max_tokens' },
		];

		const result = await collectStream(makeStream(events));
		expect(result.stopReason).toBe('max_tokens');
	});
});
