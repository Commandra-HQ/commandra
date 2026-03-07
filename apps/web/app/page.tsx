import { UserButton } from '@clerk/nextjs';
import { currentUser } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { ExtensionToken } from './extension-token';

export default async function Dashboard() {
	const user = await currentUser();
	if (!user) redirect('/sign-in');

	return (
		<div className="max-w-4xl mx-auto py-10 px-4">
			<div className="flex items-center justify-between mb-8">
				<h1 className="text-2xl font-bold">Agents for Everyone</h1>
				<UserButton />
			</div>

			<div className="bg-white rounded-lg border p-6 mb-6">
				<h2 className="text-lg font-semibold mb-2">Connect Chrome Extension</h2>
				<p className="text-sm text-gray-600 mb-4">
					Generate a token and paste it in the Chrome extension side panel.
				</p>
				<ExtensionToken />
			</div>

			<div className="bg-white rounded-lg border p-6">
				<h2 className="text-lg font-semibold mb-2">Account</h2>
				<p className="text-sm text-gray-600">{user.emailAddresses[0]?.emailAddress}</p>
			</div>
		</div>
	);
}
