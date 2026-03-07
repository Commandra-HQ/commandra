import { useState } from 'react';

export function App() {
	const [messages, setMessages] = useState<{ role: string; content: string }[]>([]);
	const [input, setInput] = useState('');

	const sendMessage = () => {
		if (!input.trim()) return;
		setMessages((prev) => [...prev, { role: 'user', content: input }]);
		// TODO: Send to backend via WebSocket
		setMessages((prev) => [
			...prev,
			{ role: 'assistant', content: 'Agent backend not connected yet. Coming soon.' },
		]);
		setInput('');
	};

	return (
		<div className="flex flex-col h-screen bg-white">
			<header className="px-4 py-3 border-b border-gray-200">
				<h1 className="text-sm font-semibold text-gray-900">Agents for Everyone</h1>
			</header>

			<div className="flex-1 overflow-y-auto p-4 space-y-3">
				{messages.length === 0 && (
					<p className="text-sm text-gray-500">
						Navigate to any web app and ask me to help automate your work.
					</p>
				)}
				{messages.map((msg, i) => (
					<div
						key={i}
						className={`text-sm p-2 rounded ${
							msg.role === 'user' ? 'bg-blue-50 text-blue-900' : 'bg-gray-50 text-gray-900'
						}`}
					>
						{msg.content}
					</div>
				))}
			</div>

			<div className="p-3 border-t border-gray-200">
				<div className="flex gap-2">
					<input
						type="text"
						value={input}
						onChange={(e) => setInput(e.target.value)}
						onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
						placeholder="What would you like to do?"
						className="flex-1 text-sm px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
					/>
					<button
						onClick={sendMessage}
						className="px-3 py-2 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700"
					>
						Send
					</button>
				</div>
			</div>
		</div>
	);
}
