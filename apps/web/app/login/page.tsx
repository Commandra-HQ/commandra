'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/lib/auth-context';
import { Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export default function LoginPage() {
	const router = useRouter();
	const { login, register } = useAuth();
	const [mode, setMode] = useState<'login' | 'register'>('login');
	const [email, setEmail] = useState('');
	const [password, setPassword] = useState('');
	const [error, setError] = useState('');
	const [loading, setLoading] = useState(false);

	async function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		setError('');
		setLoading(true);
		try {
			if (mode === 'login') {
				await login(email, password);
			} else {
				await register(email, password);
			}
			router.push('/');
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Something went wrong');
		} finally {
			setLoading(false);
		}
	}

	return (
		<div className="flex items-center justify-center min-h-screen">
			<Card className="w-full max-w-sm">
				<CardHeader className="text-center">
					<div className="mx-auto h-10 w-10 rounded-lg bg-primary flex items-center justify-center mb-2">
						<span className="text-primary-foreground text-sm font-bold">A</span>
					</div>
					<CardTitle>{mode === 'login' ? 'Sign in' : 'Create account'}</CardTitle>
					<CardDescription>
						{mode === 'login' ? 'Sign in to your dashboard' : 'Create an account to get started'}
					</CardDescription>
				</CardHeader>
				<CardContent>
					<form onSubmit={handleSubmit} className="space-y-4">
						<div className="space-y-2">
							<label className="text-sm font-medium">Email</label>
							<Input
								type="email"
								placeholder="you@example.com"
								value={email}
								onChange={(e) => setEmail(e.target.value)}
								required
							/>
						</div>
						<div className="space-y-2">
							<label className="text-sm font-medium">Password</label>
							<Input
								type="password"
								placeholder="Min 8 characters"
								value={password}
								onChange={(e) => setPassword(e.target.value)}
								required
								minLength={8}
							/>
						</div>

						{error && <p className="text-sm text-destructive">{error}</p>}

						<Button type="submit" className="w-full" disabled={loading}>
							{loading && <Loader2 size={16} className="mr-2 animate-spin" />}
							{mode === 'login' ? 'Sign in' : 'Create account'}
						</Button>
					</form>

					<div className="mt-4 text-center text-sm text-muted-foreground">
						{mode === 'login' ? (
							<>
								No account?{' '}
								<button
									onClick={() => {
										setMode('register');
										setError('');
									}}
									className="text-foreground underline hover:no-underline"
								>
									Create one
								</button>
							</>
						) : (
							<>
								Already have an account?{' '}
								<button
									onClick={() => {
										setMode('login');
										setError('');
									}}
									className="text-foreground underline hover:no-underline"
								>
									Sign in
								</button>
							</>
						)}
					</div>
				</CardContent>
			</Card>
		</div>
	);
}
