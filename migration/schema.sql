-- JeetoPlay Supabase Schema
-- Run this in Supabase SQL Editor (Dashboard → SQL Editor → New query)

-- Games catalog
CREATE TABLE IF NOT EXISTS games (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    icon TEXT,
    banner TEXT,
    is_enabled BOOLEAN DEFAULT true,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Matches
CREATE TABLE IF NOT EXISTS matches (
    id TEXT PRIMARY KEY,
    game_id TEXT REFERENCES games(id),
    title TEXT,
    type TEXT DEFAULT 'SOLO',
    status TEXT DEFAULT 'UPCOMING',
    entry_fee NUMERIC DEFAULT 0,
    prize_pool NUMERIC DEFAULT 0,
    per_kill NUMERIC DEFAULT 0,
    max_participants INTEGER DEFAULT 100,
    date_time TIMESTAMPTZ,
    room_id TEXT,
    room_password TEXT,
    map TEXT,
    version TEXT,
    created_by TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Match participants (normalized from nested RTDB structure)
CREATE TABLE IF NOT EXISTS match_participants (
    id SERIAL PRIMARY KEY,
    match_id TEXT REFERENCES matches(id) ON DELETE CASCADE,
    user_uid TEXT NOT NULL,
    username TEXT,
    slot_number INTEGER,
    kills INTEGER DEFAULT 0,
    placement INTEGER,
    prize_amount NUMERIC DEFAULT 0,
    booked_by TEXT,
    team_name TEXT,
    joined_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(match_id, user_uid)
);

-- User profiles
CREATE TABLE IF NOT EXISTS profiles (
    uid TEXT PRIMARY KEY,
    username TEXT,
    full_name TEXT,
    email TEXT,
    phone TEXT,
    avatar_url TEXT,
    deposit_balance NUMERIC DEFAULT 0,
    winning_balance NUMERIC DEFAULT 0,
    total_matches INTEGER DEFAULT 0,
    total_wins INTEGER DEFAULT 0,
    referral_code TEXT UNIQUE,
    referred_by TEXT,
    is_blocked BOOLEAN DEFAULT false,
    is_vip BOOLEAN DEFAULT false,
    vip_data JSONB DEFAULT '{}',
    spin_data JSONB DEFAULT '{}',
    daily_reward JSONB DEFAULT '{}',
    theme_preference TEXT DEFAULT 'dark',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Wallet transactions
CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY,
    user_uid TEXT NOT NULL,
    type TEXT NOT NULL,
    amount NUMERIC NOT NULL,
    balance_type TEXT,
    description TEXT,
    match_id TEXT,
    status TEXT DEFAULT 'completed',
    from_deposit NUMERIC DEFAULT 0,
    from_winning NUMERIC DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Deposits
CREATE TABLE IF NOT EXISTS deposits (
    id TEXT PRIMARY KEY,
    user_uid TEXT NOT NULL,
    amount NUMERIC NOT NULL,
    status TEXT DEFAULT 'PENDING',
    payment_method TEXT,
    transaction_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Withdrawals  
CREATE TABLE IF NOT EXISTS withdrawals (
    id TEXT PRIMARY KEY,
    user_uid TEXT NOT NULL,
    amount NUMERIC NOT NULL,
    net_amount NUMERIC,
    fee_amount NUMERIC DEFAULT 0,
    status TEXT DEFAULT 'pending',
    upi_id TEXT,
    admin_note TEXT,
    processed_by TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    processed_at TIMESTAMPTZ
);

-- Referral stats
CREATE TABLE IF NOT EXISTS referral_stats (
    uid TEXT PRIMARY KEY,
    total_referrals INTEGER DEFAULT 0,
    total_earned NUMERIC DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Referrals
CREATE TABLE IF NOT EXISTS referrals (
    id SERIAL PRIMARY KEY,
    referrer_uid TEXT NOT NULL,
    referred_uid TEXT NOT NULL,
    referred_username TEXT,
    bonus_credited BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(referrer_uid, referred_uid)
);

-- Ludo matches
CREATE TABLE IF NOT EXISTS ludo_matches (
    id TEXT PRIMARY KEY,
    creator_uid TEXT,
    creator_username TEXT,
    acceptor_uid TEXT,
    acceptor_username TEXT,
    amount NUMERIC,
    status TEXT DEFAULT 'waiting',
    winner_uid TEXT,
    room_code TEXT,
    creator_result TEXT,
    acceptor_result TEXT,
    creator_screenshot TEXT,
    acceptor_screenshot TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tournaments
CREATE TABLE IF NOT EXISTS tournaments (
    id TEXT PRIMARY KEY,
    game_id TEXT,
    title TEXT,
    format TEXT DEFAULT 'lobby',
    status TEXT DEFAULT 'upcoming',
    entry_fee NUMERIC DEFAULT 0,
    prize_pool NUMERIC DEFAULT 0,
    max_participants INTEGER DEFAULT 16,
    data JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Platform config (key-value store for settings)
CREATE TABLE IF NOT EXISTS platform_config (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Announcements
CREATE TABLE IF NOT EXISTS announcements (
    id SERIAL PRIMARY KEY,
    text TEXT,
    is_active BOOLEAN DEFAULT true,
    link TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Home slider
CREATE TABLE IF NOT EXISTS home_slider (
    id TEXT PRIMARY KEY,
    image TEXT NOT NULL,
    link TEXT,
    sort_order INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT true
);

-- ============ INDEXES ============
CREATE INDEX IF NOT EXISTS idx_matches_game_id ON matches(game_id);
CREATE INDEX IF NOT EXISTS idx_matches_status ON matches(status);
CREATE INDEX IF NOT EXISTS idx_matches_game_status ON matches(game_id, status);
CREATE INDEX IF NOT EXISTS idx_matches_date ON matches(date_time DESC);
CREATE INDEX IF NOT EXISTS idx_participants_match ON match_participants(match_id);
CREATE INDEX IF NOT EXISTS idx_participants_user ON match_participants(user_uid);
CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(user_uid);
CREATE INDEX IF NOT EXISTS idx_transactions_created ON transactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_user_created ON transactions(user_uid, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_deposits_user ON deposits(user_uid);
CREATE INDEX IF NOT EXISTS idx_withdrawals_user ON withdrawals(user_uid);
CREATE INDEX IF NOT EXISTS idx_withdrawals_status ON withdrawals(status);
CREATE INDEX IF NOT EXISTS idx_ludo_creator ON ludo_matches(creator_uid);
CREATE INDEX IF NOT EXISTS idx_ludo_acceptor ON ludo_matches(acceptor_uid);
CREATE INDEX IF NOT EXISTS idx_ludo_status ON ludo_matches(status);
CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_uid);

-- ============ ROW LEVEL SECURITY ============
ALTER TABLE games ENABLE ROW LEVEL SECURITY;
ALTER TABLE matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE match_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE deposits ENABLE ROW LEVEL SECURITY;
ALTER TABLE withdrawals ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE home_slider ENABLE ROW LEVEL SECURITY;
ALTER TABLE ludo_matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE tournaments ENABLE ROW LEVEL SECURITY;
ALTER TABLE referral_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE referrals ENABLE ROW LEVEL SECURITY;

-- Public read policies (everyone can see games, matches, announcements)
CREATE POLICY "games_public_read" ON games FOR SELECT USING (true);
CREATE POLICY "matches_public_read" ON matches FOR SELECT USING (true);
CREATE POLICY "participants_public_read" ON match_participants FOR SELECT USING (true);
CREATE POLICY "announcements_public_read" ON announcements FOR SELECT USING (true);
CREATE POLICY "slider_public_read" ON home_slider FOR SELECT USING (true);
CREATE POLICY "config_public_read" ON platform_config FOR SELECT USING (true);
CREATE POLICY "tournaments_public_read" ON tournaments FOR SELECT USING (true);
CREATE POLICY "referral_stats_public_read" ON referral_stats FOR SELECT USING (true);
CREATE POLICY "ludo_public_read" ON ludo_matches FOR SELECT USING (true);

-- User-specific read policies
CREATE POLICY "profiles_own_read" ON profiles FOR SELECT USING (true);
CREATE POLICY "transactions_own_read" ON transactions FOR SELECT USING (true);
CREATE POLICY "deposits_own_read" ON deposits FOR SELECT USING (true);
CREATE POLICY "withdrawals_own_read" ON withdrawals FOR SELECT USING (true);
CREATE POLICY "referrals_own_read" ON referrals FOR SELECT USING (true);

-- All writes go through backend/Cloud Functions (service_role key), not client
-- So we don't need INSERT/UPDATE/DELETE policies for the anon key
