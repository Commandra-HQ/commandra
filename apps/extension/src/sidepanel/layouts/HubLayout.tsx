import { ExternalLink, History, Settings, X } from 'lucide-react';
import { useState } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { HistoryDrawer } from '../components/HistoryDrawer.js';
import { VoxelLogo } from '../components/VoxelLogo.js';

const DASHBOARD_URL = process.env.DASHBOARD_URL || 'http://localhost:3000';

export function HubLayout() {
	const navigate = useNavigate();
	const [historyOpen, setHistoryOpen] = useState(false);

	return (
		<>
			<header className="h-10 px-3 border-b border-border flex items-center justify-between bg-surface flex-shrink-0">
				<div className="flex items-center gap-2 min-w-0">
					<button
						onClick={() => setHistoryOpen(true)}
						className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-elevated transition-colors"
						title="Chat history"
					>
						<History size={13} strokeWidth={1.5} />
					</button>
					<button
						onClick={() => navigate('/')}
						className="flex items-center gap-1.5 min-w-0"
					>
						<VoxelLogo size={16} className="text-foreground flex-shrink-0" />
						<span className="font-mono text-[11px] font-medium lowercase tracking-wide text-foreground truncate">
							commandra
						</span>
					</button>
				</div>
				<div className="flex items-center gap-0.5">
					<button
						type="button"
						onClick={() => chrome.tabs.create({ url: DASHBOARD_URL })}
						className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-elevated transition-colors"
						title="Open Dashboard"
					>
						<ExternalLink size={13} strokeWidth={1.5} />
					</button>
					<button
						type="button"
						onClick={() => navigate('/settings')}
						className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-elevated transition-colors"
						title="Settings"
					>
						<Settings size={13} strokeWidth={1.5} />
					</button>
					<button
						type="button"
						onClick={() => window.close()}
						className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-elevated transition-colors"
						title="Close"
					>
						<X size={13} strokeWidth={1.5} />
					</button>
				</div>
			</header>
			<div className="flex-1 overflow-hidden">
				<Outlet />
			</div>

			<HistoryDrawer open={historyOpen} onClose={() => setHistoryOpen(false)} />
		</>
	);
}
