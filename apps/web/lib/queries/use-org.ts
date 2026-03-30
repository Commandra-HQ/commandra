import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export interface OrgMember {
	id: string;
	userId: string;
	role: string;
	email: string;
	createdAt: string;
}

export interface PendingInvite {
	id: string;
	email: string;
	role: string;
	status: string;
	createdAt: number;
}

export function useOrgMembersQuery(orgId: string | null | undefined) {
	return useQuery({
		queryKey: ['orgMembers', orgId],
		queryFn: async () => {
			const res = await apiFetch(`/api/orgs/${orgId}/members`);
			if (!res.ok) throw new Error('Failed to fetch members');
			return res.json() as Promise<{
				members: OrgMember[];
				pendingInvites: PendingInvite[];
				total: number;
			}>;
		},
		enabled: !!orgId,
	});
}

export function useInviteMemberMutation() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async ({ orgId, email, role }: { orgId: string; email: string; role?: string }) => {
			const res = await apiFetch(`/api/orgs/${orgId}/members`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ email, role }),
			});
			if (!res.ok) {
				const err = await res.json();
				throw new Error(err.error || 'Failed to invite member');
			}
		},
		onSuccess: (_data, vars) => {
			queryClient.invalidateQueries({ queryKey: ['orgMembers', vars.orgId] });
		},
	});
}

export function useUpdateMemberRoleMutation() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async ({ orgId, userId, role }: { orgId: string; userId: string; role: string }) => {
			const res = await apiFetch(`/api/orgs/${orgId}/members/${userId}`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ role }),
			});
			if (!res.ok) throw new Error('Failed to update role');
		},
		onSuccess: (_data, vars) => {
			queryClient.invalidateQueries({ queryKey: ['orgMembers', vars.orgId] });
		},
	});
}

export function useRemoveMemberMutation() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async ({ orgId, userId }: { orgId: string; userId: string }) => {
			const res = await apiFetch(`/api/orgs/${orgId}/members/${userId}`, {
				method: 'DELETE',
			});
			if (!res.ok) throw new Error('Failed to remove member');
		},
		onSuccess: (_data, vars) => {
			queryClient.invalidateQueries({ queryKey: ['orgMembers', vars.orgId] });
		},
	});
}
