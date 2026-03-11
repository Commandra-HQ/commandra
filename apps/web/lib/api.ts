export const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export function getStoredToken(): string | null {
	if (typeof window === 'undefined') return null;
	return localStorage.getItem('afe_token');
}

export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
	const token = getStoredToken();
	return fetch(`${API_URL}${path}`, {
		...init,
		headers: {
			...init?.headers,
			...(token ? { Authorization: `Bearer ${token}` } : {}),
		},
	});
}
