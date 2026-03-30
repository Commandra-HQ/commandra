'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useAuth } from '@/lib/auth-context';
import {
	useInviteMemberMutation,
	useOrgMembersQuery,
	useRemoveMemberMutation,
	useUpdateMemberRoleMutation,
} from '@/lib/queries/use-org';
import { Building2, Clock, Trash2, UserPlus } from 'lucide-react';
import { useState } from 'react';

export default function OrgPage() {
	const { user } = useAuth();
	const { data, isLoading } = useOrgMembersQuery(user?.orgId);
	const inviteMutation = useInviteMemberMutation();
	const updateRoleMutation = useUpdateMemberRoleMutation();
	const removeMutation = useRemoveMemberMutation();

	const [inviteEmail, setInviteEmail] = useState('');
	const [inviteRole, setInviteRole] = useState('member');
	const [error, setError] = useState<string | null>(null);
	const [success, setSuccess] = useState<string | null>(null);

	const members = data?.members ?? [];
	const pendingInvites = data?.pendingInvites ?? [];
	const isAdmin = user?.role === 'admin';
	const isClerkManaged = user?.isClerkManaged;

	async function inviteMember(e: React.FormEvent) {
		e.preventDefault();
		setError(null);
		setSuccess(null);
		try {
			await inviteMutation.mutateAsync({
				orgId: user!.orgId!,
				email: inviteEmail,
				role: inviteRole,
			});
			setSuccess(`Invited ${inviteEmail}`);
			setInviteEmail('');
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to invite');
		}
	}

	async function changeRole(userId: string, role: string) {
		setError(null);
		try {
			await updateRoleMutation.mutateAsync({ orgId: user!.orgId!, userId, role });
		} catch {
			setError('Failed to update role');
		}
	}

	async function removeMember(userId: string) {
		setError(null);
		try {
			await removeMutation.mutateAsync({ orgId: user!.orgId!, userId });
		} catch {
			setError('Failed to remove member');
		}
	}

	if (!user?.orgId) {
		return (
			<p className="text-sm text-muted-foreground py-8">
				You are not part of an organization. Organizations are created through team plans or by
				your administrator.
			</p>
		);
	}

	if (isLoading) {
		return (
			<div className="flex items-center gap-2 py-8">
				<span className="status-pixel bg-muted-foreground animate-pulse" />
				<p className="text-sm font-mono text-muted-foreground">Loading...</p>
			</div>
		);
	}

	const totalCount = members.length + pendingInvites.length;

	return (
		<div className="space-y-6">
			{/* Org header */}
			<div className="flex items-center gap-3">
				<div className="flex h-10 w-10 items-center justify-center rounded-md border bg-muted">
					<Building2 size={18} strokeWidth={1.5} className="text-muted-foreground" />
				</div>
				<div>
					<h2 className="text-lg font-medium">{user.orgName || 'Organization'}</h2>
					<p className="text-xs text-muted-foreground">
						{members.length} member{members.length !== 1 ? 's' : ''}
						{pendingInvites.length > 0 && ` · ${pendingInvites.length} pending`}
						{isClerkManaged && ' · Synced'}
					</p>
				</div>
			</div>

			{error && (
				<div className="flex items-center gap-2 border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">
					<span className="status-pixel bg-destructive" />
					{error}
				</div>
			)}
			{success && (
				<div className="flex items-center gap-2 border border-success/20 bg-success/5 px-3 py-2 text-sm text-success">
					<span className="status-pixel bg-success" />
					{success}
				</div>
			)}

			{/* Invite form (admin only) */}
			{isAdmin && (
				<Card>
					<CardHeader>
						<CardTitle className="text-lg">Invite Member</CardTitle>
						<CardDescription>Add a team member by their email address</CardDescription>
					</CardHeader>
					<CardContent>
						<form onSubmit={inviteMember} className="flex items-end gap-3">
							<div className="flex-1 space-y-1.5">
								<label
									className="text-xs font-mono uppercase tracking-wider text-muted-foreground"
									htmlFor="invite-email"
								>
									Email
								</label>
								<Input
									id="invite-email"
									type="email"
									required
									value={inviteEmail}
									onChange={(e) => setInviteEmail(e.target.value)}
									placeholder="teammate@company.com"
								/>
							</div>
							<div className="space-y-1.5">
								<label
									className="text-xs font-mono uppercase tracking-wider text-muted-foreground"
									htmlFor="invite-role"
								>
									Role
								</label>
								<Select
									id="invite-role"
									value={inviteRole}
									onChange={(e) => setInviteRole(e.target.value)}
								>
									<option value="member">Member</option>
									<option value="admin">Admin</option>
								</Select>
							</div>
							<Button type="submit" size="sm" className="gap-2" disabled={inviteMutation.isPending}>
								<UserPlus size={14} strokeWidth={1.5} />
								Invite
							</Button>
						</form>
					</CardContent>
				</Card>
			)}

			{/* Members list */}
			<Card>
				<CardHeader>
					<CardTitle className="text-lg">Members</CardTitle>
					<CardDescription>
						{members.length} active member{members.length !== 1 ? 's' : ''}
					</CardDescription>
				</CardHeader>
				<CardContent>
					<div className="divide-y divide-border">
						{members.map((member) => (
							<div key={member.id} className="flex items-center justify-between py-3">
								<div>
									<p className="text-sm font-medium">{member.email}</p>
									<Badge variant="outline" className="mt-1 text-[10px]">
										{member.role}
									</Badge>
								</div>
								{/* Admin controls */}
								{isAdmin && member.userId !== user.id && (
									<div className="flex items-center gap-2">
										<Select
											value={member.role}
											onChange={(e) => changeRole(member.userId, e.target.value)}
											className="w-28 h-8 text-xs"
										>
											<option value="admin">Admin</option>
											<option value="member">Member</option>
										</Select>
										<Button
											variant="ghost"
											size="icon"
											onClick={() => removeMember(member.userId)}
											className="h-8 w-8 text-destructive hover:text-destructive"
											disabled={removeMutation.isPending}
										>
											<Trash2 size={14} strokeWidth={1.5} />
										</Button>
									</div>
								)}
							</div>
						))}
					</div>
				</CardContent>
			</Card>

			{/* Pending invitations */}
			{pendingInvites.length > 0 && (
				<Card>
					<CardHeader>
						<CardTitle className="text-lg">Pending Invitations</CardTitle>
						<CardDescription>
							{pendingInvites.length} invitation{pendingInvites.length !== 1 ? 's' : ''} awaiting acceptance
						</CardDescription>
					</CardHeader>
					<CardContent>
						<div className="divide-y divide-border">
							{pendingInvites.map((invite) => (
								<div key={invite.id} className="flex items-center justify-between py-3">
									<div>
										<p className="text-sm font-medium text-muted-foreground">{invite.email}</p>
										<div className="flex items-center gap-1.5 mt-1">
											<Badge variant="outline" className="text-[10px] border-amber-500/30 text-amber-600">
												<Clock size={8} className="mr-1" />
												pending
											</Badge>
											<Badge variant="outline" className="text-[10px]">
												{invite.role}
											</Badge>
										</div>
									</div>
								</div>
							))}
						</div>
					</CardContent>
				</Card>
			)}
		</div>
	);
}
