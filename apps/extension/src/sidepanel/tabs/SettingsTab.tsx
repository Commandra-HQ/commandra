import {
	ArrowLeft,
	Brain,
	Globe,
	Laptop,
	LogOut,
	Monitor,
	Moon,
	RefreshCw,
	Server,
	Sun,
	Trash2,
	Wifi,
	WifiOff,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { THEME_OPTIONS, Theme, useTheme } from '../theme.js';
import { useAuth } from '../contexts/auth.js';

const API_URL = process.env.API_URL || 'http://localhost:3001';

const THEME_ICONS: Record<Theme, typeof Monitor> = {
	system: Monitor,
	light: Sun,
	dark: Moon,
};

export function SettingsTab() {
	const navigate = useNavigate();
	const { user, logout } = useAuth();
	const { theme, setTheme } = useTheme();
	const [backendStatus, setBackendStatus] = useState<'checking' | 'connected' | 'disconnected'>(
		'checking',
	);
	const [wsStatus, setWsStatus] = useState<'connected' | 'disconnected' | 'checking'>('checking');
	const [currentDomain, setCurrentDomain] = useState<string | null>(null);
	const [siteInfo, setSiteInfo] = useState<{
		totalPages: number;
		totalElements: number;
		lastCrawledAt: string | null;
	} | null>(null);
	const [memoryCount, setMemoryCount] = useState<number>(0);
	const [clearingMemory, setClearingMemory] = useState(false);

	const checkBackend = useCallback(async () => {
		try {
			const res = await fetch(`${API_URL}/health`);
			setBackendStatus(res.ok ? 'connected' : 'disconnected');
		} catch {
			setBackendStatus('disconnected');
		}
	}, []);

	const checkWsStatus = useCallback(async () => {
		try {
			const response = await chrome.runtime.sendMessage({ type: 'GET_WS_STATUS' });
			setWsStatus(response?.connected ? 'connected' : 'disconnected');
		} catch {
			setWsStatus('disconnected');
		}
	}, []);

	const loadCurrentSite = useCallback(async () => {
		try {
			const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
			if (!tab?.url) return;
			const domain = new URL(tab.url).hostname;
			setCurrentDomain(domain);

			const stored = await chrome.storage.local.get(['authToken']);
			if (!stored.authToken) return;

			const res = await fetch(`${API_URL}/api/sites/${domain}`, {
				headers: { Authorization: `Bearer ${stored.authToken}` },
			});
			if (res.ok) {
				const data = await res.json();
				setSiteInfo({
					totalPages: data.site?.totalPages ?? 0,
					totalElements: data.site?.totalElements ?? 0,
					lastCrawledAt: data.site?.lastCrawledAt ?? null,
				});
			} else {
				setSiteInfo(null);
			}

			// Load memory count for this domain
			const memRes = await fetch(`${API_URL}/api/memory?domain=${domain}`, {
				headers: { Authorization: `Bearer ${stored.authToken}` },
			});
			if (memRes.ok) {
				const memData = await memRes.json();
				setMemoryCount(memData.memories?.length ?? 0);
			}
		} catch {
			setSiteInfo(null);
		}
	}, []);

	useEffect(() => {
		checkBackend();
		checkWsStatus();
		loadCurrentSite();
	}, [checkBackend, checkWsStatus, loadCurrentSite]);

	async function handleDisconnect() {
		await logout();
	}

	async function handleClearMemory() {
		if (!currentDomain) return;
		setClearingMemory(true);
		try {
			const stored = await chrome.storage.local.get(['authToken']);
			if (!stored.authToken) return;
			const res = await fetch(`${API_URL}/api/memory/domain/${currentDomain}`, {
				method: 'DELETE',
				headers: { Authorization: `Bearer ${stored.authToken}` },
			});
			if (res.ok) setMemoryCount(0);
		} catch {
			// ignore
		} finally {
			setClearingMemory(false);
		}
	}

	async function handleReindex() {
		const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
		if (!tab?.id) return;
		chrome.runtime.sendMessage({ type: 'INDEX_PAGE_SINGLE', payload: { tabId: tab.id } });
		// Brief delay then reload site info
		setTimeout(loadCurrentSite, 2000);
	}

	function StatusDot({ status }: { status: 'connected' | 'disconnected' | 'checking' }) {
		const colors = {
			checking: 'bg-yellow-500',
			connected: 'bg-green-500',
			disconnected: 'bg-red-500',
		};
		return <span className={`inline-block w-2 h-2 rounded-full ${colors[status]}`} />;
	}

	return (
		<div className="flex flex-col h-full">
		<header className="px-4 py-3 border-b border-border flex items-center gap-2 flex-shrink-0">
			<button
				onClick={() => navigate('/')}
				className="p-1 text-muted-foreground hover:text-foreground rounded hover:bg-secondary/50"
				title="Back"
			>
				<ArrowLeft size={14} />
			</button>
			<h2 className="text-sm font-semibold text-foreground">Settings</h2>
		</header>
		<div className="flex-1 overflow-y-auto p-4 space-y-5">
			{/* Theme */}
			<section className="space-y-2">
				<h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
					Theme
				</h3>
				<div className="flex gap-1.5 p-1 rounded-lg bg-secondary border border-border">
					{THEME_OPTIONS.map((opt) => {
						const Icon = THEME_ICONS[opt.value];
						const isActive = theme === opt.value;
						return (
							<button
								key={opt.value}
								type="button"
								onClick={() => setTheme(opt.value)}
								className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-2 rounded-md text-xs font-medium transition-colors ${
									isActive
										? 'bg-background text-foreground shadow-sm border border-border'
										: 'text-muted-foreground hover:text-foreground'
								}`}
							>
								<Icon size={14} />
								<span className="hidden sm:inline">{opt.label}</span>
							</button>
						);
					})}
				</div>
				<p className="text-[10px] text-muted-foreground">
					{theme === 'system'
						? 'Uses your system light/dark preference'
						: theme === 'light'
							? 'Always use light mode'
							: 'Always use dark mode'}
				</p>
			</section>

			{/* Account */}
			<section className="space-y-1.5">
				<h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
					Account
				</h3>
				<div className="flex items-center gap-2 text-sm text-foreground">
					<Laptop size={14} className="text-muted-foreground" />
					<span>{user.email}</span>
				</div>
			</section>

			{/* Connection status */}
			<section className="space-y-2">
				<h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
					Connections
				</h3>
				<div className="space-y-1.5">
					<div className="flex items-center justify-between text-xs">
						<div className="flex items-center gap-2 text-foreground">
							<Server size={13} className="text-muted-foreground" />
							<span>Backend API</span>
						</div>
						<div className="flex items-center gap-1.5">
							<StatusDot status={backendStatus} />
							<span className="text-muted-foreground capitalize">{backendStatus}</span>
						</div>
					</div>
					<div className="flex items-center justify-between text-xs">
						<div className="flex items-center gap-2 text-foreground">
							{wsStatus === 'connected' ? (
								<Wifi size={13} className="text-muted-foreground" />
							) : (
								<WifiOff size={13} className="text-muted-foreground" />
							)}
							<span>WebSocket</span>
						</div>
						<div className="flex items-center gap-1.5">
							<StatusDot status={wsStatus} />
							<span className="text-muted-foreground capitalize">{wsStatus}</span>
						</div>
					</div>
				</div>
			</section>

			{/* Current site info */}
			<section className="space-y-2">
				<h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
					Current Site
				</h3>
				{currentDomain ? (
					<div className="space-y-2">
						<div className="flex items-center gap-2 text-sm text-foreground">
							<Globe size={13} className="text-muted-foreground" />
							<span className="font-mono text-xs">{currentDomain}</span>
						</div>
						{siteInfo ? (
							<div className="grid grid-cols-2 gap-2">
								<div className="rounded-md bg-secondary px-2.5 py-1.5">
									<p className="text-[10px] text-muted-foreground">Pages</p>
									<p className="text-sm font-medium text-foreground">{siteInfo.totalPages}</p>
								</div>
								<div className="rounded-md bg-secondary px-2.5 py-1.5">
									<p className="text-[10px] text-muted-foreground">Elements</p>
									<p className="text-sm font-medium text-foreground">{siteInfo.totalElements}</p>
								</div>
							</div>
						) : (
							<p className="text-xs text-muted-foreground">Not indexed yet</p>
						)}
						<button
							onClick={handleReindex}
							className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
						>
							<RefreshCw size={12} />
							<span>Re-index current page</span>
						</button>
					</div>
				) : (
					<p className="text-xs text-muted-foreground">Navigate to a web page to see info</p>
				)}
			</section>

			{/* Agent Memory */}
			<section className="space-y-2">
				<h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
					Agent Memory
				</h3>
				{currentDomain ? (
					<div className="space-y-2">
						<div className="grid grid-cols-2 gap-2">
							<div className="rounded-md bg-secondary px-2.5 py-1.5">
								<p className="text-[10px] text-muted-foreground">Memories</p>
								<p className="text-sm font-medium text-foreground">{memoryCount}</p>
							</div>
							<div className="rounded-md bg-secondary px-2.5 py-1.5">
								<p className="text-[10px] text-muted-foreground">Domain</p>
								<p className="text-xs font-medium text-foreground truncate">{currentDomain}</p>
							</div>
						</div>
						<p className="text-[10px] text-muted-foreground">
							The agent learns your preferences and corrections over time.
						</p>
						<button
							onClick={handleClearMemory}
							disabled={clearingMemory || memoryCount === 0}
							className="flex items-center gap-1.5 text-xs text-destructive hover:text-destructive/80 transition-colors disabled:opacity-40 disabled:pointer-events-none"
						>
							<Trash2 size={12} />
							<span>{clearingMemory ? 'Clearing...' : 'Forget everything about this site'}</span>
						</button>
					</div>
				) : (
					<div className="flex items-center gap-2 text-xs text-muted-foreground">
						<Brain size={13} />
						<span>Navigate to a site to see memory</span>
					</div>
				)}
			</section>

			{/* Danger zone */}
			<section className="pt-2 border-t border-border">
				<button
					onClick={handleDisconnect}
					className="flex items-center gap-2 w-full py-2 text-sm text-destructive hover:bg-destructive/5 rounded-md justify-center transition-colors"
				>
					<LogOut size={14} />
					<span>Disconnect</span>
				</button>
			</section>
		</div>
		</div>
	);
}
