'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { Trash2, UserPlus } from 'lucide-react';
import { useEffect, useState } from 'react';

interface OrgMember {
	id: string;
	userId: string;
	email: string;
	role: string;
	createdAt: string;
}

export default function OrgPage() {
	const { user } = useAuth();
	const [members, setMembers] = useState<OrgMember[]>([]);
	const [loading, setLoading] = useState(true);
	const [inviteEmail, setInviteEmail] = useState('');
	const [inviteRole, setInviteRole] = useState('member');
	const [error, setError] = useState<string | null>(null);
	const [success, setSuccess] = useState<string | null>(null);

	const isAdmin = user?.role === 'admin';

	useEffect(() => {
		if (user?.orgId) {
			loadMembers();
		} else {
			setLoading(false);
		}
	}, [user?.orgId]);

	async function loadMembers() {
		try {
			const res = await apiFetch(`/api/orgs/${user!.orgId}/members`);
			if (res.ok) {
				const data = await res.json();
				setMembers(data.members);
			}
		} catch {
			setError('Failed to load members');
		} finally {
			setLoading(false);
		}
	}

	async function inviteMember(e: React.FormEvent) {
		e.preventDefault();
		setError(null);
		setSuccess(null);

		try {
			const res = await apiFetch(`/api/orgs/${user!.orgId}/members`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
			});
			if (!res.ok) {
				const data = await res.json();
				setError(data.error || 'Failed to invite');
				return;
			}
			setSuccess(`Invited ${inviteEmail}`);
			setInviteEmail('');
			loadMembers();
		} catch {
			setError('Failed to invite member');
		}
	}

	async function changeRole(userId: string, role: string) {
		setError(null);
		try {
			const res = await apiFetch(`/api/orgs/${user!.orgId}/members/${userId}`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ role }),
			});
			if (!res.ok) {
				const data = await res.json();
				setError(data.error || 'Failed to update role');
				return;
			}
			loadMembers();
		} catch {
			setError('Failed to update role');
		}
	}

	async function removeMember(userId: string) {
		setError(null);
		try {
			const res = await apiFetch(`/api/orgs/${user!.orgId}/members/${userId}`, {
				method: 'DELETE',
			});
			if (!res.ok) {
				const data = await res.json();
				setError(data.error || 'Failed to remove');
				return;
			}
			loadMembers();
		} catch {
			setError('Failed to remove member');
		}
	}

	if (!user?.orgId) {
		return (
			<div className="space-y-6">
				<h1 className="text-2xl font-bold tracking-tight">Organization</h1>
				<p className="text-muted-foreground">
					You are not part of an organization. Organizations are created through team plans or by
					your administrator.
				</p>
			</div>
		);
	}

	if (loading) {
		return (
			<div className="flex items-center justify-center py-12">
				<p className="text-sm text-muted-foreground">Loading...</p>
			</div>
		);
	}

	return (
		<div className="space-y-6">
			<div>
				<h1 className="text-2xl font-bold tracking-tight">Organization</h1>
				<p className="text-muted-foreground">{user.orgName || 'Your organization'}</p>
			</div>

			{error && (
				<div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
					{error}
				</div>
			)}
			{success && (
				<div className="rounded-md bg-green-500/10 px-3 py-2 text-sm text-green-700">{success}</div>
			)}

			{isAdmin && (
				<Card>
					<CardHeader>
						<CardTitle className="text-lg">Invite Member</CardTitle>
						<CardDescription>Add a team member by their email address</CardDescription>
					</CardHeader>
					<CardContent>
						<form onSubmit={inviteMember} className="flex items-end gap-3">
							<div className="flex-1">
								<label className="text-sm font-medium" htmlFor="invite-email">
									Email
								</label>
								<input
									id="invite-email"
									type="email"
									required
									value={inviteEmail}
									onChange={(e) => setInviteEmail(e.target.value)}
									placeholder="teammate@company.com"
									className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
								/>
							</div>
							<div>
								<label className="text-sm font-medium" htmlFor="invite-role">
									Role
								</label>
								<select
									id="invite-role"
									value={inviteRole}
									onChange={(e) => setInviteRole(e.target.value)}
									className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
								>
									<option value="member">Member</option>
									<option value="viewer">Viewer</option>
									<option value="admin">Admin</option>
								</select>
							</div>
							<Button type="submit" size="sm">
								<UserPlus size={16} />
								Invite
							</Button>
						</form>
					</CardContent>
				</Card>
			)}

			<Card>
				<CardHeader>
					<CardTitle className="text-lg">Members</CardTitle>
					<CardDescription>
						{members.length} member{members.length !== 1 ? 's' : ''}
					</CardDescription>
				</CardHeader>
				<CardContent>
					<div className="divide-y">
						{members.map((member) => (
							<div key={member.id} className="flex items-center justify-between py-3">
								<div>
									<p className="text-sm font-medium">{member.email}</p>
									<p className="text-xs text-muted-foreground capitalize">{member.role}</p>
								</div>
								{isAdmin && member.userId !== user.id && (
									<div className="flex items-center gap-2">
										<select
											value={member.role}
											onChange={(e) => changeRole(member.userId, e.target.value)}
											className="rounded-md border border-input bg-background px-2 py-1 text-xs"
										>
											<option value="admin">Admin</option>
											<option value="member">Member</option>
											<option value="viewer">Viewer</option>
										</select>
										<Button
											variant="ghost"
											size="icon"
											onClick={() => removeMember(member.userId)}
											className="h-8 w-8 text-destructive hover:text-destructive"
										>
											<Trash2 size={14} />
										</Button>
									</div>
								)}
							</div>
						))}
					</div>
				</CardContent>
			</Card>
		</div>
	);
}
