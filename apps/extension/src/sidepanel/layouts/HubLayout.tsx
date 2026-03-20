import { ExternalLink, Settings, X } from 'lucide-react';
import { Outlet, useNavigate } from 'react-router-dom';
import commandraLogo from '../../../public/icons/icon-128.png';

const DASHBOARD_URL = process.env.DASHBOARD_URL || 'http://localhost:3000';

export function HubLayout() {
	const navigate = useNavigate();

	function handleClosePanel() {
		window.close();
	}

	function handleOpenDashboard() {
		chrome.tabs.create({ url: DASHBOARD_URL });
	}

	return (
		<>
			<header className="px-4 py-3 border-b border-border flex items-center justify-between">
				<div className="flex items-center gap-2 min-w-0">
					<img
						src={commandraLogo}
						alt="Commandra logo"
						className="w-4 h-4 rounded-sm flex-shrink-0"
					/>
					<h1 className="text-sm font-semibold text-foreground truncate">Commandra</h1>
				</div>
				<div className="flex items-center gap-1">
					<button
						type="button"
						onClick={handleOpenDashboard}
						className="p-1.5 text-muted-foreground hover:text-foreground rounded-md hover:bg-secondary/50 transition-colors"
						title="Open Dashboard"
					>
						<ExternalLink size={14} />
					</button>
					<button
						type="button"
						onClick={() => navigate('/settings')}
						className="p-1.5 text-muted-foreground hover:text-foreground rounded-md hover:bg-secondary/50 transition-colors"
						title="Settings"
					>
						<Settings size={16} />
					</button>
					<button
						type="button"
						onClick={handleClosePanel}
						className="p-1.5 text-muted-foreground hover:text-foreground rounded-md hover:bg-secondary/50 transition-colors"
						title="Close"
					>
						<X size={16} />
					</button>
				</div>
			</header>
			<div className="flex-1 overflow-hidden">
				<Outlet />
			</div>
		</>
	);
}
