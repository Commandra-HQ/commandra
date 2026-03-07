import { useSignIn, useSignUp } from '@clerk/chrome-extension';
import { useState } from 'react';

export function LoginScreen() {
	const { signIn, setActive: setSignInActive } = useSignIn();
	const { signUp, setActive: setSignUpActive } = useSignUp();
	const [mode, setMode] = useState<'signin' | 'signup'>('signin');
	const [email, setEmail] = useState('');
	const [password, setPassword] = useState('');
	const [error, setError] = useState('');
	const [loading, setLoading] = useState(false);

	async function handleSignIn(e: React.FormEvent) {
		e.preventDefault();
		if (!signIn) return;
		setLoading(true);
		setError('');
		try {
			const result = await signIn.create({ identifier: email, password });
			if (result.status === 'complete' && setSignInActive) {
				await setSignInActive({ session: result.createdSessionId });
			}
		} catch (err: any) {
			setError(err.errors?.[0]?.longMessage || err.errors?.[0]?.message || 'Sign in failed');
		} finally {
			setLoading(false);
		}
	}

	async function handleSignUp(e: React.FormEvent) {
		e.preventDefault();
		if (!signUp) return;
		setLoading(true);
		setError('');
		try {
			const result = await signUp.create({ emailAddress: email, password });
			if (result.status === 'complete' && setSignUpActive) {
				await setSignUpActive({ session: result.createdSessionId });
			}
		} catch (err: any) {
			setError(err.errors?.[0]?.longMessage || err.errors?.[0]?.message || 'Sign up failed');
		} finally {
			setLoading(false);
		}
	}

	return (
		<div className="flex flex-col items-center justify-center h-screen p-6">
			<h1 className="text-lg font-semibold text-foreground mb-1">Agents for Everyone</h1>
			<p className="text-xs text-muted-foreground mb-6">
				{mode === 'signin' ? 'Sign in to your account' : 'Create your account'}
			</p>

			<form
				onSubmit={mode === 'signin' ? handleSignIn : handleSignUp}
				className="w-full max-w-xs space-y-3"
			>
				<input
					type="email"
					value={email}
					onChange={(e) => setEmail(e.target.value)}
					placeholder="Email"
					required
					className="w-full text-sm px-3 py-2 border border-input rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring"
				/>
				<input
					type="password"
					value={password}
					onChange={(e) => setPassword(e.target.value)}
					placeholder="Password"
					required
					className="w-full text-sm px-3 py-2 border border-input rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring"
				/>

				{error && <p className="text-xs text-destructive">{error}</p>}

				<button
					type="submit"
					disabled={loading}
					className="w-full py-2 text-sm font-medium text-primary-foreground bg-primary rounded-md hover:opacity-90 disabled:opacity-50"
				>
					{loading ? '...' : mode === 'signin' ? 'Sign in' : 'Sign up'}
				</button>
			</form>

			<button
				onClick={() => {
					setMode(mode === 'signin' ? 'signup' : 'signin');
					setError('');
				}}
				className="mt-4 text-xs text-primary hover:underline"
			>
				{mode === 'signin' ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
			</button>
		</div>
	);
}
