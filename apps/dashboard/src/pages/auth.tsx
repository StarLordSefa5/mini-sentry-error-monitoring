import { useState, type FormEvent } from "react";
import { BugIcon } from "lucide-react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api";
import { useLogin, useMe } from "@/lib/queries";

const ERRORS: Record<string, string> = {
  invalid_credentials: "Email or password is incorrect.",
  email_taken: "An account with this email already exists.",
  validation_error: "Check the fields: a valid email and a password of at least 8 characters.",
};

export function AuthPage({ mode }: { mode: "login" | "register" }) {
  const isLogin = mode === "login";
  const { data: user } = useMe();
  const login = useLogin(mode);
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [form, setForm] = useState({ name: "", email: "", password: "" });

  // Only follow same-site paths, so ?next= cannot send people to another site.
  const rawNext = params.get("next") ?? "";
  const next = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/projects";

  if (user) return <Navigate to={next} replace />;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    login.mutate(
      { email: form.email, password: form.password, ...(form.name ? { name: form.name } : {}) },
      { onSuccess: () => navigate(next, { replace: true }) },
    );
  };

  const error =
    login.error instanceof ApiError
      ? (ERRORS[login.error.code] ?? "Something went wrong. Try again.")
      : login.error
        ? "Cannot reach the server."
        : null;

  return (
    <main className="flex min-h-svh items-center justify-center bg-muted/40 p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex items-center justify-center gap-2 text-lg font-semibold">
          <BugIcon className="size-5" /> Mini Sentry
        </div>
        <Card>
          <CardHeader>
            <CardTitle>{isLogin ? "Log in" : "Create an account"}</CardTitle>
            <CardDescription>
              {isLogin ? "See what broke in production." : "Start catching errors in minutes."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="space-y-4">
              {!isLogin && (
                <div className="space-y-2">
                  <Label htmlFor="name">Name</Label>
                  <Input
                    id="name"
                    autoComplete="name"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                  />
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete={isLogin ? "current-password" : "new-password"}
                  minLength={isLogin ? undefined : 8}
                  required
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                />
              </div>
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
              <Button type="submit" className="w-full" disabled={login.isPending}>
                {login.isPending ? "Please wait…" : isLogin ? "Log in" : "Create account"}
              </Button>
            </form>
          </CardContent>
        </Card>
        <p className="text-center text-sm text-muted-foreground">
          {isLogin ? "No account yet? " : "Already have an account? "}
          <Link
            to={`${isLogin ? "/register" : "/login"}${rawNext ? `?next=${encodeURIComponent(rawNext)}` : ""}`}
            className="font-medium text-foreground underline-offset-4 hover:underline"
          >
            {isLogin ? "Create one" : "Log in"}
          </Link>
        </p>
      </div>
    </main>
  );
}
