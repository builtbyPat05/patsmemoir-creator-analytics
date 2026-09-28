"use client";

import { useActionState } from "react";
import { authenticate, type AuthActionState } from "@/app/login/actions";

const emptyState: AuthActionState = {
  error: null,
  message: null,
};

type AuthFormProps = {
  initialError?: string;
  nextPath: string;
};

export function AuthForm({ initialError, nextPath }: AuthFormProps) {
  const [state, formAction, pending] = useActionState(authenticate, {
    ...emptyState,
    error: initialError ?? null,
  });

  return (
    <form action={formAction} className="auth-form">
      <input name="next" type="hidden" value={nextPath} />

      <label htmlFor="email">Email</label>
      <input
        autoComplete="email"
        id="email"
        name="email"
        placeholder="you@example.com"
        required
        type="email"
      />

      <label htmlFor="password">Password</label>
      <input
        autoComplete="current-password"
        id="password"
        minLength={8}
        name="password"
        required
        type="password"
      />

      <div aria-live="polite" className="auth-status">
        {state.error && <p className="auth-error">{state.error}</p>}
        {state.message && <p className="auth-message">{state.message}</p>}
      </div>

      <div className="auth-actions">
        <button disabled={pending} name="intent" type="submit" value="signin">
          {pending ? "Working..." : "Sign in"}
        </button>
        <button
          className="auth-secondary-button"
          disabled={pending}
          name="intent"
          type="submit"
          value="signup"
        >
          Create account
        </button>
      </div>
    </form>
  );
}
