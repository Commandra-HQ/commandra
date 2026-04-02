'use client';

import { useClerk } from '@clerk/nextjs';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

interface AuthUser {
	id: string;
	email: string;
	orgId?: string;
	orgName?: string;
	role?: string;
	isClerkManaged?: boolean;
}

interface AuthContextValue {
	user: AuthUser | null;
	token: string | null;
	loading: boolean;
	/** Clears app JWT and ends the Clerk session (awaited so sign-out finishes). */
	logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
	const { signOut } = useClerk();
	const [user, setUser] = useState<AuthUser | null>(null);
	const [token, setToken] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		const stored = localStorage.getItem('afe_token');
		if (stored) {
			verifyToken(stored);
		} else {
			setLoading(false);
		}
	}, []);

	async function verifyToken(jwt: string) {
		try {
			const res = await fetch(`${API_URL}/api/auth/me`, {
				headers: { Authorization: `Bearer ${jwt}` },
			});
			if (res.ok) {
				const data = await res.json();
				setUser({
					id: data.id,
					email: data.email,
					orgId: data.orgId,
					orgName: data.orgName,
					role: data.role,
					isClerkManaged: data.isClerkManaged,
				});
				setToken(jwt);
			} else {
				localStorage.removeItem('afe_token');
			}
		} catch {
			localStorage.removeItem('afe_token');
		} finally {
			setLoading(false);
		}
	}

	const logout = useCallback(async () => {
		localStorage.removeItem('afe_token');
		setToken(null);
		setUser(null);
		await signOut({ redirectUrl: '/sign-in' });
	}, [signOut]);

	return (
		<AuthContext.Provider value={{ user, token, loading, logout }}>
			{children}
		</AuthContext.Provider>
	);
}

export function useAuth() {
	const ctx = useContext(AuthContext);
	if (!ctx) throw new Error('useAuth must be used within AuthProvider');
	return ctx;
}
