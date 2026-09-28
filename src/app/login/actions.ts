"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSafeRedirectPath } from "@/lib/auth/redirect";
import { getSiteUrl } from "@/lib/site-url";
import { createClient } from "@/lib/supabase/server";

export type AuthActionState = {
  error: string | null;
  message: string | null;
};

export async function authenticate(
  _previousState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const intent = formData.get("intent") === "signup" ? "signup" : "signin";
  const nextPath = getSafeRedirectPath(String(formData.get("next") ?? "/"));

  if (!email || !email.includes("@")) {
    return { error: "Enter a valid email address.", message: null };
  }

  if (password.length < 8) {
    return { error: "Your password must be at least 8 characters.", message: null };
  }

  const supabase = await createClient();

  if (intent === "signup") {
    const siteUrl = getSiteUrl();
    const callbackUrl = new URL("/auth/callback", siteUrl);
    callbackUrl.searchParams.set("next", nextPath);

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { display_name: "Patrick Taylor" },
        emailRedirectTo: callbackUrl.toString(),
      },
    });

    if (error) {
      return { error: getFriendlyAuthError(error.message), message: null };
    }

    if (!data.session) {
      return {
        error: null,
        message: "Check your email to confirm your account, then return here to sign in.",
      };
    }
  } else {
    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      return { error: getFriendlyAuthError(error.message), message: null };
    }
  }

  revalidatePath("/", "layout");
  redirect(nextPath);
}

function getFriendlyAuthError(message: string) {
  if (message.toLowerCase().includes("invalid login credentials")) {
    return "The email or password is incorrect.";
  }

  if (message.toLowerCase().includes("already registered")) {
    return "An account already exists for this email. Sign in instead.";
  }

  return "Authentication could not be completed. Please try again.";
}
