import { Navigate, Route, Routes } from 'react-router-dom';
import { useTheme } from './theme.js';
import { useAuth } from './contexts/auth.js';
import { LoginScreen } from './screens/LoginScreen.js';
import { ChatTab } from './tabs/ChatTab.js';
import { HubTab } from './tabs/HubTab.js';
import { SettingsTab } from './tabs/SettingsTab.js';
import { HubLayout } from './layouts/HubLayout.js';

export function App() {
	const { user, loading } = useAuth();
	useTheme();

	if (loading) {
		return (
			<div className="flex items-center justify-center h-screen">
				<p className="text-sm text-muted-foreground">Loading...</p>
			</div>
		);
	}

	return (
		<div className="flex flex-col h-screen bg-background">
			<Routes>
				{user ? (
					<>
						<Route element={<HubLayout />}>
							<Route index element={<HubTab />} />
						</Route>
						<Route path="/chat" element={<ChatTab />} />
						<Route path="/chat/:conversationId" element={<ChatTab />} />
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
