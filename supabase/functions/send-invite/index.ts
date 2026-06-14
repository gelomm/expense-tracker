// ============================================================
// GASTOS — Send Invite Edge Function
// ============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase    = createClient(supabaseUrl, supabaseKey);

// ── CORS headers — allow your GitHub Pages domain ──
const CORS_HEADERS = {
  "Access-Control-Allow-Origin":  "https://gelomm.github.io",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

Deno.serve(async (req) => {
  // Handle preflight OPTIONS request first
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  try {
    const { inviteEmail, inviterName, householdName, token } = await req.json();

    if (!inviteEmail || !token) {
      return new Response(
        JSON.stringify({ error: "inviteEmail and token are required" }),
        { status: 400, headers: { "Content-Type": "application/json", ...CORS_HEADERS } }
      );
    }

    const inviteLink = `https://gelomm.github.io/expense-tracker/index.html?invite=${token}`;

    // Send invite email via Supabase Auth Admin
    const { error } = await supabase.auth.admin.inviteUserByEmail(inviteEmail, {
      redirectTo: inviteLink,
      data: {
        inviter_name:   inviterName,
        household_name: householdName,
      },
    });

    if (error) {
      console.error("Invite error:", error.message);
      throw new Error(error.message);
    }

    return new Response(
      JSON.stringify({ success: true, inviteLink }),
      {
        status: 200,
        headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      }
    );

  } catch (err) {
    console.error("send-invite error:", err);
    return new Response(
      JSON.stringify({ error: String(err) }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      }
    );
  }
});