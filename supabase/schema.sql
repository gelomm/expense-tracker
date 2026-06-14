-- ============================================================
-- GASTOS — Monthly Expense Tracker
-- Supabase / PostgreSQL Schema
-- Run this in your Supabase SQL Editor
-- ============================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- HOUSEHOLDS
-- ============================================================
CREATE TABLE households (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        TEXT NOT NULL,
  created_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- PROFILES (extends auth.users)
-- ============================================================
CREATE TABLE profiles (
  id                UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name         TEXT NOT NULL,
  avatar_url        TEXT,
  household_id      UUID REFERENCES households(id) ON DELETE SET NULL,
  role              TEXT DEFAULT 'member' CHECK (role IN ('owner', 'member')),
  theme_preference  TEXT DEFAULT 'light' CHECK (theme_preference IN ('light', 'dark')),
  currency          TEXT DEFAULT 'PHP',
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- INVITATIONS
-- ============================================================
CREATE TABLE invitations (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  household_id    UUID REFERENCES households(id) ON DELETE CASCADE,
  invited_email   TEXT NOT NULL,
  invited_by      UUID REFERENCES profiles(id) ON DELETE SET NULL,
  token           TEXT UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  status          TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'expired')),
  expires_at      TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '7 days'),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- CATEGORIES (default + custom per household)
