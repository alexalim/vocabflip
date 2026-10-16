// POST (signed in) → deletes the caller's account. Profile and progress rows
// go with it via ON DELETE CASCADE.
import { adminClient, corsHeaders, json } from "../_shared/common.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) });
  if (req.method !== "POST") return json(req, { error: "method" }, 405);

  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const admin = adminClient();
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return json(req, { error: "unauthorized" }, 401);

  const { error: delError } = await admin.auth.admin.deleteUser(data.user.id);
  if (delError) {
    console.error("delete-account failed", delError);
    return json(req, { error: "delete_failed" }, 500);
  }
  return json(req, { ok: true });
});
