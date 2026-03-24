import { Navigate, Route, Routes, useParams } from 'react-router-dom';
import { useTheme } from './theme.js';
import { useAuth } from './contexts/auth.js';
import { LoginScreen } from './screens/LoginScreen.js';
import { ChatTab } from './tabs/ChatTab.js';
import { SettingsTab } from './tabs/SettingsTab.js';
import { HubLayout } from './layouts/HubLayout.js';

/**
 * Wrapper that forces ChatTab to fully remount when the conversation changes.
 * Without this, React reuses the same ChatTab instance when switching between
 * /chat/abc and /chat/def, leaving stale messages from the previous conversation.
 */
function KeyedChatTab() {
	const { conversationId } = useParams<{ conversationId?: string }>();
	return <ChatTab key={conversationId || '__new__'} />;
}

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
							<Route index element={<KeyedChatTab />} />
							<Route path="/chat/:conversationId" element={<KeyedChatTab />} />
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
