import { SignIn } from '@clerk/chrome-extension';

export function LoginScreen() {
	return (
		<div className="flex flex-col items-center justify-center h-screen p-6 bg-white">
			<h1 className="text-lg font-semibold text-gray-900 mb-1">Agents for Everyone</h1>
			<p className="text-xs text-gray-500 mb-6">Sign in to get started</p>
			<SignIn />
		</div>
	);
}
