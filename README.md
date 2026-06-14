# 💸 Gastos — Monthly Expense Tracker

A modern, fully-featured household expense tracker built with **Vanilla HTML/CSS/JS** + **Supabase**. Deployable on **GitHub Pages** for free.

---

## 🚀 Quick Start (5 Steps)

### Step 1 — Create a Supabase Project

1. Go to [supabase.com](https://supabase.com) and sign up (free)
2. Click **New Project**
3. Choose a name (e.g. `gastos`), set a database password, pick a region closest to the Philippines (Southeast Asia)
4. Wait ~2 minutes for the project to provision

### Step 2 — Run the Database Schema

1. In your Supabase dashboard, go to **SQL Editor**
2. Click **New Query**
3. Open the file `supabase/schema.sql` from this project
4. Paste the entire content and click **Run**
5. You should see `Success. No rows returned`

### Step 3 — Configure the App

1. In Supabase dashboard → **Settings → API**
2. Copy your **Project URL** and **anon public** key
3. Open `assets/js/supabase.js` in this project
4. Replace the placeholder values:

```js
const SUPABASE_URL     = 'https://YOUR_PROJECT_ID.supabase.co';
const SUPABASE_ANON_KEY = 'YOUR_ANON_KEY_HERE';
```

### Step 4 — Configure Supabase Auth

1. In Supabase dashboard → **Authentication → Settings**
2. Set **Site URL** to your GitHub Pages URL (e.g. `https://yourusername.github.io/gastos`)
3. Add your Pages URL to **Redirect URLs** as well
4. Under **Email**, make sure **Enable email confirmations** is ON (recommended)

### Step 5 — Deploy to GitHub Pages

```bash
# 1. Create a new GitHub repository named "gastos"
# 2. Push this project:
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/gastos.git
git push -u origin main

# 3. In GitHub repo → Settings → Pages
#    Source: Deploy from branch → main → / (root)
#    Click Save

# Your app will be live at: https://YOUR_USERNAME.github.io/gastos
```

---

## 📁 Project Structure

```
gastos/
├── index.html              # Login & Register
├── dashboard.html          # Main dashboard with charts
├── expenses.html           # Expense list & management
├── recurring.html          # Recurring/planned expenses
├── splits.html             # Household split settlements
├── reminders.html          # In-app & email reminders
├── settings.html           # All app configuration
│
├── assets/
│   ├── css/
│   │   └── main.css        # Full design system (light/dark)
│   └── js/
│       ├── supabase.js     # ⚠️  CONFIGURE THIS FIRST
│       ├── auth.js         # Login, register, invite flow
│       ├── dashboard.js    # Charts, KPIs, quick-add
│       ├── expenses.js     # CRUD, splits, tags
│       └── utils.js        # Shared helpers, toast, nav
│
└── supabase/
    ├── schema.sql                      # Full DB schema — run this first
    └── functions/send-reminder/
        └── index.ts                    # Edge Function for reminders & recurring
```

---

## ✨ Features

### Dashboard
- 4 KPI stat cards (spent, overdue, upcoming, recurring total)
- Doughnut chart — spending by category
- Budget vs. actual progress bars per category
- Upcoming due expenses (next 7 days)
- Who owes who summary
- Recurring expense overview
- Monthly filter (any past/future month)

### Expenses
- Full CRUD with rich add/edit modal
- Tag expenses (default + custom tags)
- Split with household members: Equal, By %, or Fixed ₱
- Mark as paid / archive (soft delete)
- Filter by category, status, search text, sort order
- CSV export
- Auto-overdue status flagging

### Recurring Expenses
- Daily / Weekly / Bi-weekly / Monthly / Bi-monthly / Annual
- Start date, end date, auto-stop when end date reached
- Pause / Resume any recurring plan
- "Generate Now" button to manually trigger an instance
- Auto-generation via Supabase Edge Function (daily cron)
- Estimated monthly cost calculator across all frequencies

### Splits & Settlements
- Per-member balance view (who owes who)
- Settle individual expenses or settle all at once
- Settlement history log
- Net balance summary across the household

### Reminders
- In-app notification feed (unread/read, tabs by type)
- Email reminders (triggered via Edge Function)
- Quick reminder widget — attach to any expense
- Full reminder modal — link to expense or recurring
- Mark all as read
- Upcoming due sidebar with one-click reminder setup

### Settings
- Profile: name, currency, theme preference, password change
- Household: name management
- Members: invite by email, remove members, see pending invites
- Categories: 14 default + unlimited custom (icon + color)
- Tags: 8 default + unlimited custom (color picker)
- Budgets: set monthly budget per category for any month
- Export: CSV or full JSON backup
- Danger zone: leave household

### Auth
- Email + password login
- Registration with household creation
- Forgot password (email reset)
- Invite acceptance via URL token
- Password strength indicator
- Dark/light theme on auth screen

---

## 🔁 Setting Up the Edge Function (Reminders & Recurring)

The Edge Function handles:
- Auto-generating expense instances from recurring templates
- Sending email reminders
- Flagging overdue expenses

### Deploy the function:

```bash
# Install Supabase CLI
npm install -g supabase

# Login
supabase login

# Link to your project
supabase link --project-ref YOUR_PROJECT_REF

# Deploy the function
supabase functions deploy send-reminder

# Set up a daily cron (in Supabase dashboard → Edge Functions → Schedules)
# Cron: 0 8 * * *  (runs daily at 8 AM UTC)
```

---

## 🔔 Email Reminders

The app uses Supabase's built-in auth email system for basic reminders. For production-quality emails, you can upgrade to [Resend](https://resend.com) (free tier: 3,000 emails/month):

1. Sign up at resend.com
2. Get your API key
3. In the Edge Function, replace the `console.log` with a `fetch` to `https://api.resend.com/emails`

---

## 🎨 Customization

### Change the brand color (from teal to any color):
In `assets/css/main.css`, change:
```css
--clr-primary: #0F766E;   /* Your brand color */
```

### Change default currency:
In `assets/js/supabase.js`, the `formatPHP()` function uses `'PHP'`. Change to any ISO 4217 currency code.

### Add more default categories:
In `supabase/schema.sql`, add rows to the `INSERT INTO categories` block.

---

## 🔐 Security

- All data is protected by Supabase **Row Level Security (RLS)**
- Users can only see data from their own household
- Global default categories/tags are read-only for all users
- Soft deletes (archive) instead of hard deletes for safety
- Session tokens managed by Supabase Auth (httpOnly cookies)

---

## 📱 Browser Support

Tested on:
- Chrome / Edge 90+
- Firefox 88+
- Safari 14+
- Mobile Safari (iOS 14+)
- Chrome Android

---

## 🆓 Free Tier Limits (Supabase)

| Resource         | Free Limit       |
|-----------------|-----------------|
| Database         | 500 MB           |
| Auth users       | Unlimited        |
| API requests     | 2M / month       |
| Edge Functions   | 2M invocations   |
| Storage          | 1 GB             |

For a typical household of 2–6 people tracking monthly expenses, the free tier is more than sufficient indefinitely.

---

## 🪜 Build Order Reference

| Phase | What was built |
|-------|----------------|
| 1     | Supabase schema, Edge Function, Auth flow |
| 2     | Design system (CSS variables, dark/light, components) |
| 3     | Login/Register page (index.html) |
| 4     | Dashboard + Charts (dashboard.html + dashboard.js) |
| 5     | Expenses CRUD + Splits + Tags (expenses.html + expenses.js) |
| 6     | Recurring expenses (recurring.html) |
| 7     | Splits & Settlements (splits.html) |
| 8     | Reminders (reminders.html) |
| 9     | Settings — all panels (settings.html) |

---

## 🤝 Contributing

This is a personal household finance tool. Feel free to fork and extend it.

---

*Built with ❤️ using Vanilla JS + Supabase*