-- ============================================================
CREATE TABLE categories (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  household_id  UUID REFERENCES households(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  icon          TEXT DEFAULT '📦',
  color         TEXT DEFAULT '#6B7280',
  is_default    BOOLEAN DEFAULT FALSE,
  created_by    UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- TAGS (default + custom per household)
-- ============================================================
CREATE TABLE tags (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  household_id  UUID REFERENCES households(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  color         TEXT DEFAULT '#6B7280',
  is_default    BOOLEAN DEFAULT FALSE,
  created_by    UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- RECURRING EXPENSES (planned templates)
-- ============================================================
CREATE TABLE recurring_expenses (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  household_id    UUID REFERENCES households(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  amount          NUMERIC(12, 2) NOT NULL,
  category_id     UUID REFERENCES categories(id) ON DELETE SET NULL,
  paid_by         UUID REFERENCES profiles(id) ON DELETE SET NULL,
  frequency       TEXT NOT NULL CHECK (frequency IN ('daily','weekly','biweekly','monthly','bimonthly','annually')),
  start_date      DATE NOT NULL,
  end_date        DATE,
  next_due_date   DATE NOT NULL,
  split_config    JSONB DEFAULT '[]',
  notes           TEXT,
  is_active       BOOLEAN DEFAULT TRUE,
  created_by      UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- EXPENSES (one-time + generated from recurring)
-- ============================================================
CREATE TABLE expenses (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  household_id    UUID REFERENCES households(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  amount          NUMERIC(12, 2) NOT NULL,
  category_id     UUID REFERENCES categories(id) ON DELETE SET NULL,
  paid_by         UUID REFERENCES profiles(id) ON DELETE SET NULL,
  expense_date    DATE NOT NULL DEFAULT CURRENT_DATE,
  due_date        DATE,
  notes           TEXT,
  is_recurring    BOOLEAN DEFAULT FALSE,
  recurring_id    UUID REFERENCES recurring_expenses(id) ON DELETE SET NULL,
  status          TEXT DEFAULT 'unpaid' CHECK (status IN ('paid', 'unpaid', 'overdue')),
  is_deleted      BOOLEAN DEFAULT FALSE,
  created_by      UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- EXPENSE TAGS (many-to-many)
-- ============================================================
CREATE TABLE expense_tags (
  expense_id  UUID REFERENCES expenses(id) ON DELETE CASCADE,
  tag_id      UUID REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (expense_id, tag_id)
);

-- ============================================================
-- EXPENSE SPLITS
-- ============================================================
CREATE TABLE expense_splits (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  expense_id   UUID REFERENCES expenses(id) ON DELETE CASCADE,
  profile_id   UUID REFERENCES profiles(id) ON DELETE CASCADE,
  split_type   TEXT DEFAULT 'equal' CHECK (split_type IN ('equal', 'percentage', 'fixed')),
  amount       NUMERIC(12, 2),
  percentage   NUMERIC(5, 2),
  is_settled   BOOLEAN DEFAULT FALSE,
  settled_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- BUDGETS (monthly per category)
-- ============================================================
CREATE TABLE budgets (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  household_id  UUID REFERENCES households(id) ON DELETE CASCADE,
  category_id   UUID REFERENCES categories(id) ON DELETE CASCADE,
  month         TEXT NOT NULL, -- format: YYYY-MM
  amount        NUMERIC(12, 2) NOT NULL,
  created_by    UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(household_id, category_id, month)
);

-- ============================================================
-- REMINDERS
-- ============================================================
CREATE TABLE reminders (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  expense_id            UUID REFERENCES expenses(id) ON DELETE CASCADE,
  recurring_expense_id  UUID REFERENCES recurring_expenses(id) ON DELETE CASCADE,
  profile_id            UUID REFERENCES profiles(id) ON DELETE CASCADE,
  remind_at             TIMESTAMPTZ NOT NULL,
  type                  TEXT DEFAULT 'in_app' CHECK (type IN ('in_app', 'email', 'both')),
  message               TEXT,
  is_sent               BOOLEAN DEFAULT FALSE,
  is_read               BOOLEAN DEFAULT FALSE,
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- AUTO-UPDATE updated_at TRIGGER
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_expenses_updated_at
  BEFORE UPDATE ON expenses
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_recurring_updated_at
  BEFORE UPDATE ON recurring_expenses
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- AUTO-CREATE PROFILE ON SIGNUP
-- ============================================================
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, full_name, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    NEW.raw_user_meta_data->>'avatar_url'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ============================================================
-- AUTO-FLAG OVERDUE EXPENSES
-- ============================================================
CREATE OR REPLACE FUNCTION flag_overdue_expenses()
RETURNS void AS $$
BEGIN
  UPDATE expenses
  SET status = 'overdue'
  WHERE status = 'unpaid'
    AND due_date < CURRENT_DATE
    AND is_deleted = FALSE;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- DEFAULT CATEGORIES (global — household_id IS NULL)
-- ============================================================
INSERT INTO categories (name, icon, color, is_default, household_id) VALUES
  ('Rent & Housing',    '🏠', '#4F46E5', TRUE, NULL),
  ('Utilities',         '💡', '#F59E0B', TRUE, NULL),
  ('Groceries',         '🛒', '#10B981', TRUE, NULL),
  ('Transportation',    '🚗', '#3B82F6', TRUE, NULL),
  ('Health & Medical',  '🏥', '#EF4444', TRUE, NULL),
  ('Education',         '📚', '#8B5CF6', TRUE, NULL),
  ('Entertainment',     '🎬', '#EC4899', TRUE, NULL),
  ('Dining Out',        '🍽️', '#F97316', TRUE, NULL),
  ('Subscriptions',     '📱', '#06B6D4', TRUE, NULL),
  ('Insurance',         '🛡️', '#6B7280', TRUE, NULL),
  ('Clothing',          '👕', '#A855F7', TRUE, NULL),
  ('Savings & Invest',  '💰', '#14B8A6', TRUE, NULL),
  ('Personal Care',     '🧴', '#F472B6', TRUE, NULL),
  ('Others',            '📦', '#9CA3AF', TRUE, NULL);

-- ============================================================
-- DEFAULT TAGS (global)
-- ============================================================
INSERT INTO tags (name, color, is_default, household_id) VALUES
  ('Essential',     '#EF4444', TRUE, NULL),
  ('Optional',      '#F59E0B', TRUE, NULL),
  ('Shared',        '#4F46E5', TRUE, NULL),
  ('Personal',      '#10B981', TRUE, NULL),
  ('Work',          '#3B82F6', TRUE, NULL),
  ('Recurring',     '#8B5CF6', TRUE, NULL),
  ('One-time',      '#EC4899', TRUE, NULL),
  ('High Priority', '#F97316', TRUE, NULL);

-- ============================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================
ALTER TABLE households        ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles          ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitations        ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories        ENABLE ROW LEVEL SECURITY;
ALTER TABLE tags              ENABLE ROW LEVEL SECURITY;
ALTER TABLE expenses          ENABLE ROW LEVEL SECURITY;
ALTER TABLE expense_tags      ENABLE ROW LEVEL SECURITY;
ALTER TABLE expense_splits    ENABLE ROW LEVEL SECURITY;
ALTER TABLE recurring_expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE budgets           ENABLE ROW LEVEL SECURITY;
ALTER TABLE reminders         ENABLE ROW LEVEL SECURITY;

-- Profiles: users can read/update their own
CREATE POLICY "profiles_select" ON profiles FOR SELECT USING (
  id = auth.uid() OR household_id IN (
    SELECT household_id FROM profiles WHERE id = auth.uid()
  )
);
CREATE POLICY "profiles_update" ON profiles FOR UPDATE USING (id = auth.uid());

-- Households: members can read, owner can update
CREATE POLICY "households_select" ON households FOR SELECT USING (
  id IN (SELECT household_id FROM profiles WHERE id = auth.uid())
);
CREATE POLICY "households_insert" ON households FOR INSERT WITH CHECK (created_by = auth.uid());
CREATE POLICY "households_update" ON households FOR UPDATE USING (created_by = auth.uid());

-- Expenses: household members only
CREATE POLICY "expenses_select" ON expenses FOR SELECT USING (
  household_id IN (SELECT household_id FROM profiles WHERE id = auth.uid())
  AND is_deleted = FALSE
);
CREATE POLICY "expenses_insert" ON expenses FOR INSERT WITH CHECK (
  household_id IN (SELECT household_id FROM profiles WHERE id = auth.uid())
);
CREATE POLICY "expenses_update" ON expenses FOR UPDATE USING (
  household_id IN (SELECT household_id FROM profiles WHERE id = auth.uid())
);

-- Categories: global defaults + household-specific
CREATE POLICY "categories_select" ON categories FOR SELECT USING (
  household_id IS NULL OR
  household_id IN (SELECT household_id FROM profiles WHERE id = auth.uid())
);
CREATE POLICY "categories_insert" ON categories FOR INSERT WITH CHECK (
  household_id IN (SELECT household_id FROM profiles WHERE id = auth.uid())
);
CREATE POLICY "categories_update" ON categories FOR UPDATE USING (
  household_id IN (SELECT household_id FROM profiles WHERE id = auth.uid())
  AND is_default = FALSE
);
CREATE POLICY "categories_delete" ON categories FOR DELETE USING (
  household_id IN (SELECT household_id FROM profiles WHERE id = auth.uid())
  AND is_default = FALSE
);

-- Tags: global defaults + household-specific
CREATE POLICY "tags_select" ON tags FOR SELECT USING (
  household_id IS NULL OR
  household_id IN (SELECT household_id FROM profiles WHERE id = auth.uid())
);
CREATE POLICY "tags_insert" ON tags FOR INSERT WITH CHECK (
  household_id IN (SELECT household_id FROM profiles WHERE id = auth.uid())
);
CREATE POLICY "tags_delete" ON tags FOR DELETE USING (
  household_id IN (SELECT household_id FROM profiles WHERE id = auth.uid())
  AND is_default = FALSE
);

-- Splits, tags, budgets, reminders: household members
CREATE POLICY "expense_splits_all" ON expense_splits FOR ALL USING (
  expense_id IN (SELECT id FROM expenses WHERE household_id IN (
    SELECT household_id FROM profiles WHERE id = auth.uid()
  ))
);
CREATE POLICY "expense_tags_all" ON expense_tags FOR ALL USING (
  expense_id IN (SELECT id FROM expenses WHERE household_id IN (
    SELECT household_id FROM profiles WHERE id = auth.uid()
  ))
);
CREATE POLICY "budgets_all" ON budgets FOR ALL USING (
  household_id IN (SELECT household_id FROM profiles WHERE id = auth.uid())
);
CREATE POLICY "recurring_all" ON recurring_expenses FOR ALL USING (
  household_id IN (SELECT household_id FROM profiles WHERE id = auth.uid())
);
CREATE POLICY "reminders_all" ON reminders FOR ALL USING (
  profile_id = auth.uid()
);
CREATE POLICY "invitations_all" ON invitations FOR ALL USING (
  household_id IN (SELECT household_id FROM profiles WHERE id = auth.uid())
  OR invited_email = auth.email()
);
