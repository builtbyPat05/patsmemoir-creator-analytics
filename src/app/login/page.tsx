import { ArrowLeft, Sparkles } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth/auth-form";
import { getSafeRedirectPath } from "@/lib/auth/redirect";
import { createClient } from "@/lib/supabase/server";

type LoginPageProps = {
  searchParams: Promise<{
    error?: string;
    next?: string;
  }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const nextPath = getSafeRedirectPath(params.next);
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();

  if (data?.claims) {
    redirect(nextPath);
  }

  return (
    <main className="auth-page">
      <section className="auth-shell" aria-labelledby="auth-heading">
        <div className="auth-brand">
          <span className="auth-brand-mark" aria-hidden="true">
            <Sparkles size={19} />
          </span>
          <div>
            <p>PatsMemoir</p>
            <span>Creator dashboard</span>
          </div>
        </div>

        <div className="auth-panel">
          <p className="eyebrow">Creator access</p>
          <h1 id="auth-heading">Sign in to your analytics.</h1>
          <p className="auth-intro">Your connected accounts and imported metrics stay private to your creator profile.</p>
          <AuthForm
            initialError={params.error ? "The confirmation link could not be completed. Please sign in." : undefined}
            nextPath={nextPath}
          />
        </div>

        <Link className="auth-back-link" href="/">
          <ArrowLeft size={16} aria-hidden="true" />
          Back to demo dashboard
        </Link>
      </section>
    </main>
  );
}
