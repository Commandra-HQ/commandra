import { Settings } from 'lucide-react';
import { Outlet, useNavigate } from 'react-router-dom';

export function HubLayout() {
	const navigate = useNavigate();

	return (
		<>
			<header className="px-4 py-3 border-b border-border flex items-center justify-between">
				<h1 className="text-sm font-semibold text-foreground">Commandra</h1>
				<button
					onClick={() => navigate('/settings')}
					className="p-1.5 text-muted-foreground hover:text-foreground rounded-md hover:bg-secondary/50 transition-colors"
					title="Settings"
				>
					<Settings size={16} />
				</button>
			</header>
			<div className="flex-1 overflow-hidden">
				<Outlet />
			</div>
		</>
	);
}
