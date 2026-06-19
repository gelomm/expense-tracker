// Supabase Edge Function: send-reminder
// Triggered daily via cron: "0 8 * * *"
// Sends emails via Gmail SMTP + handles recurring expense auto-generation.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

const supabaseUrl  = Deno.env.get("SUPABASE_URL")!;
const supabaseKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const gmailUser    = Deno.env.get("GMAIL_USER")!;    // your Gmail address
const gmailPass    = Deno.env.get("GMAIL_APP_PASS")!; // your 16-char App Password
const appUrl       = "https://gelomm.github.io/expense-tracker";

const supabase = createClient(supabaseUrl, supabaseKey);

const smtpClient = new SMTPClient({
  connection: {
    hostname: "smtp.gmail.com",
    port: 465,
    tls: true,
    auth: {
      username: gmailUser,
      password: gmailPass,
    },
  },
});

async function sendGmail(to: string, toName: string, subject: string, html: string): Promise<boolean> {
  try {
    await smtpClient.send({
      from:    `WeXpense Reminders <${gmailUser}>`,
      to,
      subject,
      content: "Please view this email in an HTML-compatible client.",
      html,
    });
    return true;
  } catch (err) {
    console.error(`[GMAIL] Failed to send to ${to}:`, err);
    return false;
  }
}

// ── Email HTML builder ───────────────────────────────────────
function buildEmailHtml(
  recipientName: string,
  expenseTitle:  string,
  customMessage: string,
  dueDate:       string | null,
  amountFormatted: string | null,
  otherMembers:  string[],
): string {
  const splitInfo = otherMembers.length > 0
    ? `<div style="margin-bottom:8px;font-size:14px;color:#6B7280;">
        👥 <strong>Also involved:</strong> ${otherMembers.join(", ")}
       </div>`
    : "";

  const detailsBlock = dueDate || amountFormatted || splitInfo
    ? `<div style="background:#F0FDFA;border:1px solid #CCFBF1;border-radius:8px;padding:16px 20px;margin-bottom:24px;">
        ${dueDate          ? `<div style="margin-bottom:8px;font-size:14px;color:#6B7280;">📅 <strong>Due date:</strong> ${dueDate}</div>` : ""}
        ${amountFormatted  ? `<div style="margin-bottom:8px;font-size:14px;color:#6B7280;">💵 <strong>Amount:</strong> ${amountFormatted}</div>` : ""}
        ${splitInfo}
       </div>`
    : "";

  return `
    <!DOCTYPE html>
    <html>
    <head><meta charset="UTF-8" /></head>
    <body style="margin:0;padding:0;background:#F9FAFB;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
      <div style="max-width:480px;margin:40px auto;background:#FFFFFF;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.08);">

        <!-- Header -->
        <div style="background:#0F766E;padding:24px 32px;">
          <h1 style="margin:0;color:#FFFFFF;font-size:20px;font-weight:700;">💰 WeXpense</h1>
          <p style="margin:4px 0 0;color:#99F6E4;font-size:13px;">Household Expense Tracker</p>
        </div>

        <!-- Body -->
        <div style="padding:32px;">
          <p style="margin:0 0 16px;color:#111827;font-size:15px;">
            Hi <strong>${recipientName}</strong>,
          </p>
          <p style="margin:0 0 24px;color:#374151;font-size:15px;line-height:1.6;">
            ${customMessage}
          </p>
          ${detailsBlock}
          <a href="${appUrl}/expenses.html"
             style="display:inline-block;background:#0F766E;color:#FFFFFF;text-decoration:none;
                    padding:12px 24px;border-radius:8px;font-size:14px;font-weight:600;">
            View in WeXpense →
          </a>
        </div>

        <!-- Footer -->
        <div style="padding:16px 32px;border-top:1px solid #E5E7EB;">
          <p style="margin:0;color:#9CA3AF;font-size:12px;">
            You received this because you are involved in a shared expense in WeXpense.
          </p>
        </div>

      </div>
    </body>
    </html>
  `;
}

