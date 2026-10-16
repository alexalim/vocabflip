// POST { email } → mails the usernames registered with that recovery email.
// Always answers { ok: true } so the response never reveals whether an email is registered.
import { adminClient, corsHeaders, isEmail, json, sendMail, siteUrlFor } from "../_shared/common.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) });
  if (req.method !== "POST") return json(req, { error: "method" }, 405);

  try {
    const { email } = await req.json().catch(() => ({}));
    if (!isEmail(email)) return json(req, { error: "invalid_email" }, 400);
    const to = email.toLowerCase();

    const admin = adminClient();
    const { data } = await admin.from("profiles").select("username")
      .eq("recovery_email", to).not("username", "is", null);
    const names = (data ?? []).map((r) => r.username as string);

    if (names.length) {
      await sendMail(admin, "find-id", to, "[VocabFlip] 아이디 안내",
        `이 이메일로 가입된 VocabFlip 아이디입니다.\n\n${names.map((n) => "- " + n).join("\n")}\n\n` +
        `로그인: ${siteUrlFor(req)}\n\n본인이 요청하지 않았다면 이 메일은 무시하셔도 됩니다.`);
    }
    return json(req, { ok: true });
  } catch (e) {
    console.error("find-id failed", e);
    return json(req, { ok: true });
  }
});
