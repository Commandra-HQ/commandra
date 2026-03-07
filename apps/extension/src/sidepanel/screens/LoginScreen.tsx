import { SignIn } from '@clerk/chrome-extension';

export function LoginScreen() {
	return (
		<div className="flex flex-col items-center justify-center h-screen p-6">
			<h1 className="text-lg font-semibold text-foreground mb-1">Agents for Everyone</h1>
			<p className="text-xs text-muted-foreground mb-6">Sign in to get started</p>
			<SignIn routing="virtual" />
		</div>
	);
}
