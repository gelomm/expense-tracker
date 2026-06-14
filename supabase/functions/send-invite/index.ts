import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase    = createClient(supabaseUrl, supabaseKey);

Deno.serve(async (req) => {
  try {
    const { inviteEmail, inviterName, householdName, token } = await req.json();

    // Send email via Supabase Auth admin (uses your Gmail SMTP)
    const { error } = await supabase.auth.admin.inviteUserByEmail(inviteEmail, {
      redirectTo: `https://gelomm.github.io/expense-tracker/index.html?invite=${token}`,
      data: {
        inviter_name: inviterName,
        household_name: householdName,
      },
    });

    if (error) throw error;

    return new Response(JSON.stringify({ success: true }), {
      headers: { "Content-Type": "application/json" },
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});