import { ExternalLink } from 'lucide-react';
import { useState } from 'react';
import { VoxelLogo } from '../components/VoxelLogo.js';

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

	return (
		<div className="flex flex-col items-center justify-center h-screen p-6">
			<VoxelLogo size={32} className="text-foreground mb-4" />
			<h1 className="font-mono text-sm font-medium lowercase tracking-wide text-foreground mb-1">
				commandra
			</h1>
			<p className="text-xs text-muted-foreground mb-8">Connect your extension to get started</p>

			<div className="w-full max-w-xs mb-6 space-y-3">
				<div className="p-4 bg-surface border border-border space-y-2">
					<p className="text-xs text-muted-foreground">
						<span className="font-mono text-foreground">01</span> &mdash; Open the dashboard and sign in
					</p>
					<p className="text-xs text-muted-foreground">
						<span className="font-mono text-foreground">02</span> &mdash; Generate a connection token
					</p>
					<p className="text-xs text-muted-foreground">
						<span className="font-mono text-foreground">03</span> &mdash; Paste it below
					</p>
				</div>
				<button
					type="button"
					onClick={() => chrome.tabs.create({ url: DASHBOARD_URL })}
					className="w-full flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium text-foreground border border-border bg-transparent hover:bg-elevated transition-colors"
				>
					<ExternalLink size={12} strokeWidth={1.5} />
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
					className="w-full text-sm font-mono px-3 py-2.5 border border-border bg-transparent focus:outline-none focus:border-foreground transition-colors"
				/>

				{error && (
					<div className="flex items-center gap-2 text-xs text-destructive">
						<span className="status-pixel bg-destructive" />
						{error}
					</div>
				)}

				<button
					type="submit"
					disabled={loading}
					className="w-full py-2.5 text-sm font-medium text-primary-foreground bg-primary hover:opacity-90 disabled:opacity-50 transition-opacity"
				>
					{loading ? 'Connecting...' : 'Connect'}
				</button>
			</form>
		</div>
	);
}
