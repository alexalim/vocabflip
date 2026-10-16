// POST { username, email } → if both match one account, mails a password reset link
// to the recovery email. Always answers { ok: true } so accounts can't be probed.
import {
  adminClient, corsHeaders, isEmail, isUsername, json, sendMail, siteUrlFor, USERNAME_DOMAIN,
} from "../_shared/common.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) });
  if (req.method !== "POST") return json(req, { error: "method" }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const username = typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
    if (!isUsername(username) || !isEmail(body.email)) return json(req, { error: "invalid_input" }, 400);
    const to = body.email.toLowerCase();

    const admin = adminClient();
    const { data: profile } = await admin.from("profiles").select("id")
      .eq("username", username).eq("recovery_email", to).maybeSingle();

    if (profile) {
      const { data, error } = await admin.auth.admin.generateLink({
        type: "recovery",
        email: `${username}@${USERNAME_DOMAIN}`,
        options: { redirectTo: siteUrlFor(req) },
      });
      if (error) throw error;
      await sendMail(admin, "reset-password", to, "[VocabFlip] 비밀번호 재설정",
        `VocabFlip 아이디 ${username}의 비밀번호를 재설정하려면 아래 링크를 여세요. ` +
        `링크는 1시간 동안 한 번만 쓸 수 있습니다.\n\n${data.properties.action_link}\n\n` +
        `본인이 요청하지 않았다면 이 메일은 무시하셔도 됩니다. 비밀번호는 바뀌지 않습니다.`);
    }
    return json(req, { ok: true });
  } catch (e) {
    console.error("reset-password failed", e);
    return json(req, { ok: true });
  }
});
