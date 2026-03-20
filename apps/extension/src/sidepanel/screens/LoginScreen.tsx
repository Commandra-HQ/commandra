import { ExternalLink } from 'lucide-react';
import { useState } from 'react';

const API_URL = process.env.API_URL || 'http://localhost:3001';
const DASHBOARD_URL = process.env.DASHBOARD_URL || 'http://localhost:3000';

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
			await chrome.storage.local.set({
				authToken: token.trim(),
				user: { id: user.id, email: user.email },
			});
			window.dispatchEvent(new Event('auth-changed'));
		} catch {
			setError('Invalid or expired token. Generate a new one from the dashboard.');
		} finally {
			setLoading(false);
		}
	}

	function handleOpenDashboard() {
		chrome.tabs.create({ url: DASHBOARD_URL });
	}

	return (
		<div className="flex flex-col items-center justify-center h-screen p-6">
			<h1 className="text-lg font-semibold text-foreground mb-1">Commandra</h1>
			<p className="text-xs text-muted-foreground mb-6">Connect your extension to get started</p>

			<div className="w-full max-w-xs mb-6 space-y-3">
				<div className="p-3 bg-secondary rounded-lg space-y-1.5">
					<p className="text-xs text-muted-foreground">
						<span className="text-foreground font-medium">1.</span> Open the dashboard and sign in
					</p>
					<p className="text-xs text-muted-foreground">
						<span className="text-foreground font-medium">2.</span> Generate a connection token
					</p>
					<p className="text-xs text-muted-foreground">
						<span className="text-foreground font-medium">3.</span> Paste it below
					</p>
				</div>
				<button
					type="button"
					onClick={handleOpenDashboard}
					className="w-full flex items-center justify-center gap-1.5 py-2 text-xs font-medium text-foreground border border-border rounded-md hover:bg-secondary transition-colors"
				>
					<ExternalLink size={12} />
					Open Dashboard
				</button>
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
					{loading ? 'Connecting...' : 'Connect'}
				</button>
			</form>
		</div>
	);
}
