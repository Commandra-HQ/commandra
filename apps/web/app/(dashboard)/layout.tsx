import { currentUser } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { Sidebar } from '@/components/sidebar';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
	const user = await currentUser();
	if (!user) redirect('/sign-in');

	return (
		<div className="flex h-screen">
			<Sidebar />
			<main className="flex-1 overflow-y-auto">
				<div className="max-w-6xl mx-auto px-6 py-8">{children}</div>
			</main>
		</div>
	);
}
