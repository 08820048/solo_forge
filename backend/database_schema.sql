-- SoloForge Database Schema
-- Created for v1.3 requirements

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create products table
CREATE TABLE IF NOT EXISTS products (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    slogan TEXT NOT NULL,
    description TEXT NOT NULL,
    website TEXT NOT NULL,
    logo_url TEXT,
    category TEXT NOT NULL,
    tags TEXT[],  -- Array of strings
    maker_name TEXT NOT NULL,
    maker_email TEXT NOT NULL,
    maker_website TEXT,
    language TEXT NOT NULL DEFAULT 'en' CHECK (language IN ('en', 'zh')),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create categories table
CREATE TABLE IF NOT EXISTS categories (
    id TEXT PRIMARY KEY,
    name_en TEXT NOT NULL,
    name_zh TEXT NOT NULL,
    icon TEXT NOT NULL,
    color TEXT NOT NULL
);

-- Insert default categories
INSERT INTO categories (id, name_en, name_zh, icon, color) VALUES
('ai', 'AI Tools', 'AI 工具', '🤖', 'from-purple-500 to-pink-500'),
('productivity', 'Productivity', '效率工具', '⚡', 'from-blue-500 to-cyan-500'),
('developer', 'Developer Tools', '开发者工具', '💻', 'from-green-500 to-emerald-500'),
('design', 'Design Tools', '设计工具', '🎨', 'from-pink-500 to-rose-500'),
('writing', 'Writing Tools', '写作工具', '✍️', 'from-orange-500 to-amber-500'),
('marketing', 'Marketing', '营销工具', '📈', 'from-indigo-500 to-purple-500'),
('education', 'Education', '教育工具', '📚', 'from-cyan-500 to-blue-500'),
('games', 'Games', '游戏', '🎮', 'from-red-500 to-orange-500'),
('finance', 'Finance', '金融工具', '💰', 'from-green-600 to-emerald-600'),
('lifestyle', 'Lifestyle', '生活方式', '🌟', 'from-yellow-500 to-orange-500')
ON CONFLICT (id) DO NOTHING;

-- Create developers table
CREATE TABLE IF NOT EXISTS developers (
    email TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    avatar_url TEXT,
    website TEXT,
    sponsor_role TEXT,
    sponsor_verified BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE developers
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Create developer follows table
CREATE TABLE IF NOT EXISTS developer_follows (
    id BIGSERIAL PRIMARY KEY,
    developer_email TEXT NOT NULL REFERENCES developers(email) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (developer_email, user_id)
);

-- Create product likes table
CREATE TABLE IF NOT EXISTS product_likes (
    id BIGSERIAL PRIMARY KEY,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (product_id, user_id)
);

-- Create product favorites table
CREATE TABLE IF NOT EXISTS product_favorites (
    id BIGSERIAL PRIMARY KEY,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (product_id, user_id)
);

-- Create newsletter subscriptions table
CREATE TABLE IF NOT EXISTS newsletter_subscriptions (
    email TEXT PRIMARY KEY,
    unsubscribed BOOLEAN NOT NULL DEFAULT FALSE,
    last_sent_week TEXT,
    last_sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create home module state table (used for sponsor rotations)
CREATE TABLE IF NOT EXISTS home_module_state (
    key TEXT PRIMARY KEY,
    mode TEXT NOT NULL DEFAULT 'first100',
    day_key DATE,
    remaining_ids TEXT[] NOT NULL DEFAULT ARRAY[]::text[],
    today_ids TEXT[] NOT NULL DEFAULT ARRAY[]::text[],
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create sponsorship grants table (paid sponsorship entitlements)
CREATE TABLE IF NOT EXISTS sponsorship_grants (
    id BIGSERIAL PRIMARY KEY,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    placement TEXT NOT NULL CHECK (placement IN ('home_top', 'home_right')),
    slot_index INT,
    starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ends_at TIMESTAMPTZ NOT NULL,
    source TEXT NOT NULL DEFAULT 'manual',
    amount_usd_cents INT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sponsorship_requests (
    id BIGSERIAL PRIMARY KEY,
    email TEXT NOT NULL,
    product_ref TEXT NOT NULL,
    placement TEXT NOT NULL CHECK (placement IN ('home_top', 'home_right')),
    slot_index INT,
    duration_days INT NOT NULL,
    note TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processed', 'rejected')),
    processed_grant_id BIGINT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_products_status ON products(status);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
CREATE INDEX IF NOT EXISTS idx_products_language ON products(language);
CREATE INDEX IF NOT EXISTS idx_products_created_at ON products(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_products_website ON products(website);

CREATE INDEX IF NOT EXISTS idx_developers_name ON developers(name);
CREATE INDEX IF NOT EXISTS idx_developer_follows_email ON developer_follows(developer_email);
CREATE INDEX IF NOT EXISTS idx_developer_follows_created_at ON developer_follows(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_product_likes_product_id ON product_likes(product_id);
CREATE INDEX IF NOT EXISTS idx_product_likes_created_at ON product_likes(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_product_favorites_product_id ON product_favorites(product_id);
CREATE INDEX IF NOT EXISTS idx_product_favorites_created_at ON product_favorites(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_newsletter_subscriptions_unsubscribed ON newsletter_subscriptions(unsubscribed);

CREATE INDEX IF NOT EXISTS idx_sponsorship_grants_product_id ON sponsorship_grants(product_id);
CREATE INDEX IF NOT EXISTS idx_sponsorship_grants_placement ON sponsorship_grants(placement);
CREATE INDEX IF NOT EXISTS idx_sponsorship_grants_active_range ON sponsorship_grants(starts_at, ends_at);
CREATE INDEX IF NOT EXISTS idx_sponsorship_requests_status ON sponsorship_requests(status);
CREATE INDEX IF NOT EXISTS idx_sponsorship_requests_created_at ON sponsorship_requests(created_at DESC);

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create trigger for products table
DROP TRIGGER IF EXISTS update_products_updated_at ON products;
CREATE TRIGGER update_products_updated_at
    BEFORE UPDATE ON products
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_home_module_state_updated_at ON home_module_state;
CREATE TRIGGER update_home_module_state_updated_at
    BEFORE UPDATE ON home_module_state
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_newsletter_subscriptions_updated_at ON newsletter_subscriptions;
CREATE TRIGGER update_newsletter_subscriptions_updated_at
    BEFORE UPDATE ON newsletter_subscriptions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_sponsorship_requests_updated_at ON sponsorship_requests;
CREATE TRIGGER update_sponsorship_requests_updated_at
    BEFORE UPDATE ON sponsorship_requests
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Create view for approved products only
CREATE OR REPLACE VIEW approved_products AS
SELECT * FROM products WHERE status = 'approved';

-- Create RLS (Row Level Security) policies
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;

-- Allow read access to all tables for authenticated users
DROP POLICY IF EXISTS "Enable read access for authenticated users" ON products;
DROP POLICY IF EXISTS "Enable read access for authenticated users" ON categories;
CREATE POLICY "Enable read access for authenticated users" ON products
    FOR SELECT USING (true);

CREATE POLICY "Enable read access for authenticated users" ON categories
    FOR SELECT USING (true);

-- Allow insert access for product submissions
DROP POLICY IF EXISTS "Allow product submissions" ON products;
CREATE POLICY "Allow product submissions" ON products
    FOR INSERT WITH CHECK (status = 'pending');

-- Allow update access for admins (this will need to be configured in Supabase Auth)
DROP POLICY IF EXISTS "Allow updates for owners" ON products;
CREATE POLICY "Allow updates for owners" ON products
    FOR UPDATE USING (
        auth.uid()::text = CURRENT_USER::text
        OR status = 'pending'
    );

-- Create function for checking if user can update product
CREATE OR REPLACE FUNCTION can_update_product(product_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
    product_status TEXT;
BEGIN
    SELECT status INTO product_status
    FROM products
    WHERE id = product_id;

    RETURN product_status = 'pending' OR auth.uid()::text = CURRENT_USER::text;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
