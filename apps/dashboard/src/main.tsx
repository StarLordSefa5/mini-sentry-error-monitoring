import { StrictMode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, Navigate } from "react-router";
import { RouterProvider } from "react-router/dom";
import { AppShell } from "@/components/app-shell";
import { RequireAuth } from "@/components/require-auth";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { queryClient } from "@/lib/queries";
import { AuthPage } from "@/pages/auth";
import { IssuesPage } from "@/pages/issues";
import { NotFoundPage } from "@/pages/not-found";
import { ProjectsPage } from "@/pages/projects";
import { SettingsPage } from "@/pages/settings";
import "./index.css";

// Follow the OS light/dark setting.
const dark = window.matchMedia("(prefers-color-scheme: dark)");
const applyTheme = () => document.documentElement.classList.toggle("dark", dark.matches);
applyTheme();
dark.addEventListener("change", applyTheme);

const router = createBrowserRouter([
  { path: "/login", element: <AuthPage mode="login" /> },
  { path: "/register", element: <AuthPage mode="register" /> },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <AppShell />,
        children: [
          { index: true, element: <Navigate to="/projects" replace /> },
          { path: "projects", element: <ProjectsPage /> },
          { path: "projects/:projectId", element: <Navigate to="issues" replace /> },
          { path: "projects/:projectId/issues", element: <IssuesPage /> },
          {
            path: "projects/:projectId/issues/:issueId",
            // Loaded on demand: the chart library is most of the bundle.
            lazy: async () => ({
              Component: (await import("@/pages/issue-detail")).IssueDetailPage,
            }),
          },
          { path: "projects/:projectId/settings", element: <SettingsPage /> },
          { path: "*", element: <NotFoundPage /> },
        ],
      },
    ],
  },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <RouterProvider router={router} />
        <Toaster position="bottom-right" />
      </TooltipProvider>
    </QueryClientProvider>
  </StrictMode>,
);
