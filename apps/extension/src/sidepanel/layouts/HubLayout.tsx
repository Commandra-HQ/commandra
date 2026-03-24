import { ExternalLink, Settings, X } from 'lucide-react';
import { Outlet, useNavigate } from 'react-router-dom';

const DASHBOARD_URL = process.env.DASHBOARD_URL || 'http://localhost:3000';

export function HubLayout() {
	const navigate = useNavigate();

	return (
		<>
			<header className="h-10 px-3 border-b border-border flex items-center justify-between bg-surface">
				<div className="flex items-center gap-2 min-w-0">
					<div className="h-5 w-5 bg-foreground flex items-center justify-center flex-shrink-0">
						<span className="text-background text-[8px] font-bold font-mono">C</span>
					</div>
					<span className="font-mono text-xs font-medium lowercase tracking-wide text-foreground truncate">
						commandra
					</span>
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
		</>
	);
}
