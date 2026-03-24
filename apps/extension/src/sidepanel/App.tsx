import { Navigate, Route, Routes } from 'react-router-dom';
import { useTheme } from './theme.js';
import { useAuth } from './contexts/auth.js';
import { LoginScreen } from './screens/LoginScreen.js';
import { ChatTab } from './tabs/ChatTab.js';
import { SettingsTab } from './tabs/SettingsTab.js';
import { HubLayout } from './layouts/HubLayout.js';

export function App() {
	const { user, loading } = useAuth();
	useTheme();

	if (loading) {
		return (
			<div className="flex items-center justify-center h-screen">
				<div className="flex items-center gap-2">
					<span className="status-pixel bg-muted-foreground animate-pulse" />
					<p className="text-xs font-mono text-muted-foreground">Loading...</p>
				</div>
			</div>
		);
	}

	return (
		<div className="flex flex-col h-screen bg-background">
			<Routes>
				{user ? (
					<>
						<Route element={<HubLayout />}>
							{/* Default route is now a fresh chat */}
							<Route index element={<ChatTab />} />
							<Route path="/chat/:conversationId" element={<ChatTab />} />
						</Route>
						<Route path="/settings" element={<SettingsTab />} />
						<Route path="*" element={<Navigate to="/" replace />} />
					</>
				) : (
					<>
						<Route path="/login" element={<LoginScreen />} />
						<Route path="*" element={<Navigate to="/login" replace />} />
					</>
				)}
			</Routes>
		</div>
	);
}
