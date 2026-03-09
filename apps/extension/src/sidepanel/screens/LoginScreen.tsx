import { useState } from 'react';

const API_URL = process.env.API_URL || 'http://localhost:3001';

export function LoginScreen() {
	const [token, setToken] = useState('');
	const [error, setError] = useState('');
	const [loading, setLoading] = useState(false);

	async function handleConnect(e: React.FormEvent) {
		e.preventDefault();
		if (!token.trim()) return;
		setLoading(true);
		setError('');
		try {
			const res = await fetch(`${API_URL}/api/auth/me`, {
				headers: { Authorization: `Bearer ${token.trim()}` },
			});
			if (!res.ok) throw new Error('Invalid token');
			const user = await res.json();
			// Store token and user in chrome.storage
			await chrome.storage.local.set({
				authToken: token.trim(),
				user: { id: user.id, email: user.email, clerkId: user.clerkId },
			});
			// Trigger re-render in App
			window.dispatchEvent(new Event('auth-changed'));
		} catch {
			setError('Invalid or expired token. Generate a new one from the dashboard.');
		} finally {
			setLoading(false);
		}
	}

	return (
		<div className="flex flex-col items-center justify-center h-screen p-6">
			<h1 className="text-lg font-semibold text-foreground mb-1">Agents for Everyone</h1>
			<p className="text-xs text-muted-foreground mb-4">Connect your extension to get started</p>

			<div className="w-full max-w-xs mb-6 p-3 bg-secondary rounded-md">
				<p className="text-xs text-muted-foreground">
					1. Go to <span className="font-medium text-foreground">localhost:3000</span>
				</p>
				<p className="text-xs text-muted-foreground">2. Sign in and generate a token</p>
				<p className="text-xs text-muted-foreground">3. Paste it below</p>
			</div>

			<form onSubmit={handleConnect} className="w-full max-w-xs space-y-3">
				<input
					type="password"
					value={token}
					onChange={(e) => setToken(e.target.value)}
					placeholder="Paste your token"
					required
					className="w-full text-sm px-3 py-2 border border-input rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring"
				/>

				{error && <p className="text-xs text-destructive">{error}</p>}

				<button
					type="submit"
					disabled={loading}
					className="w-full py-2 text-sm font-medium text-primary-foreground bg-primary rounded-md hover:opacity-90 disabled:opacity-50"
				>
					{loading ? '...' : 'Connect'}
				</button>
			</form>
		</div>
	);
}
