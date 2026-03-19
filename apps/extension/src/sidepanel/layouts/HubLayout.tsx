import { Settings, X } from 'lucide-react';
import { Outlet, useNavigate } from 'react-router-dom';
import commandraLogo from '../../../public/icons/icon-128.png';

export function HubLayout() {
	const navigate = useNavigate();

	function handleClosePanel() {
		// Side panel pages cannot always be closed programmatically.
		// This works where the host allows script-initiated close.
		window.close();
	}

	return (
		<>
			<header className="px-4 py-3 border-b border-border flex items-center justify-between">
				<div className="flex items-center gap-2 min-w-0">
					<img src={commandraLogo} alt="Commandra logo" className="w-4 h-4 rounded-sm flex-shrink-0" />
					<h1 className="text-sm font-semibold text-foreground truncate">Commandra</h1>
				</div>
				<div className="flex items-center gap-1">
					<button
						onClick={() => navigate('/settings')}
						className="p-1.5 text-muted-foreground hover:text-foreground rounded-md hover:bg-secondary/50 transition-colors"
						title="Settings"
					>
						<Settings size={16} />
					</button>
					<button
						onClick={handleClosePanel}
						className="p-1.5 text-muted-foreground hover:text-foreground rounded-md hover:bg-secondary/50 transition-colors"
						title="Close extension panel"
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
