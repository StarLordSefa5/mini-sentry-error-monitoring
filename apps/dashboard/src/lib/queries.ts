import type {
  EventDto,
  IssueDetailResponse,
  IssueDto,
  IssueListResponse,
  IssueStatsResponse,
  IssueStatus,
  ProjectDto,
  StatsRange,
  UserDto,
} from "@mini-sentry/shared";
import {
  keepPreviousData,
  QueryCache,
  QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { api, ApiError } from "./api";

export const queryClient: QueryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error) => {
      // Session expired somewhere: drop the user, and RequireAuth sends them to the login page.
      if (error instanceof ApiError && error.status === 401) {
        queryClient.setQueryData(keys.me, null);
      }
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < 2,
    },
  },
});

export const keys = {
  me: ["me"] as const,
  projects: ["projects"] as const,
  project: (id: string) => ["projects", id] as const,
  issues: (projectId: string) => ["projects", projectId, "issues"] as const,
  issueList: (projectId: string, params: IssueListParams) =>
    [...keys.issues(projectId), "list", params] as const,
  issue: (projectId: string, issueId: string) => [...keys.issues(projectId), issueId] as const,
};

// --- Auth ---

export function useMe() {
  return useQuery({
    queryKey: keys.me,
    queryFn: async () => {
      try {
        return (await api<{ user: UserDto }>("/auth/me")).user;
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    staleTime: Infinity,
  });
}

export function useLogin(mode: "login" | "register") {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: { email: string; password: string; name?: string }) =>
      api<{ user: UserDto }>(`/auth/${mode}`, { method: "POST", body }),
    onSuccess: ({ user }) => client.setQueryData(keys.me, user),
  });
}

export function useLogout() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api<void>("/auth/logout", { method: "POST" }),
    onSuccess: () => {
      client.clear();
      client.setQueryData(keys.me, null);
    },
  });
}

// --- Projects ---

export function useProjects() {
  return useQuery({
    queryKey: keys.projects,
    queryFn: async () => (await api<{ projects: ProjectDto[] }>("/projects")).projects,
  });
}

export function useProject(projectId: string) {
  return useQuery({
    queryKey: keys.project(projectId),
    queryFn: async () => (await api<{ project: ProjectDto }>(`/projects/${projectId}`)).project,
  });
}

export function useCreateProject() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (name: string) =>
      (await api<{ project: ProjectDto }>("/projects", { method: "POST", body: { name } })).project,
    onSuccess: (project) => {
      client.setQueryData(keys.project(project.id), project);
      void client.invalidateQueries({ queryKey: keys.projects, exact: true });
    },
  });
}

export function useRotateKey(projectId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async () =>
      (
        await api<{ project: ProjectDto }>(`/projects/${projectId}/api-key/rotate`, {
          method: "POST",
        })
      ).project,
    onSuccess: (project) => {
      client.setQueryData(keys.project(projectId), project);
      void client.invalidateQueries({ queryKey: keys.projects, exact: true });
    },
  });
}

// --- Issues ---

export interface IssueListParams {
  status: IssueStatus | "all";
  q: string;
  sort: "lastSeen" | "firstSeen" | "count";
  page: number;
}

export function useIssues(projectId: string, params: IssueListParams) {
  return useQuery({
    queryKey: keys.issueList(projectId, params),
    queryFn: () => {
      const search = new URLSearchParams({
        status: params.status,
        sort: params.sort,
        page: String(params.page),
        ...(params.q ? { q: params.q } : {}),
      });
      return api<IssueListResponse>(`/projects/${projectId}/issues?${search}`);
    },
    // Keep the old page on screen while the next one loads, so the table does not flash.
    placeholderData: keepPreviousData,
    refetchInterval: 30_000,
  });
}

export function useIssue(projectId: string, issueId: string) {
  return useQuery({
    queryKey: keys.issue(projectId, issueId),
    queryFn: () => api<IssueDetailResponse>(`/projects/${projectId}/issues/${issueId}`),
    refetchInterval: 30_000,
  });
}

export function useIssueEvents(projectId: string, issueId: string) {
  return useQuery({
    queryKey: [...keys.issue(projectId, issueId), "events"],
    queryFn: async () =>
      (await api<{ events: EventDto[] }>(`/projects/${projectId}/issues/${issueId}/events`)).events,
  });
}

export function useIssueStats(projectId: string, issueId: string, range: StatsRange) {
  return useQuery({
    queryKey: [...keys.issue(projectId, issueId), "stats", range],
    queryFn: () =>
      api<IssueStatsResponse>(`/projects/${projectId}/issues/${issueId}/stats?range=${range}`),
    placeholderData: keepPreviousData,
  });
}

export function useUpdateIssueStatus(projectId: string, issueId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (status: IssueStatus) =>
      (
        await api<{ issue: IssueDto }>(`/projects/${projectId}/issues/${issueId}`, {
          method: "PATCH",
          body: { status },
        })
      ).issue,
    onSuccess: (issue) => {
      client.setQueryData<IssueDetailResponse>(keys.issue(projectId, issueId), (old) =>
        old ? { ...old, issue } : old,
      );
      void client.invalidateQueries({ queryKey: keys.issues(projectId) });
    },
  });
}

export function useUpdateProject(projectId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (body: { name?: string; alertWebhookUrl?: string | null }) =>
      (await api<{ project: ProjectDto }>(`/projects/${projectId}`, { method: "PATCH", body }))
        .project,
    onSuccess: (project) => {
      client.setQueryData(keys.project(projectId), project);
      void client.invalidateQueries({ queryKey: keys.projects, exact: true });
    },
  });
}

export function useTestAlert(projectId: string) {
  return useMutation({
    mutationFn: () => api<void>(`/projects/${projectId}/alerts/test`, { method: "POST" }),
  });
}
