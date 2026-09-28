import { NextResponse } from "next/server";
import { getSupabaseConfig, isSupabaseConfigured } from "@/lib/supabase/config";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      {
        connected: false,
        status: "not_configured",
        message: "Add the Supabase project URL and publishable key to .env.local, then restart Next.js.",
      },
      { status: 503 },
    );
  }

  const { url, publishableKey } = getSupabaseConfig();
  const startedAt = Date.now();

  try {
    const response = await fetch(`${url}/auth/v1/health`, {
      headers: { apikey: publishableKey },
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });

    if (!response.ok) {
      return NextResponse.json(
        {
          connected: false,
          status: "unavailable",
          message: "Supabase rejected the connection. Check the project URL and publishable key.",
        },
        { status: 502 },
      );
    }

    const health = (await response.json()) as { name?: string; version?: string };

    return NextResponse.json({
      connected: true,
      status: "ok",
      latencyMs: Date.now() - startedAt,
      service: health.name ?? "Supabase Auth",
      version: health.version ?? null,
    });
  } catch {
    return NextResponse.json(
      {
        connected: false,
        status: "unreachable",
        message: "Supabase could not be reached before the connection timed out.",
      },
      { status: 502 },
    );
  }
}
