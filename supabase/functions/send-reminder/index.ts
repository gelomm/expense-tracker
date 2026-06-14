// Supabase Edge Function: send-reminder
// Schedule this via Supabase Dashboard > Edge Functions > Cron
// Cron expression: "0 8 * * *" (runs daily at 8 AM)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(supabaseUrl, supabaseKey);

Deno.serve(async (_req) => {
  try {
    const now = new Date().toISOString();

    // 1. Flag overdue expenses
    await supabase.rpc("flag_overdue_expenses");

    // 2. Fetch unsent reminders that are due
    const { data: reminders, error: remErr } = await supabase
      .from("reminders")
      .select(`
        *,
        profile:profiles(id, full_name),
        expense:expenses(title, due_date, amount)
      `)
      .lte("remind_at", now)
      .eq("is_sent", false);

    if (remErr) throw remErr;

    let emailsSent = 0;
    let inAppMarked = 0;

    for (const reminder of reminders ?? []) {
      // Mark in-app reminders as sent
      if (reminder.type === "in_app" || reminder.type === "both") {
        await supabase
          .from("reminders")
          .update({ is_sent: true })
          .eq("id", reminder.id);
        inAppMarked++;
      }

      // Send email reminders via Supabase Auth admin
      if (reminder.type === "email" || reminder.type === "both") {
        const { data: userAuth } = await supabase.auth.admin.getUserById(
          reminder.profile_id
        );
        if (userAuth?.user?.email) {
          // In production, integrate Resend/SendGrid here
          // For now, log and mark as sent
          console.log(
            `[REMINDER] Email to ${userAuth.user.email}: ${
              reminder.message ||
              `Reminder: ${reminder.expense?.title} is due soon`
            }`
          );
          await supabase
            .from("reminders")
            .update({ is_sent: true })
            .eq("id", reminder.id);
          emailsSent++;
        }
      }
    }

    // 3. Generate expense instances from active recurring templates
    const today = new Date().toISOString().split("T")[0];
    const { data: recurringList } = await supabase
      .from("recurring_expenses")
      .select("*")
      .eq("is_active", true)
      .lte("next_due_date", today);

    let generated = 0;
    for (const rec of recurringList ?? []) {
      // Create the expense instance
      const { data: newExpense } = await supabase
        .from("expenses")
        .insert({
          household_id: rec.household_id,
          title: rec.title,
          amount: rec.amount,
          category_id: rec.category_id,
          paid_by: rec.paid_by,
          expense_date: rec.next_due_date,
          due_date: rec.next_due_date,
          is_recurring: true,
          recurring_id: rec.id,
          status: "unpaid",
          created_by: rec.created_by,
        })
        .select()
        .single();

      if (newExpense && rec.split_config?.length > 0) {
        const splits = (rec.split_config as any[]).map((s: any) => ({
          expense_id: newExpense.id,
          profile_id: s.profile_id,
          split_type: s.split_type,
          amount: s.amount,
          percentage: s.percentage,
        }));
        await supabase.from("expense_splits").insert(splits);
      }

      // Calculate next due date
      const nextDue = calculateNextDue(rec.next_due_date, rec.frequency);
      const shouldDeactivate =
        rec.end_date && nextDue > rec.end_date;

      await supabase
        .from("recurring_expenses")
        .update({
          next_due_date: nextDue,
          is_active: !shouldDeactivate,
        })
        .eq("id", rec.id);

      generated++;
    }

    return new Response(
      JSON.stringify({
        success: true,
        emailsSent,
        inAppMarked,
        recurringGenerated: generated,
      }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});

function calculateNextDue(currentDate: string, frequency: string): string {
  const d = new Date(currentDate);
  switch (frequency) {
    case "daily":      d.setDate(d.getDate() + 1); break;
    case "weekly":     d.setDate(d.getDate() + 7); break;
    case "biweekly":   d.setDate(d.getDate() + 14); break;
    case "monthly":    d.setMonth(d.getMonth() + 1); break;
    case "bimonthly":  d.setMonth(d.getMonth() + 2); break;
    case "annually":   d.setFullYear(d.getFullYear() + 1); break;
  }
  return d.toISOString().split("T")[0];
}