// ── Main handler ─────────────────────────────────────────────
Deno.serve(async (_req) => {
  try {
    const now = new Date().toISOString();

    // ── 1. Flag overdue expenses ─────────────────────────────
    await supabase.rpc("flag_overdue_expenses");

    // ── 2. Fetch unsent reminders that are due ───────────────
    const { data: reminders, error: remErr } = await supabase
      .from("reminders")
      .select(`
        *,
        profile:profiles(id, full_name),
        expense:expenses(
          id, title, due_date, amount,
          splits:expense_splits(
            profile_id,
            profile:profiles(id, full_name)
          )
        ),
        recurring:recurring_expenses(
          id, title, amount, split_config
        )
      `)
      .lte("remind_at", now)
      .eq("is_sent", false);

    if (remErr) throw remErr;

    let emailsSent   = 0;
    let emailsFailed = 0;
    let inAppMarked  = 0;

    for (const reminder of reminders ?? []) {

      // ── In-app: mark as sent ──────────────────────────────
      if (reminder.type === "in_app" || reminder.type === "both") {
        await supabase
          .from("reminders")
          .update({ is_sent: true })
          .eq("id", reminder.id);
        inAppMarked++;
      }

      // ── Email: send to reminder owner + all split members ──
      if (reminder.type === "email" || reminder.type === "both") {

        if (!gmailUser || !gmailPass) {
          console.error("[REMINDER] GMAIL_USER or GMAIL_APP_PASS secrets not set — skipping");
          continue;
        }

        // ── Build recipient list ──────────────────────────────
        const recipientProfileIds = new Set<string>([reminder.profile_id]);

        // Add expense split members
        if (reminder.expense?.splits?.length > 0) {
          for (const split of reminder.expense.splits) {
            if (split.profile_id) recipientProfileIds.add(split.profile_id);
          }
        }

        // Add recurring split_config members
        if (reminder.recurring?.split_config?.length > 0) {
          for (const sc of reminder.recurring.split_config) {
            if (sc.profile_id) recipientProfileIds.add(sc.profile_id);
          }
        }

        // ── Fetch email + name for each recipient ─────────────
        const recipientList: { email: string; name: string }[] = [];

        for (const profileId of recipientProfileIds) {
          const { data: userAuth } = await supabase.auth.admin.getUserById(profileId);
          if (!userAuth?.user?.email) continue;

          const { data: profile } = await supabase
            .from("profiles")
            .select("full_name")
            .eq("id", profileId)
            .single();

          recipientList.push({
            email: userAuth.user.email,
            name:  profile?.full_name ?? userAuth.user.email.split("@")[0],
          });
        }

        if (recipientList.length === 0) {
          console.warn(`[REMINDER] No valid emails found for reminder ${reminder.id} — skipping`);
          continue;
        }

        // ── Shared email content ──────────────────────────────
        const expenseTitle    = reminder.expense?.title ?? reminder.recurring?.title ?? "an expense";
        const customMessage   = reminder.message
          || `This is a reminder about <strong>${expenseTitle}</strong>.`;

        const dueDate = reminder.expense?.due_date
          ? new Date(reminder.expense.due_date).toLocaleDateString("en-PH", {
              year: "numeric", month: "long", day: "numeric",
            })
          : null;

        const amount = reminder.expense?.amount ?? reminder.recurring?.amount;
        const amountFormatted = amount != null
          ? new Intl.NumberFormat("fil-PH", { style: "currency", currency: "PHP" }).format(amount)
          : null;

        const allNames = recipientList.map(r => r.name);
        let allSucceeded = true;

        // ── Send personalized email to each recipient ─────────
        for (const recipient of recipientList) {
          const otherMembers = allNames.filter(n => n !== recipient.name);

          const html = buildEmailHtml(
            recipient.name,
            expenseTitle,
            customMessage,
            dueDate,
            amountFormatted,
            otherMembers,
          );

          const sent = await sendGmail(
            recipient.email,
            recipient.name,
            `🔔 Reminder: ${expenseTitle}`,
            html,
          );

          if (sent) {
            console.log(`[REMINDER] ✅ Sent to ${recipient.email} (${recipient.name})`);
            emailsSent++;
          } else {
            console.error(`[REMINDER] ❌ Failed for ${recipient.email}`);
            emailsFailed++;
            allSucceeded = false;
          }
        }

        // Only mark reminder as sent if ALL emails succeeded
        if (allSucceeded) {
          await supabase
            .from("reminders")
            .update({ is_sent: true })
            .eq("id", reminder.id);
        }
      }
    }

    // ── 3. Auto-generate recurring expense instances ─────────
    const today = new Date().toISOString().split("T")[0];
    const { data: recurringList } = await supabase
      .from("recurring_expenses")
      .select("*")
      .eq("is_active", true)
      .lte("next_due_date", today);

    let generated = 0;
    for (const rec of recurringList ?? []) {

      const { data: newExpense } = await supabase
        .from("expenses")
        .insert({
          household_id: rec.household_id,
          title:        rec.title,
          amount:       rec.amount,
          category_id:  rec.category_id,
          paid_by:      rec.paid_by,
          expense_date: rec.next_due_date,
          due_date:     rec.next_due_date,
          is_recurring: true,
          recurring_id: rec.id,
          status:       "unpaid",
          created_by:   rec.created_by,
        })
        .select()
        .single();

      if (newExpense && Array.isArray(rec.split_config) && rec.split_config.length > 0) {
        const splits = rec.split_config.map((s: any) => ({
          expense_id: newExpense.id,
          profile_id: s.profile_id,
          split_type: s.split_type,
          amount:     s.amount,
          percentage: s.percentage ?? null,
          is_settled: false,
        }));
        await supabase.from("expense_splits").insert(splits);
      }

      const nextDue          = calculateNextDue(rec.next_due_date, rec.frequency);
      const shouldDeactivate = rec.end_date && nextDue > rec.end_date;

      await supabase
        .from("recurring_expenses")
        .update({ next_due_date: nextDue, is_active: !shouldDeactivate })
        .eq("id", rec.id);

      generated++;
    }

    return new Response(
      JSON.stringify({
        success:            true,
        emailsSent,
        emailsFailed,
        inAppMarked,
        recurringGenerated: generated,
      }),
      { headers: { "Content-Type": "application/json" } }
    );

  } catch (err) {
    console.error("[REMINDER] Fatal error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});

// ── Next due date calculator ─────────────────────────────────
function calculateNextDue(currentDate: string, frequency: string): string {
  const d = new Date(currentDate);
  switch (frequency) {
    case "daily":     d.setDate(d.getDate() + 1);         break;
    case "weekly":    d.setDate(d.getDate() + 7);         break;
    case "biweekly":  d.setDate(d.getDate() + 14);        break;
    case "monthly":   d.setMonth(d.getMonth() + 1);       break;
    case "bimonthly": d.setMonth(d.getMonth() + 2);       break;
    case "annually":  d.setFullYear(d.getFullYear() + 1); break;
  }
  return d.toISOString().split("T")[0];
}