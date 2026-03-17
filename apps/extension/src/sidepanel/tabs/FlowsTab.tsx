import { Play } from 'lucide-react';

export function FlowsTab() {
	return (
		<div className="flex flex-col items-center justify-center h-full p-8 text-center">
			<div className="p-3 rounded-full bg-secondary mb-4">
				<Play size={24} className="text-muted-foreground" />
			</div>
			<h2 className="text-sm font-semibold text-foreground mb-1">Flows</h2>
			<p className="text-xs text-muted-foreground">
				Coming soon. Record and replay multi-step workflows across any web app.
			</p>
		</div>
	);
}
