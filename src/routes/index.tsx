import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { GraduationCap, Loader2, LockKeyhole, Mail, ShieldCheck } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";

export const Route = createFileRoute("/")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Sign in | SEED-IT Admin Portal" },
      {
        name: "description",
        content: "Secure sign in for SEED-IT platform administrators and college staff.",
      },
      { property: "og:title", content: "Sign in | SEED-IT Admin Portal" },
      {
        property: "og:description",
        content: "Secure sign in for SEED-IT platform administrators and college staff.",
      },
    ],
  }),
  component: LoginPage,
});

const HIGHLIGHTS = [
  { title: "Tenant & cohort control", body: "Provision colleges, academic years and department groups." },
  { title: "Roster automation", body: "Bulk-provision students from an Excel roster in one pass." },
  { title: "Proctored assessments", body: "Author MCQ, coding and spoken-English modules with live violation logs." },
];

function LoginPage() {
  const { signIn, isAuthenticated, loading, error } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (isAuthenticated) void navigate({ to: "/dashboard", replace: true });
  }, [isAuthenticated, navigate]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      await signIn(email, password);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Sign in failed.");
    } finally {
      setSubmitting(false);
    }
  }

  const busy = submitting || (loading && !formError);

  return (
    <main className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <section className="brand-gradient relative hidden flex-col justify-between overflow-hidden p-12 lg:flex">
        <div className="absolute -right-24 -top-24 size-96 rounded-full bg-primary-foreground/10 blur-3xl" />
        <div className="absolute -bottom-32 -left-16 size-96 rounded-full bg-primary-foreground/10 blur-3xl" />
        <div className="relative flex items-center gap-3 text-primary-foreground">
          <span className="flex size-11 items-center justify-center rounded-2xl bg-primary-foreground/15 backdrop-blur">
            <GraduationCap className="size-6" />
          </span>
          <div>
            <p className="font-display text-lg font-bold leading-tight">SEED-IT</p>
            <p className="text-xs uppercase tracking-[0.22em] opacity-80">Admin Platform</p>
          </div>
        </div>

        <div className="relative max-w-lg text-primary-foreground">
          <h1 className="font-display text-4xl font-extrabold leading-tight">
            One control room for every campus assessment.
          </h1>
          <p className="mt-4 text-sm leading-relaxed opacity-85">
            Manage institutional tenants, student licences, proctored exams and performance analytics
            from a single serverless portal.
          </p>
          <ul className="mt-10 space-y-4">
            {HIGHLIGHTS.map((item) => (
              <li key={item.title} className="flex gap-3">
                <ShieldCheck className="mt-0.5 size-5 shrink-0 opacity-90" />
                <div>
                  <p className="text-sm font-semibold">{item.title}</p>
                  <p className="text-xs opacity-75">{item.body}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-xs text-primary-foreground/70">
          Protected by Firebase Authentication &amp; Firestore security rules.
        </p>
      </section>

      <section className="flex items-center justify-center px-6 py-16">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <span className="brand-gradient flex size-10 items-center justify-center rounded-2xl text-primary-foreground">
              <GraduationCap className="size-5" />
            </span>
            <p className="font-display text-lg font-bold">SEED-IT Admin</p>
          </div>

          <h2 className="font-display text-2xl font-bold">Sign in to your workspace</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Admin, superadmin and staff accounts only.
          </p>

          <form onSubmit={handleSubmit} className="mt-8 space-y-5">
            <div className="space-y-2">
              <Label htmlFor="email">Work email</Label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="email"
                  type="email"
                  required
                  autoComplete="email"
                  placeholder="admin@college.edu"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="h-11 rounded-xl pl-9"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <LockKeyhole className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="password"
                  type="password"
                  required
                  autoComplete="current-password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-11 rounded-xl pl-9"
                />
              </div>
            </div>

            {(formError ?? error) ? (
              <Alert variant="destructive" className="rounded-xl">
                <AlertDescription>{formError ?? error}</AlertDescription>
              </Alert>
            ) : null}

            <Button type="submit" disabled={busy} className="h-11 w-full rounded-xl text-sm font-semibold">
              {busy ? <Loader2 className="size-4 animate-spin" /> : null}
              {busy ? "Signing in…" : "Sign in"}
            </Button>
          </form>

          <p className="mt-6 text-xs leading-relaxed text-muted-foreground">
            Access is granted by your platform administrator. If your credentials work but you cannot
            enter, your Firestore profile is missing an <span className="font-mono">admin</span> or{" "}
            <span className="font-mono">staff</span> role.
          </p>
        </div>
      </section>
    </main>
  );
}
