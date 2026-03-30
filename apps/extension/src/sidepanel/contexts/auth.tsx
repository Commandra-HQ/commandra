import { createContext, useCallback, useContext, useEffect, useState } from 'react';

interface User {
	id: string;
	email: string;
}

export type LogoutOptions = {
	/** When true (default), opens the marketing “goodbye” page in a new tab. */
	openFarewellPage?: boolean;
};

interface AuthContextValue {
	user: User | null;
	loading: boolean;
	logout: (options?: LogoutOptions) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
	user: null,
	loading: true,
	logout: async (_opts?: LogoutOptions) => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
	const [user, setUser] = useState<User | null>(null);
	const [loading, setLoading] = useState(true);

	const loadUser = useCallback(async () => {
		try {
			const result = await chrome.storage.local.get(['user', 'authToken']);
			if (result.user && result.authToken) {
				setUser(result.user);
			} else {
				setUser(null);
			}
		} catch {
			setUser(null);
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		loadUser();
		const handler = () => loadUser();
		window.addEventListener('auth-changed', handler);
		return () => window.removeEventListener('auth-changed', handler);
	}, [loadUser]);

	const logout = useCallback(async (options?: LogoutOptions) => {
		const openFarewell = options?.openFarewellPage !== false;
		await chrome.storage.local.remove(['authToken', 'user']);
		setUser(null);
		window.dispatchEvent(new Event('auth-changed'));
		try {
			await chrome.runtime.sendMessage({ type: 'EXTENSION_LOGOUT' });
		} catch {
			/* background may be unavailable in edge cases */
		}
		if (openFarewell) {
			const url = process.env.GOODBYE_URL || 'http://localhost:3003/goodbye';
			await chrome.tabs.create({ url });
		}
	}, []);

	return (
		<AuthContext.Provider value={{ user, loading, logout }}>
			{children}
		</AuthContext.Provider>
	);
}

export function useAuth() {
	return useContext(AuthContext);
}
