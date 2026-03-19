import { createContext, useCallback, useContext, useEffect, useState } from 'react';

interface User {
	id: string;
	email: string;
}

interface AuthContextValue {
	user: User | null;
	loading: boolean;
	logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
	user: null,
	loading: true,
	logout: async () => {},
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

	const logout = useCallback(async () => {
		await chrome.storage.local.remove(['authToken', 'user']);
		setUser(null);
		window.dispatchEvent(new Event('auth-changed'));
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
