import { useSignIn, useSignUp } from '@clerk/chrome-extension';
import { useState } from 'react';

type Step = 'form' | 'verify';

export function LoginScreen() {
	const { signIn, setActive: setSignInActive } = useSignIn();
	const { signUp, setActive: setSignUpActive } = useSignUp();
	const [mode, setMode] = useState<'signin' | 'signup'>('signin');
	const [step, setStep] = useState<Step>('form');
	const [email, setEmail] = useState('');
	const [password, setPassword] = useState('');
	const [code, setCode] = useState('');
	const [error, setError] = useState('');
	const [loading, setLoading] = useState(false);

	async function handleSignIn(e: React.FormEvent) {
		e.preventDefault();
		if (!signIn) return;
		setLoading(true);
		setError('');
		try {
			const result = await signIn.create({ identifier: email, password });
			console.log('[Auth] Sign in result:', result.status);
			if (result.status === 'complete' && setSignInActive) {
				await setSignInActive({ session: result.createdSessionId });
			}
		} catch (err: any) {
			console.error('[Auth] Sign in error:', err);
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
			console.log('[Auth] Sign up result:', result.status, result);

			if (result.status === 'complete' && setSignUpActive) {
				await setSignUpActive({ session: result.createdSessionId });
				return;
			}

			// Email verification needed
			if (
				result.status === 'missing_requirements' &&
				result.unverifiedFields?.includes('email_address')
			) {
				console.log('[Auth] Preparing email verification...');
				await signUp.prepareEmailAddressVerification({ strategy: 'email_code' });
				console.log('[Auth] Verification email sent');
				setStep('verify');
				return;
			}

			console.log('[Auth] Unexpected signup status:', result.status);
			setError(`Unexpected status: ${result.status}`);
		} catch (err: any) {
			console.error('[Auth] Sign up error:', JSON.stringify(err.errors || err));
			const msg =
				err.errors?.[0]?.longMessage || err.errors?.[0]?.message || 'Sign up failed';

			// If the email is already taken, suggest sign in
			if (err.errors?.[0]?.code === 'form_identifier_exists') {
				setError('That email is already registered. Try signing in instead.');
			} else {
				setError(msg);
			}
		} finally {
			setLoading(false);
		}
	}

	async function handleVerify(e: React.FormEvent) {
		e.preventDefault();
		if (!signUp) return;
		setLoading(true);
		setError('');
		try {
			const result = await signUp.attemptEmailAddressVerification({ code });
			console.log('[Auth] Verify result:', result.status);
			if (result.status === 'complete' && setSignUpActive) {
				await setSignUpActive({ session: result.createdSessionId });
			} else {
				setError(`Verification status: ${result.status}`);
			}
		} catch (err: any) {
			console.error('[Auth] Verify error:', err);
			setError(
				err.errors?.[0]?.longMessage || err.errors?.[0]?.message || 'Verification failed',
			);
		} finally {
			setLoading(false);
		}
	}

	if (step === 'verify') {
		return (
			<div className="flex flex-col items-center justify-center h-screen p-6">
				<h1 className="text-lg font-semibold text-foreground mb-1">Check your email</h1>
				<p className="text-xs text-muted-foreground mb-6">We sent a code to {email}</p>

				<form onSubmit={handleVerify} className="w-full max-w-xs space-y-3">
					<input
						type="text"
						value={code}
						onChange={(e) => setCode(e.target.value)}
						placeholder="Verification code"
						required
						autoFocus
						className="w-full text-sm px-3 py-2 border border-input rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring text-center tracking-widest"
					/>

					{error && <p className="text-xs text-destructive">{error}</p>}

					<button
						type="submit"
						disabled={loading}
						className="w-full py-2 text-sm font-medium text-primary-foreground bg-primary rounded-md hover:opacity-90 disabled:opacity-50"
					>
						{loading ? '...' : 'Verify'}
					</button>
				</form>

				<button
					onClick={() => {
						setStep('form');
						setError('');
						setCode('');
					}}
					className="mt-4 text-xs text-muted-foreground hover:underline"
				>
					Back
				</button>
			</div>
		);
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
				className="mt-4 text-xs text-muted-foreground hover:underline"
			>
				{mode === 'signin'
					? "Don't have an account? Sign up"
					: 'Already have an account? Sign in'}
			</button>
		</div>
	);
}
