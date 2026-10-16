// Shared helpers for VocabFlip Edge Functions.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.117.2";
import nodemailer from "npm:nodemailer@6.9.16";

export const USERNAME_DOMAIN = "users.vocabflip.invalid";
const MAILS_PER_HOUR = 3;

// The site that may call these functions and receive recovery redirects.
const SITE_URLS = (Deno.env.get("SITE_URLS") ?? "https://alexalim.github.io/vocabflip/")
  .split(",").map((s) => s.trim()).filter(Boolean);

export function corsHeaders(req: Request): HeadersInit {
  const origin = req.headers.get("origin") ?? "";
  const allowed = SITE_URLS.some((u) => new URL(u).origin === origin);
  return {
    "Access-Control-Allow-Origin": allowed ? origin : new URL(SITE_URLS[0]).origin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

export function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json" },
  });
}

export function adminClient(): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Pick the allowed site URL that matches the caller, for links in mails. */
export function siteUrlFor(req: Request): string {
  const origin = req.headers.get("origin") ?? "";
  return SITE_URLS.find((u) => new URL(u).origin === origin) ?? SITE_URLS[0];
}

/** Returns false (and sends nothing) when the recipient hit the hourly cap. */
export async function sendMail(
  admin: SupabaseClient,
  kind: string,
  to: string,
  subject: string,
  text: string,
): Promise<boolean> {
  const since = new Date(Date.now() - 3600_000).toISOString();
  const { count } = await admin.from("mail_log").select("id", { count: "exact", head: true })
    .eq("recipient", to).gte("sent_at", since);
  if ((count ?? 0) >= MAILS_PER_HOUR) return false;

  const port = Number(Deno.env.get("SMTP_PORT") ?? "465");
  const transport = nodemailer.createTransport({
    host: Deno.env.get("SMTP_HOST") ?? "smtp.gmail.com",
    port,
    secure: port === 465,
    auth: Deno.env.get("SMTP_USER") ? { user: Deno.env.get("SMTP_USER"), pass: Deno.env.get("SMTP_PASS") } : undefined,
  });
  await transport.sendMail({
    from: Deno.env.get("SMTP_FROM") ?? `VocabFlip <${Deno.env.get("SMTP_USER")}>`,
    to,
    subject,
    text,
  });
  await admin.from("mail_log").insert({ recipient: to, kind });
  // 개인정보 처리방침: 발송 기록은 최대 30일 보관
  await admin.from("mail_log").delete().lt("sent_at", new Date(Date.now() - 30 * 86400_000).toISOString());
  return true;
}

export const isEmail = (s: unknown): s is string =>
  typeof s === "string" && s.length <= 254 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s);
export const isUsername = (s: unknown): s is string =>
  typeof s === "string" && /^[a-z0-9_]{4,20}$/.test(s);
