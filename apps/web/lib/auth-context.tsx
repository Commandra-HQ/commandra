'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

interface AuthUser {
	id: string;
	email: string;
}

interface AuthContextValue {
	user: AuthUser | null;
	token: string | null;
	loading: boolean;
	login: (email: string, password: string) => Promise<void>;
	register: (email: string, password: string) => Promise<void>;
	logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
	const [user, setUser] = useState<AuthUser | null>(null);
	const [token, setToken] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);

	// On mount, check for stored token
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
				setUser({ id: data.id, email: data.email });
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

	const login = useCallback(async (email: string, password: string) => {
		const res = await fetch(`${API_URL}/api/auth/login`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ email, password }),
		});
		if (!res.ok) {
			const data = await res.json();
			throw new Error(data.error || 'Login failed');
		}
		const data = await res.json();
		localStorage.setItem('afe_token', data.token);
		setToken(data.token);
		setUser({ id: data.userId, email: data.email });
	}, []);

	const register = useCallback(async (email: string, password: string) => {
		const res = await fetch(`${API_URL}/api/auth/register`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ email, password }),
		});
		if (!res.ok) {
			const data = await res.json();
			throw new Error(data.error || 'Registration failed');
		}
		const data = await res.json();
		localStorage.setItem('afe_token', data.token);
		setToken(data.token);
		setUser({ id: data.userId, email: data.email });
	}, []);

	const logout = useCallback(() => {
		localStorage.removeItem('afe_token');
		setToken(null);
		setUser(null);
	}, []);

	return (
		<AuthContext.Provider value={{ user, token, loading, login, register, logout }}>
			{children}
		</AuthContext.Provider>
	);
}

export function useAuth() {
	const ctx = useContext(AuthContext);
	if (!ctx) throw new Error('useAuth must be used within AuthProvider');
	return ctx;
}
