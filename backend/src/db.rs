use crate::models::{
    Category, CreateProductRequest, CreateSponsorshipGrantFromRequest, CreateSponsorshipRequest,
    Developer, DeveloperCenterStats, DeveloperPopularity, DeveloperWithFollowers, Product,
    QueryParams, SponsorshipGrant, SponsorshipRequest, UpdateProductRequest,
};
use anyhow::Result;
use base64::{engine::general_purpose, Engine as _};
use chrono::{Datelike, TimeZone, Timelike};
use hmac::{Hmac, Mac};
use reqwest::{Client, Url};
use sha2::Sha256;
use sqlx::postgres::{PgConnectOptions, PgPool, PgPoolOptions};
use sqlx::{Postgres, QueryBuilder};
use std::borrow::Cow;
use std::env;
use std::str::FromStr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

pub struct Database {
    supabase: Option<SupabaseDatabase>,
    postgres: Option<PgPool>,
}

struct SupabaseDatabase {
    client: Client,
    supabase_url: String,
    supabase_key: String,
}

#[derive(sqlx::FromRow)]
struct ProductRow {
    id: String,
    name: String,
    slogan: String,
    description: String,
    website: String,
    logo_url: Option<String>,
    category: String,
    tags: Vec<String>,
    maker_name: String,
    maker_email: String,
    maker_website: Option<String>,
    maker_sponsor_role: Option<String>,
    maker_sponsor_verified: bool,
    language: String,
    status: String,
    rejection_reason: Option<String>,
    created_at: chrono::DateTime<chrono::Utc>,
    updated_at: chrono::DateTime<chrono::Utc>,
    likes: i64,
    favorites: i64,
}

#[derive(sqlx::FromRow)]
struct CategoryRow {
    id: String,
    name_en: String,
    name_zh: Option<String>,
    icon: String,
    color: String,
}

#[derive(sqlx::FromRow)]
struct CategoryWithCountRow {
    id: String,
    name_en: String,
    name_zh: Option<String>,
    icon: String,
    color: String,
    product_count: i64,
}

#[derive(sqlx::FromRow)]
struct DeveloperRow {
    email: String,
    name: String,
    avatar_url: Option<String>,
    website: Option<String>,
    sponsor_role: Option<String>,
    sponsor_verified: bool,
}

#[derive(sqlx::FromRow)]
struct DeveloperWithFollowersRow {
    email: String,
    name: String,
    avatar_url: Option<String>,
    website: Option<String>,
    sponsor_role: Option<String>,
    sponsor_verified: bool,
    followers: String,
}

#[derive(sqlx::FromRow)]
struct DeveloperPopularityRow {
    email: String,
    name: String,
    avatar_url: Option<String>,
    website: Option<String>,
    sponsor_role: Option<String>,
    sponsor_verified: bool,
    likes: i64,
    favorites: i64,
    score: i64,
}

#[derive(sqlx::FromRow)]
struct DeveloperCenterStatsRow {
    followers: i64,
    total_likes: i64,
    total_favorites: i64,
}

#[derive(sqlx::FromRow)]
struct NewsletterRecipientRow {
    email: String,
}

#[derive(sqlx::FromRow)]
pub(crate) struct NewsletterTopProductRow {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) slogan: String,
    pub(crate) website: String,
    pub(crate) maker_name: String,
    pub(crate) maker_email: String,
    pub(crate) weekly_likes: i64,
    pub(crate) weekly_favorites: i64,
    pub(crate) score: i64,
}

#[derive(sqlx::FromRow)]
pub struct HomeModuleStateRow {
    key: String,
    mode: Option<String>,
    day_key: Option<chrono::NaiveDate>,
    remaining_ids: Vec<String>,
    today_ids: Vec<String>,
}

#[derive(sqlx::FromRow)]
struct SponsorshipGrantRow {
    product_id: String,
    slot_index: Option<i32>,
}

#[derive(sqlx::FromRow)]
struct SponsorshipRequestRow {
    id: i64,
    email: String,
    product_ref: String,
    placement: String,
    slot_index: Option<i32>,
    duration_days: i32,
    note: Option<String>,
    status: String,
    processed_grant_id: Option<i64>,
    created_at: chrono::DateTime<chrono::Utc>,
    updated_at: chrono::DateTime<chrono::Utc>,
}

#[derive(sqlx::FromRow)]
struct SponsorshipGrantFullRow {
    id: i64,
    product_id: String,
    placement: String,
    slot_index: Option<i32>,
    starts_at: chrono::DateTime<chrono::Utc>,
    ends_at: chrono::DateTime<chrono::Utc>,
    source: String,
    amount_usd_cents: Option<i32>,
    created_at: chrono::DateTime<chrono::Utc>,
}

pub struct HomeModuleState {
    pub key: String,
    pub mode: Option<String>,
    pub day_key: Option<chrono::NaiveDate>,
    pub remaining_ids: Vec<String>,
    pub today_ids: Vec<String>,
}

fn map_home_module_state_row(row: HomeModuleStateRow) -> HomeModuleState {
    HomeModuleState {
        key: row.key,
        mode: row.mode,
        day_key: row.day_key,
        remaining_ids: row.remaining_ids,
        today_ids: row.today_ids,
    }
}

fn map_sponsorship_request_row(row: SponsorshipRequestRow) -> SponsorshipRequest {
    let mut email = row.email;
    let mut product_ref = row.product_ref;
    let mut placement = row.placement;
    let mut status = row.status;
    let mut note = row.note;
    strip_nul_in_place(&mut email);
    strip_nul_in_place(&mut product_ref);
    strip_nul_in_place(&mut placement);
    strip_nul_in_place(&mut status);
    strip_nul_in_place_opt(&mut note);
    SponsorshipRequest {
        id: row.id,
        email,
        product_ref,
        placement,
        slot_index: row.slot_index,
        duration_days: row.duration_days,
        note,
        status,
        processed_grant_id: row.processed_grant_id,
        created_at: row.created_at,
        updated_at: row.updated_at,
    }
}

fn map_sponsorship_grant_full_row(row: SponsorshipGrantFullRow) -> SponsorshipGrant {
    let mut product_id = row.product_id;
    let mut placement = row.placement;
    let mut source = row.source;
    strip_nul_in_place(&mut product_id);
    strip_nul_in_place(&mut placement);
    strip_nul_in_place(&mut source);
    SponsorshipGrant {
        id: row.id,
        product_id,
        placement,
        slot_index: row.slot_index,
        starts_at: row.starts_at,
        ends_at: row.ends_at,
        source,
        amount_usd_cents: row.amount_usd_cents,
        created_at: row.created_at,
    }
}

/**
 * parse_product_status
 * 将数据库/接口返回的 status 字符串解析为 ProductStatus。
 */
fn parse_product_status(raw: &str) -> crate::models::ProductStatus {
    match raw.to_ascii_lowercase().as_str() {
        "approved" => crate::models::ProductStatus::Approved,
        "rejected" => crate::models::ProductStatus::Rejected,
        _ => crate::models::ProductStatus::Pending,
    }
}

/**
 * serialize_product_status
 * 将 ProductStatus 序列化为数据库可用的小写字符串。
 */
fn serialize_product_status(status: &crate::models::ProductStatus) -> &'static str {
    match status {
        crate::models::ProductStatus::Pending => "pending",
        crate::models::ProductStatus::Approved => "approved",
        crate::models::ProductStatus::Rejected => "rejected",
    }
}

/**
 * dev_include_pending_in_approved
 * 开发环境下将 approved 视为 (approved | pending)，用于在 RLS 限制下展示 seed 数据。
 */
fn dev_include_pending_in_approved() -> bool {
    matches!(
        env::var("DEV_INCLUDE_PENDING_IN_APPROVED"),
        Ok(v) if v.eq_ignore_ascii_case("1") || v.eq_ignore_ascii_case("true")
    )
}

fn is_retryable_db_error(err: &anyhow::Error) -> bool {
    let msg = format!("{:?}", err).to_ascii_lowercase();
    msg.contains("prepared statement")
        || msg.contains("bind message supplies")
        || msg.contains("insufficient data left in message")
        || msg.contains("pool timed out")
        || msg.contains("operation timed out")
        || msg.contains("connection timed out")
        || msg.contains("connection refused")
        || msg.contains("error connecting")
}

fn is_missing_column_error(err: &anyhow::Error, column: &str) -> bool {
    let msg = format!("{:?}", err).to_ascii_lowercase();
    msg.contains("column") && msg.contains(column) && msg.contains("does not exist")
}

fn is_missing_relation_error(err: &anyhow::Error, relation: &str) -> bool {
    let msg = format!("{:?}", err).to_ascii_lowercase();
    msg.contains("relation") && msg.contains(relation) && msg.contains("does not exist")
}

static PRODUCTS_REJECTION_REASON_READY: AtomicBool = AtomicBool::new(false);

async fn ensure_products_rejection_reason_column(pool: &PgPool) -> Result<()> {
    if PRODUCTS_REJECTION_REASON_READY.load(Ordering::Relaxed) {
        return Ok(());
    }
    sqlx::query("ALTER TABLE products ADD COLUMN IF NOT EXISTS rejection_reason TEXT")
        .persistent(false)
        .execute(pool)
        .await?;
    PRODUCTS_REJECTION_REASON_READY.store(true, Ordering::Relaxed);
    Ok(())
}

static DEVELOPERS_SPONSOR_COLUMNS_READY: AtomicBool = AtomicBool::new(false);

/**
 * ensure_developers_sponsor_columns
 * 自动补齐 developers 表的 sponsor_role / sponsor_verified 字段，避免旧库缺列导致查询失败。
 */
async fn ensure_developers_sponsor_columns(pool: &PgPool) -> Result<()> {
    if DEVELOPERS_SPONSOR_COLUMNS_READY.load(Ordering::Relaxed) {
        return Ok(());
    }

    sqlx::query("ALTER TABLE developers ADD COLUMN IF NOT EXISTS sponsor_role TEXT")
        .persistent(false)
        .execute(pool)
        .await?;
    sqlx::query(
        "ALTER TABLE developers ADD COLUMN IF NOT EXISTS sponsor_verified BOOLEAN NOT NULL DEFAULT FALSE",
    )
    .persistent(false)
    .execute(pool)
    .await?;

    DEVELOPERS_SPONSOR_COLUMNS_READY.store(true, Ordering::Relaxed);
    Ok(())
}

static SPONSORSHIP_TABLES_READY: AtomicBool = AtomicBool::new(false);

/**
 * ensure_sponsorship_tables
 * 自动创建 sponsorship_requests / sponsorship_grants 表与必要索引，避免旧库缺表导致接口失败。
 */
async fn ensure_sponsorship_tables(pool: &PgPool) -> Result<()> {
    if SPONSORSHIP_TABLES_READY.load(Ordering::Relaxed) {
        return Ok(());
    }

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS sponsorship_grants ( \
            id BIGSERIAL PRIMARY KEY, \
            product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE, \
            placement TEXT NOT NULL CHECK (placement IN ('home_top', 'home_right')), \
            slot_index INT, \
            starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), \
            ends_at TIMESTAMPTZ NOT NULL, \
            source TEXT NOT NULL DEFAULT 'manual', \
            amount_usd_cents INT, \
            created_at TIMESTAMPTZ DEFAULT NOW() \
        )",
    )
    .persistent(false)
    .execute(pool)
    .await?;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS sponsorship_requests ( \
            id BIGSERIAL PRIMARY KEY, \
            email TEXT NOT NULL, \
            product_ref TEXT NOT NULL, \
            placement TEXT NOT NULL CHECK (placement IN ('home_top', 'home_right')), \
            slot_index INT, \
            duration_days INT NOT NULL, \
            note TEXT, \
            status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processed', 'rejected')), \
            processed_grant_id BIGINT, \
            created_at TIMESTAMPTZ DEFAULT NOW(), \
            updated_at TIMESTAMPTZ DEFAULT NOW() \
        )",
    )
    .persistent(false)
    .execute(pool)
    .await?;

    sqlx::query("CREATE INDEX IF NOT EXISTS idx_sponsorship_grants_product_id ON sponsorship_grants(product_id)")
        .persistent(false)
        .execute(pool)
        .await?;
    sqlx::query("CREATE INDEX IF NOT EXISTS idx_sponsorship_grants_placement ON sponsorship_grants(placement)")
        .persistent(false)
        .execute(pool)
        .await?;
    sqlx::query("CREATE INDEX IF NOT EXISTS idx_sponsorship_grants_active_range ON sponsorship_grants(starts_at, ends_at)")
        .persistent(false)
        .execute(pool)
        .await?;
    sqlx::query("CREATE INDEX IF NOT EXISTS idx_sponsorship_requests_status ON sponsorship_requests(status)")
        .persistent(false)
        .execute(pool)
        .await?;
    sqlx::query("CREATE INDEX IF NOT EXISTS idx_sponsorship_requests_created_at ON sponsorship_requests(created_at DESC)")
        .persistent(false)
        .execute(pool)
        .await?;

    SPONSORSHIP_TABLES_READY.store(true, Ordering::Relaxed);
    Ok(())
}

fn strip_nul_in_place(value: &mut String) {
    if value.as_bytes().contains(&0) {
        value.retain(|c| c != '\u{0000}');
    }
}

fn strip_nul_in_place_opt(value: &mut Option<String>) {
    if let Some(v) = value.as_mut() {
        strip_nul_in_place(v);
    }
}

fn strip_nul_str(value: &str) -> Cow<'_, str> {
    if value.as_bytes().contains(&0) {
        Cow::Owned(value.replace('\u{0000}', ""))
    } else {
        Cow::Borrowed(value)
    }
}

/**
 * normalize_base_url
 * 规范化站点 base url（去掉末尾的 /），便于拼接 path。
 */
fn normalize_base_url(raw: &str) -> String {
    raw.trim().trim_end_matches('/').to_string()
}

/**
 * build_product_detail_url
 * 生成产品详情页链接（前端路由：/products/[slug]，slug 使用产品 id）。
 */
fn build_product_detail_url(frontend_base_url: &str, locale: &str, product_id: &str) -> String {
    let base = normalize_base_url(frontend_base_url);
    let locale = locale.trim();
    let slug = urlencoding::encode(product_id);
    if locale.is_empty() {
        format!("{}/products/{}", base, slug)
    } else {
        format!("{}/{}/products/{}", base, urlencoding::encode(locale), slug)
    }
}

/**
 * compute_admin_review_token
 * 计算管理员邮件审核 token（HMAC-SHA256 + URL-safe base64，无 padding）。
 */
fn compute_admin_review_token(
    product_id: &str,
    action: &str,
    exp_ts: i64,
    secret: &str,
) -> Result<String> {
    type HmacSha256 = Hmac<Sha256>;
    let mut mac = HmacSha256::new_from_slice(secret.as_bytes())
        .map_err(|_| anyhow::anyhow!("Invalid ADMIN_REVIEW_TOKEN_SECRET"))?;
    mac.update(product_id.as_bytes());
    mac.update(b"|");
    mac.update(action.as_bytes());
    mac.update(b"|");
    mac.update(exp_ts.to_string().as_bytes());
    let bytes = mac.finalize().into_bytes();
    Ok(general_purpose::URL_SAFE_NO_PAD.encode(bytes))
}

/**
 * build_admin_review_url
 * 拼装管理员邮件一键审核链接（指向后端 /api/admin/review-product 接口）。
 */
fn build_admin_review_url(
    public_api_base_url: &str,
    product_id: &str,
    action: &str,
    exp_ts: i64,
    token: &str,
) -> String {
    let base = normalize_base_url(public_api_base_url);
    let pid_q = urlencoding::encode(product_id);
    let action_q = urlencoding::encode(action);
    let exp_s = exp_ts.to_string();
    let exp_q = urlencoding::encode(&exp_s);
    let sig_q = urlencoding::encode(token);
    format!(
        "{}/api/admin/review-product?product_id={}&action={}&exp={}&sig={}",
        base, pid_q, action_q, exp_q, sig_q
    )
}

/**
 * compute_newsletter_unsubscribe_token
 * 计算退订 token（HMAC-SHA256 + URL-safe base64，无 padding）。
 */
fn compute_newsletter_unsubscribe_token(email: &str, secret: &str) -> Result<String> {
    type HmacSha256 = Hmac<Sha256>;
    let mut mac = HmacSha256::new_from_slice(secret.as_bytes())
        .map_err(|_| anyhow::anyhow!("Invalid NEWSLETTER_TOKEN_SECRET"))?;
    mac.update(email.as_bytes());
    let bytes = mac.finalize().into_bytes();
    Ok(general_purpose::URL_SAFE_NO_PAD.encode(bytes))
}

/**
 * build_newsletter_unsubscribe_url
 * 拼装退订链接（指向后端 /api/newsletter/unsubscribe 接口）。
 */
fn build_newsletter_unsubscribe_url(public_api_base_url: &str, email: &str, token: &str) -> String {
    let base = normalize_base_url(public_api_base_url);
    let email_q = urlencoding::encode(email);
    let token_q = urlencoding::encode(token);
    format!(
        "{}/api/newsletter/unsubscribe?email={}&token={}",
        base, email_q, token_q
    )
}

/**
 * build_weekly_newsletter_content
 * 构建周报邮件内容（中英双语 + 产品详情链接 + 退订链接）。
 */
pub(crate) fn build_weekly_newsletter_content(
    now: chrono::DateTime<chrono::Utc>,
    since: chrono::DateTime<chrono::Utc>,
    products: &[NewsletterTopProductRow],
    frontend_base_url: &str,
    unsubscribe_url: &str,
) -> (String, String, String) {
    let subject = format!("SoloForge Weekly ({})", now.format("%Y-%m-%d"));

    let mut text = String::new();
    text.push_str(&format!(
        "SoloForge Weekly\nTime range: {} – {}\n\nTop 5 products this week:\n\n",
        since.format("%Y-%m-%d"),
        now.format("%Y-%m-%d")
    ));

    let mut html = String::new();
    let range_en = format!("{} – {}", since.format("%Y-%m-%d"), now.format("%Y-%m-%d"));

    html.push_str("<!doctype html><html><body style=\"margin:0;padding:0;background:#f6f7fb;\">");
    html.push_str("<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"background:#f6f7fb;padding:24px 0;\">");
    html.push_str("<tr><td align=\"center\" style=\"padding:0 12px;\">");
    html.push_str("<table role=\"presentation\" width=\"600\" cellpadding=\"0\" cellspacing=\"0\" style=\"width:100%;max-width:600px;background:#ffffff;border:1px solid #eaecef;border-radius:16px;overflow:hidden;\">");

    html.push_str("<tr><td style=\"padding:22px 24px;background:#111827;color:#ffffff;\">");
    html.push_str("<div style=\"font-size:18px;font-weight:700;letter-spacing:0.2px;\">SoloForge Weekly</div>");
    html.push_str(&format!(
        "<div style=\"margin-top:6px;font-size:12px;opacity:0.9;\">{}</div>",
        html_escape(&range_en)
    ));
    html.push_str("</td></tr>");

    html.push_str("<tr><td style=\"padding:22px 24px;\">");
    html.push_str("<div style=\"font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;line-height:1.6;color:#111827;\">");

    html.push_str("<h2 style=\"margin:0 0 6px 0;font-size:18px;\">SoloForge Weekly</h2>");
    html.push_str(&format!(
        "<div style=\"margin:0 0 14px 0;font-size:12px;color:#6b7280;\">Time range: {}</div>",
        html_escape(&range_en)
    ));
    html.push_str("<div style=\"font-size:14px;font-weight:700;margin:0 0 12px 0;\">Top 5 products this week</div>");

    for (idx, p) in products.iter().enumerate() {
        let n = idx + 1;
        let score = p.score;
        let likes = p.weekly_likes;
        let favorites = p.weekly_favorites;
        let website = p.website.trim();
        let detail_url_en = build_product_detail_url(frontend_base_url, "en", &p.id);

        html.push_str("<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"margin:0 0 12px 0;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;\">");
        html.push_str("<tr><td style=\"padding:14px 14px 12px 14px;\">");

        html.push_str("<div style=\"display:block;\">");
        html.push_str(&format!(
            "<span style=\"display:inline-block;min-width:22px;height:22px;line-height:22px;text-align:center;border-radius:999px;background:#eef2ff;color:#3730a3;font-size:12px;font-weight:700;margin-right:8px;\">{}</span>",
            n
        ));
        html.push_str(&format!(
            "<span style=\"font-size:15px;font-weight:800;\">{}</span>",
            html_escape(&p.name)
        ));
        html.push_str("</div>");

        if !p.slogan.trim().is_empty() {
            html.push_str(&format!(
                "<div style=\"margin-top:4px;font-size:13px;color:#4b5563;\">{}</div>",
                html_escape(&p.slogan)
            ));
        }

        text.push_str(&format!(
            "{}. {} - {}\nDetails: {}\nWebsite: {}\nWeekly score: {} (likes {} / favorites {})\nMaker: {} ({})\n\n",
            n,
            p.name,
            p.slogan,
            detail_url_en,
            website,
            score,
            likes,
            favorites,
            p.maker_name,
            p.maker_email
        ));

        html.push_str("<div style=\"margin-top:10px;\">");
        html.push_str(&format!(
            "<a href=\"{}\" target=\"_blank\" rel=\"noreferrer\" style=\"display:inline-block;padding:8px 12px;margin:0 8px 8px 0;background:#111827;color:#ffffff;text-decoration:none;border-radius:10px;font-size:12px;font-weight:700;\">View details</a>",
            html_attr_escape(&detail_url_en)
        ));
        if !website.is_empty() {
            html.push_str(&format!(
                "<a href=\"{}\" target=\"_blank\" rel=\"noreferrer\" style=\"display:inline-block;padding:8px 12px;margin:0 8px 8px 0;background:#ffffff;color:#111827;text-decoration:none;border:1px solid #e5e7eb;border-radius:10px;font-size:12px;font-weight:700;\">Visit website</a>",
                html_attr_escape(website)
            ));
        }
        html.push_str("</div>");

        html.push_str(&format!(
            "<div style=\"margin-top:6px;font-size:12px;color:#6b7280;\">Weekly score <strong style=\"color:#111827;\">{}</strong> · likes {} · favorites {}</div>",
            score, likes, favorites
        ));
        html.push_str(&format!(
            "<div style=\"margin-top:4px;font-size:12px;color:#6b7280;\">Maker: {} ({})</div>",
            html_escape(&p.maker_name),
            html_escape(&p.maker_email)
        ));

        html.push_str("</td></tr></table>");
    }

    text.push_str(&format!("Unsubscribe: {}\n", unsubscribe_url));

    html.push_str(&format!(
        "<div style=\"margin-top:14px;padding-top:14px;border-top:1px solid #e5e7eb;\"><div style=\"font-size:12px;color:#6b7280;\">Unsubscribe: <a href=\"{}\" target=\"_blank\" rel=\"noreferrer\" style=\"color:#111827;text-decoration:underline;\">click here</a></div></div>",
        html_attr_escape(unsubscribe_url)
    ));
    html.push_str("<div style=\"margin-top:16px;font-size:11px;color:#9ca3af;\">You are receiving this email because you subscribed to the SoloForge weekly brief.</div>");
    html.push_str("</div></td></tr>");
    html.push_str("</table></td></tr></table>");
    html.push_str("</body></html>");

    (subject, html, text)
}

fn html_escape(raw: &str) -> String {
    raw.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

fn html_attr_escape(raw: &str) -> String {
    html_escape(raw).replace(['\n', '\r'], " ")
}

async fn send_email_resend(
    client: &Client,
    api_key: &str,
    from: &str,
    to: &str,
    subject: &str,
    html: &str,
    text: &str,
) -> Result<()> {
    let payload = serde_json::json!({
        "from": from,
        "to": [to],
        "subject": subject,
        "html": html,
        "text": text
    });

    let resp = client
        .post("https://api.resend.com/emails")
        .bearer_auth(api_key)
        .json(&payload)
        .send()
        .await?;

    if resp.status().is_success() {
        return Ok(());
    }

    let status = resp.status();
    let body = resp.text().await.unwrap_or_default();
    Err(anyhow::anyhow!("Resend error: {} {}", status, body))
}

/**
 * build_admin_product_submission_email_content
 * 构建“产品提交待审核”的管理员通知邮件内容（包含一键通过/拒绝链接）。
 */
fn build_admin_product_submission_email_content(
    product: &Product,
    frontend_base_url: &str,
    public_api_base_url: &str,
    token_secret: &str,
) -> (String, String, String) {
    let subject = format!("New product submitted: {}", product.name.trim());

    let product_name = product.name.trim();
    let product_slogan = product.slogan.trim();
    let product_desc = product.description.trim();
    let product_website = product.website.trim();
    let maker_name = product.maker_name.trim();
    let maker_email = product.maker_email.trim();
    let category = product.category.trim();
    let product_id = product.id.trim();

    let detail_url = build_product_detail_url(frontend_base_url, "en", product_id);

    let exp_ts = (chrono::Utc::now() + chrono::Duration::days(7)).timestamp();
    let approve_token =
        compute_admin_review_token(product_id, "approve", exp_ts, token_secret).unwrap_or_default();
    let reject_token =
        compute_admin_review_token(product_id, "reject", exp_ts, token_secret).unwrap_or_default();
    let approve_url = if !approve_token.trim().is_empty() {
        build_admin_review_url(
            public_api_base_url,
            product_id,
            "approve",
            exp_ts,
            &approve_token,
        )
    } else {
        String::new()
    };
    let reject_url = if !reject_token.trim().is_empty() {
        build_admin_review_url(
            public_api_base_url,
            product_id,
            "reject",
            exp_ts,
            &reject_token,
        )
    } else {
        String::new()
    };

    let mut text = String::new();
    text.push_str("New product submitted (pending review)\n\n");
    text.push_str(&format!("Name: {}\n", product_name));
    if !product_slogan.is_empty() {
        text.push_str(&format!("Slogan: {}\n", product_slogan));
    }
    text.push_str(&format!("Category: {}\n", category));
    text.push_str(&format!("Website: {}\n", product_website));
    text.push_str(&format!("Maker: {} ({})\n", maker_name, maker_email));
    text.push_str(&format!("Product ID: {}\n", product_id));
    text.push_str(&format!("Details: {}\n", detail_url));
    if !approve_url.is_empty() && !reject_url.is_empty() {
        text.push_str(&format!(
            "\nApprove: {}\nReject: {}\n",
            approve_url, reject_url
        ));
    } else {
        text.push_str(
            "\nOne-click review links are not configured (missing ADMIN_REVIEW_TOKEN_SECRET).\n",
        );
    }

    let mut html = String::new();
    html.push_str("<!doctype html><html><body style=\"margin:0;padding:0;background:#f6f7fb;\">");
    html.push_str("<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"background:#f6f7fb;padding:24px 0;\">");
    html.push_str("<tr><td align=\"center\" style=\"padding:0 12px;\">");
    html.push_str("<table role=\"presentation\" width=\"640\" cellpadding=\"0\" cellspacing=\"0\" style=\"width:100%;max-width:640px;background:#ffffff;border:1px solid #eaecef;border-radius:16px;overflow:hidden;\">");
    html.push_str("<tr><td style=\"padding:18px 22px;background:#111827;color:#ffffff;\">");
    html.push_str(
        "<div style=\"font-size:16px;font-weight:800;\">SoloForge · Product Review</div>",
    );
    html.push_str("<div style=\"margin-top:6px;font-size:12px;opacity:0.9;\">A new product is waiting for approval</div>");
    html.push_str("</td></tr>");

    html.push_str("<tr><td style=\"padding:18px 22px;\">");
    html.push_str("<div style=\"font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;line-height:1.6;color:#111827;\">");
    html.push_str(&format!(
        "<div style=\"font-size:18px;font-weight:800;margin:0 0 6px 0;\">{}</div>",
        html_escape(product_name)
    ));
    if !product_slogan.is_empty() {
        html.push_str(&format!(
            "<div style=\"font-size:13px;color:#4b5563;margin:0 0 10px 0;\">{}</div>",
            html_escape(product_slogan)
        ));
    }

    html.push_str("<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;\">");
    html.push_str("<tr><td style=\"padding:12px 14px;\">");
    html.push_str(&format!(
        "<div style=\"font-size:12px;color:#6b7280;\">Category</div><div style=\"font-size:14px;font-weight:700;\">{}</div>",
        html_escape(category)
    ));
    html.push_str("</td></tr>");
    html.push_str("<tr><td style=\"padding:0 14px 12px 14px;\">");
    html.push_str(&format!(
        "<div style=\"font-size:12px;color:#6b7280;\">Maker</div><div style=\"font-size:14px;font-weight:700;\">{} ({})</div>",
        html_escape(maker_name),
        html_escape(maker_email)
    ));
    html.push_str("</td></tr>");
    html.push_str("<tr><td style=\"padding:0 14px 12px 14px;\">");
    html.push_str(&format!(
        "<div style=\"font-size:12px;color:#6b7280;\">Website</div><div style=\"font-size:14px;font-weight:700;\"><a href=\"{}\" target=\"_blank\" rel=\"noreferrer\" style=\"color:#111827;text-decoration:underline;\">{}</a></div>",
        html_attr_escape(product_website),
        html_escape(product_website)
    ));
    html.push_str("</td></tr>");
    html.push_str("<tr><td style=\"padding:0 14px 14px 14px;\">");
    html.push_str(&format!(
        "<div style=\"font-size:12px;color:#6b7280;\">Product ID</div><div style=\"font-size:13px;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;\">{}</div>",
        html_escape(product_id)
    ));
    html.push_str("</td></tr></table>");

    if !product_desc.is_empty() {
        let clipped: String = product_desc.chars().take(600).collect();
        html.push_str("<div style=\"margin-top:14px;\">");
        html.push_str(
            "<div style=\"font-size:12px;color:#6b7280;margin-bottom:6px;\">Description</div>",
        );
        html.push_str(&format!(
            "<div style=\"font-size:13px;color:#111827;background:#f9fafb;border:1px solid #e5e7eb;border-radius:12px;padding:12px 14px;white-space:pre-wrap;\">{}</div>",
            html_escape(&clipped)
        ));
        html.push_str("</div>");
    }

    html.push_str("<div style=\"margin-top:14px;\">");
    html.push_str(&format!(
        "<a href=\"{}\" target=\"_blank\" rel=\"noreferrer\" style=\"display:inline-block;padding:10px 12px;margin:0 10px 10px 0;background:#111827;color:#ffffff;text-decoration:none;border-radius:10px;font-size:12px;font-weight:800;\">View detail page</a>",
        html_attr_escape(&detail_url)
    ));

    if !approve_url.is_empty() && !reject_url.is_empty() {
        html.push_str(&format!(
            "<a href=\"{}\" target=\"_blank\" rel=\"noreferrer\" style=\"display:inline-block;padding:10px 12px;margin:0 10px 10px 0;background:#16a34a;color:#ffffff;text-decoration:none;border-radius:10px;font-size:12px;font-weight:800;\">Approve</a>",
            html_attr_escape(&approve_url)
        ));
        html.push_str(&format!(
            "<a href=\"{}\" target=\"_blank\" rel=\"noreferrer\" style=\"display:inline-block;padding:10px 12px;margin:0 10px 10px 0;background:#dc2626;color:#ffffff;text-decoration:none;border-radius:10px;font-size:12px;font-weight:800;\">Reject</a>",
            html_attr_escape(&reject_url)
        ));
    } else {
        html.push_str("<div style=\"margin-top:8px;font-size:12px;color:#6b7280;\">One-click review links are not configured. Set ADMIN_REVIEW_TOKEN_SECRET to enable.</div>");
    }
    html.push_str("</div>");

    html.push_str("<div style=\"margin-top:16px;font-size:11px;color:#9ca3af;\">This message is sent automatically when a product is submitted.</div>");
    html.push_str("</div></td></tr>");
    html.push_str("</table></td></tr></table>");
    html.push_str("</body></html>");

    (subject, html, text)
}

fn sanitize_create_product_request(product: &mut CreateProductRequest) {
    strip_nul_in_place(&mut product.name);
    strip_nul_in_place(&mut product.slogan);
    strip_nul_in_place(&mut product.description);
    strip_nul_in_place(&mut product.website);
    strip_nul_in_place_opt(&mut product.logo_url);
    strip_nul_in_place(&mut product.category);
    for tag in &mut product.tags {
        strip_nul_in_place(tag);
    }
    strip_nul_in_place(&mut product.maker_name);
    strip_nul_in_place(&mut product.maker_email);
    product.maker_email = product.maker_email.trim().to_ascii_lowercase();
    strip_nul_in_place_opt(&mut product.maker_website);
    strip_nul_in_place(&mut product.language);
}

fn sanitize_update_product_request(updates: &mut UpdateProductRequest) {
    if let Some(v) = updates.name.as_mut() {
        strip_nul_in_place(v);
    }
    if let Some(v) = updates.slogan.as_mut() {
        strip_nul_in_place(v);
    }
    if let Some(v) = updates.description.as_mut() {
        strip_nul_in_place(v);
    }
    if let Some(v) = updates.website.as_mut() {
        strip_nul_in_place(v);
    }
    if let Some(v) = updates.logo_url.as_mut() {
        strip_nul_in_place(v);
    }
    if let Some(v) = updates.category.as_mut() {
        strip_nul_in_place(v);
    }
    if let Some(tags) = updates.tags.as_mut() {
        for tag in tags {
            strip_nul_in_place(tag);
        }
    }
    if let Some(v) = updates.rejection_reason.as_mut() {
        strip_nul_in_place(v);
    }
}

fn sanitize_categories(categories: &mut [Category]) {
    for c in categories {
        strip_nul_in_place(&mut c.id);
        strip_nul_in_place(&mut c.name_en);
        strip_nul_in_place(&mut c.name_zh);
        strip_nul_in_place(&mut c.icon);
        strip_nul_in_place(&mut c.color);
    }
}

/**
 * map_product_row
 * 将 ProductRow 转换为对外 API 使用的 Product 结构。
 */
fn map_product_row(row: ProductRow) -> Product {
    let mut maker_sponsor_role = row.maker_sponsor_role;
    strip_nul_in_place_opt(&mut maker_sponsor_role);
    Product {
        id: row.id,
        name: row.name,
        slogan: row.slogan,
        description: row.description,
        website: row.website,
        logo_url: row.logo_url,
        category: row.category,
        tags: row.tags,
        maker_name: row.maker_name,
        maker_email: row.maker_email,
        maker_website: row.maker_website,
        maker_sponsor_role,
        maker_sponsor_verified: row.maker_sponsor_verified,
        language: row.language,
        status: parse_product_status(&row.status),
        rejection_reason: row.rejection_reason,
        created_at: row.created_at,
        updated_at: row.updated_at,
        likes: row.likes,
        favorites: row.favorites,
    }
}

/**
 * map_category_row
 * 将 CategoryRow 转换为对外 API 使用的 Category 结构。
 */
fn map_category_row(row: CategoryRow) -> Category {
    let name_en = row.name_en;
    let name_zh = row.name_zh.unwrap_or_else(|| name_en.clone());
    Category {
        id: row.id,
        name_en,
        name_zh,
        icon: row.icon,
        color: row.color,
    }
}

fn map_category_with_count_row(row: CategoryWithCountRow) -> crate::models::CategoryWithCount {
    let name_en = row.name_en;
    let name_zh = row.name_zh.unwrap_or_else(|| name_en.clone());
    crate::models::CategoryWithCount {
        id: row.id,
        name_en,
        name_zh,
        icon: row.icon,
        color: row.color,
        product_count: row.product_count,
    }
}

fn map_developer_row(row: DeveloperRow) -> Developer {
    let mut email = row.email;
    let mut name = row.name;
    let mut avatar_url = row.avatar_url;
    let mut website = row.website;
    let mut sponsor_role = row.sponsor_role;
    strip_nul_in_place(&mut email);
    strip_nul_in_place(&mut name);
    strip_nul_in_place_opt(&mut avatar_url);
    strip_nul_in_place_opt(&mut website);
    strip_nul_in_place_opt(&mut sponsor_role);
    Developer {
        email,
        name,
        avatar_url,
        website,
        sponsor_role,
        sponsor_verified: row.sponsor_verified,
    }
}

fn map_developer_with_followers_row(row: DeveloperWithFollowersRow) -> DeveloperWithFollowers {
    let mut email = row.email;
    let mut name = row.name;
    let mut avatar_url = row.avatar_url;
    let mut website = row.website;
    let mut sponsor_role = row.sponsor_role;
    strip_nul_in_place(&mut email);
    strip_nul_in_place(&mut name);
    strip_nul_in_place_opt(&mut avatar_url);
    strip_nul_in_place_opt(&mut website);
    strip_nul_in_place_opt(&mut sponsor_role);
    DeveloperWithFollowers {
        email,
        name,
        avatar_url,
        website,
        sponsor_role,
        sponsor_verified: row.sponsor_verified,
        followers: row.followers.parse::<i64>().unwrap_or(0),
    }
}

fn map_developer_popularity_row(row: DeveloperPopularityRow) -> DeveloperPopularity {
    let mut email = row.email;
    let mut name = row.name;
    let mut avatar_url = row.avatar_url;
    let mut website = row.website;
    let mut sponsor_role = row.sponsor_role;
    strip_nul_in_place(&mut email);
    strip_nul_in_place(&mut name);
    strip_nul_in_place_opt(&mut avatar_url);
    strip_nul_in_place_opt(&mut website);
    strip_nul_in_place_opt(&mut sponsor_role);
    DeveloperPopularity {
        email,
        name,
        avatar_url,
        website,
        sponsor_role,
        sponsor_verified: row.sponsor_verified,
        likes: row.likes,
        favorites: row.favorites,
        score: row.score,
    }
}

fn map_developer_center_stats_row(row: DeveloperCenterStatsRow) -> DeveloperCenterStats {
    DeveloperCenterStats {
        followers: row.followers,
        total_likes: row.total_likes,
        total_favorites: row.total_favorites,
    }
}

fn parse_supabase_content_range_total(value: &str) -> Option<i64> {
    let after_slash = value.rsplit('/').next()?;
    if after_slash.trim() == "*" {
        return Some(0);
    }
    after_slash.trim().parse::<i64>().ok()
}

async fn supabase_count(
    supabase: &SupabaseDatabase,
    table: &str,
    query: &[(&str, String)],
) -> Result<i64> {
    let mut url = Url::parse(&format!("{}/rest/v1/{}", supabase.supabase_url, table))?;
    {
        let mut qp = url.query_pairs_mut();
        for (k, v) in query {
            qp.append_pair(k, v);
        }
        qp.append_pair("limit", "1");
    }

    let response = supabase
        .client
        .get(url)
        .header("apikey", &supabase.supabase_key)
        .header(
            "Authorization",
            &format!("Bearer {}", supabase.supabase_key),
        )
        .header("Accept", "application/json")
        .header("Prefer", "count=exact")
        .send()
        .await?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(anyhow::anyhow!(
            "Failed to fetch count from {}: {}. Body: {}",
            table,
            status,
            body
        ));
    }

    let total = response
        .headers()
        .get("content-range")
        .and_then(|v| v.to_str().ok())
        .and_then(parse_supabase_content_range_total)
        .unwrap_or(0);

    Ok(total)
}

fn split_sql_statements(input: &str) -> Vec<String> {
    let bytes = input.as_bytes();
    let mut statements: Vec<String> = Vec::new();
    let mut current = String::new();

    let mut i: usize = 0;
    let mut in_single = false;
    let mut in_double = false;
    let mut dollar_delim: Option<String> = None;

    while i < bytes.len() {
        if dollar_delim.is_none() && !in_single && !in_double {
            if bytes[i] == b'-' && i + 1 < bytes.len() && bytes[i + 1] == b'-' {
                i += 2;
                while i < bytes.len() && bytes[i] != b'\n' {
                    i += 1;
                }
                continue;
            }

            if bytes[i] == b'/' && i + 1 < bytes.len() && bytes[i + 1] == b'*' {
                i += 2;
                while i + 1 < bytes.len() && !(bytes[i] == b'*' && bytes[i + 1] == b'/') {
                    i += 1;
                }
                if i + 1 < bytes.len() {
                    i += 2;
                }
                continue;
            }
        }

        if let Some(delim) = &dollar_delim {
            if input[i..].starts_with(delim) {
                current.push_str(delim);
                i += delim.len();
                dollar_delim = None;
                continue;
            }
            current.push(bytes[i] as char);
            i += 1;
            continue;
        }

        if !in_double && bytes[i] == b'\'' {
            if in_single && i + 1 < bytes.len() && bytes[i + 1] == b'\'' {
                current.push('\'');
                current.push('\'');
                i += 2;
                continue;
            }
            in_single = !in_single;
            current.push('\'');
            i += 1;
            continue;
        }

        if !in_single && bytes[i] == b'"' {
            if in_double && i + 1 < bytes.len() && bytes[i + 1] == b'"' {
                current.push('"');
                current.push('"');
                i += 2;
                continue;
            }
            in_double = !in_double;
            current.push('"');
            i += 1;
            continue;
        }

        if !in_single && !in_double && bytes[i] == b'$' {
            let mut j = i + 1;
            while j < bytes.len()
                && bytes[j] != b'$'
                && (bytes[j].is_ascii_alphanumeric() || bytes[j] == b'_')
            {
                j += 1;
            }
            if j < bytes.len() && bytes[j] == b'$' {
                let delim = &input[i..=j];
                dollar_delim = Some(delim.to_string());
                current.push_str(delim);
                i = j + 1;
                continue;
            }
        }

        if !in_single && !in_double && bytes[i] == b';' {
            let stmt = current.trim();
            if !stmt.is_empty() {
                statements.push(stmt.to_string());
            }
            current.clear();
            i += 1;
            continue;
        }

        current.push(bytes[i] as char);
        i += 1;
    }

    let tail = current.trim();
    if !tail.is_empty() {
        statements.push(tail.to_string());
    }

    statements
}

impl Database {
    pub fn new() -> Self {
        let supabase = match (env::var("SUPABASE_URL").ok(), env::var("SUPABASE_KEY").ok()) {
            (Some(supabase_url), Some(supabase_key)) => {
                let supabase_url = supabase_url.trim_end_matches('/').to_string();

                let client_builder = Client::builder()
                    .connect_timeout(Duration::from_secs(3))
                    .timeout(Duration::from_secs(8))
                    .http1_only();

                let client = client_builder.build().expect("Failed to build HTTP client");
                Some(SupabaseDatabase {
                    client,
                    supabase_url,
                    supabase_key,
                })
            }
            _ => None,
        };

        let postgres = env::var("DATABASE_URL").ok().and_then(|u| {
            let options = PgConnectOptions::from_str(&u).ok()?;
            let options = options.statement_cache_capacity(0);
            Some(
                PgPoolOptions::new()
                    .max_connections(15)
                    .min_connections(1)
                    .acquire_timeout(Duration::from_secs(8))
                    .test_before_acquire(true)
                    .after_connect(|conn, _meta| {
                        Box::pin(async move {
                            sqlx::query("SET statement_timeout = 15000")
                                .persistent(false)
                                .execute(conn)
                                .await?;
                            Ok(())
                        })
                    })
                    .connect_lazy_with(options),
            )
        });

        if postgres.is_none() && supabase.is_none() {
            panic!("DATABASE_URL or (SUPABASE_URL + SUPABASE_KEY) must be set");
        }

        Self { postgres, supabase }
    }

    pub async fn get_developer_by_email(&self, email: &str) -> Result<Option<Developer>> {
        if let Some(pool) = &self.postgres {
            let email = strip_nul_str(email);
            let mut last_err: Option<anyhow::Error> = None;
            for attempt_idx in 0..2 {
                let attempt = sqlx::query_as::<_, DeveloperRow>(
                    "SELECT email, name, avatar_url, website, sponsor_role, sponsor_verified \
                     FROM developers \
                     WHERE lower(email) = lower($1) \
                     ORDER BY updated_at DESC NULLS LAST \
                     LIMIT 1",
                )
                .persistent(false)
                .bind(email.as_ref())
                .fetch_optional(pool)
                .await;

                match attempt {
                    Ok(row) => return Ok(row.map(map_developer_row)),
                    Err(e) => {
                        let e: anyhow::Error = e.into();
                        if (is_missing_column_error(&e, "sponsor_role")
                            || is_missing_column_error(&e, "sponsor_verified"))
                            && !DEVELOPERS_SPONSOR_COLUMNS_READY.load(Ordering::Relaxed)
                            && ensure_developers_sponsor_columns(pool).await.is_ok()
                        {
                            continue;
                        }
                        last_err = Some(e);
                        let Some(ref err) = last_err else {
                            continue;
                        };
                        if is_retryable_db_error(err) && self.supabase.is_some() {
                            break;
                        }
                        if attempt_idx == 0 && is_retryable_db_error(err) {
                            continue;
                        }
                        return Err(last_err.unwrap());
                    }
                }
            }

            if let Some(e) = last_err {
                if !(is_retryable_db_error(&e) && self.supabase.is_some()) {
                    return Err(e);
                }
            }
        }

        let supabase = match &self.supabase {
            Some(v) => v,
            None => return Ok(None),
        };

        let email = strip_nul_str(email);
        let mut url = Url::parse(&format!("{}/rest/v1/developers", supabase.supabase_url))?;
        url.query_pairs_mut()
            .append_pair(
                "select",
                "email,name,avatar_url,website,sponsor_role,sponsor_verified",
            )
            .append_pair("email", &format!("eq.{}", email));

        let response = supabase
            .client
            .get(url)
            .header("apikey", &supabase.supabase_key)
            .header(
                "Authorization",
                &format!("Bearer {}", supabase.supabase_key),
            )
            .header("Accept", "application/json")
            .send()
            .await?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(anyhow::anyhow!(
                "Failed to fetch developer: {}. Body: {}",
                status,
                body
            ));
        }

        let developers: Vec<Developer> = response.json().await?;
        Ok(developers.first().cloned())
    }

    pub async fn update_developer_profile(
        &self,
        email: &str,
        name: Option<String>,
        avatar_url: Option<Option<String>>,
        website: Option<Option<String>>,
    ) -> Result<Developer> {
        let name_update = name.is_some();
        let avatar_update = avatar_url.is_some();
        let website_update = website.is_some();

        let email_clean = strip_nul_str(email);
        let name_value = name.clone().unwrap_or_else(|| email_clean.to_string());
        let name_value = strip_nul_str(&name_value).into_owned();
        let avatar_value = avatar_url
            .clone()
            .and_then(|v| v)
            .map(|v| strip_nul_str(&v).into_owned());
        let website_value = website
            .clone()
            .and_then(|v| v)
            .map(|v| strip_nul_str(&v).into_owned());

        if let Some(pool) = &self.postgres {
            let mut last_err: Option<anyhow::Error> = None;
            for attempt_idx in 0..2 {
                let attempt: Result<Developer> = async {
                    let row = sqlx::query_as::<_, DeveloperRow>(
                        "INSERT INTO developers (email, name, avatar_url, website) \
                         VALUES ($1, $2, $3, $4) \
                         ON CONFLICT (email) DO UPDATE SET \
                            name = CASE WHEN $5 THEN EXCLUDED.name ELSE developers.name END, \
                            avatar_url = CASE WHEN $6 THEN EXCLUDED.avatar_url ELSE developers.avatar_url END, \
                            website = CASE WHEN $7 THEN EXCLUDED.website ELSE developers.website END, \
                            updated_at = NOW() \
                         RETURNING email, name, avatar_url, website, sponsor_role, sponsor_verified",
                    )
                    .persistent(false)
                    .bind(email_clean.as_ref())
                    .bind(name_value.as_str())
                    .bind(avatar_value.as_deref())
                    .bind(website_value.as_deref())
                    .bind(name_update)
                    .bind(avatar_update)
                    .bind(website_update)
                    .fetch_one(pool)
                    .await?;

                    Ok(map_developer_row(row))
                }
                .await;

                match attempt {
                    Ok(dev) => return Ok(dev),
                    Err(e) => {
                        if (is_missing_column_error(&e, "sponsor_role")
                            || is_missing_column_error(&e, "sponsor_verified"))
                            && !DEVELOPERS_SPONSOR_COLUMNS_READY.load(Ordering::Relaxed)
                            && ensure_developers_sponsor_columns(pool).await.is_ok()
                        {
                            continue;
                        }
                        last_err = Some(e);
                        let Some(ref err) = last_err else {
                            continue;
                        };
                        if is_retryable_db_error(err) && self.supabase.is_some() {
                            break;
                        }
                        if attempt_idx == 0 && is_retryable_db_error(err) {
                            continue;
                        }
                        return Err(last_err.unwrap());
                    }
                }
            }

            if let Some(e) = last_err {
                if !(is_retryable_db_error(&e) && self.supabase.is_some()) {
                    return Err(e);
                }
            }
        }

        let supabase = self
            .supabase
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("No database configured"))?;

        let name_value_raw = name_value.as_str().to_string();
        let name_value = strip_nul_str(&name_value_raw).into_owned();

        let mut payload = serde_json::Map::<String, serde_json::Value>::new();
        payload.insert(
            "email".to_string(),
            serde_json::Value::String(email_clean.to_string()),
        );
        let exists = self.get_developer_by_email(email).await?.is_some();
        if name_update || !exists {
            payload.insert("name".to_string(), serde_json::Value::String(name_value));
        }

        if let Some(v) = avatar_url {
            match v {
                Some(s) => payload.insert("avatar_url".to_string(), serde_json::Value::String(s)),
                None => payload.insert("avatar_url".to_string(), serde_json::Value::Null),
            };
        }
        if let Some(v) = website {
            match v {
                Some(s) => payload.insert("website".to_string(), serde_json::Value::String(s)),
                None => payload.insert("website".to_string(), serde_json::Value::Null),
            };
        }

        let mut url = Url::parse(&format!("{}/rest/v1/developers", supabase.supabase_url))?;
        url.query_pairs_mut().append_pair("on_conflict", "email");

        let response = supabase
            .client
            .post(url)
            .header("apikey", &supabase.supabase_key)
            .header(
                "Authorization",
                &format!("Bearer {}", supabase.supabase_key),
            )
            .header("Accept", "application/json")
            .header(
                "Prefer",
                "resolution=merge-duplicates,return=representation",
            )
            .json(&serde_json::Value::Object(payload))
            .send()
            .await?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(anyhow::anyhow!(
                "Failed to update developer: {}. Body: {}",
                status,
                body
            ));
        }

        let returned: Vec<Developer> = response.json().await?;
        returned
            .first()
            .cloned()
            .ok_or_else(|| anyhow::anyhow!("Invalid response from database"))
    }

    async fn upsert_developer_pg(
        &self,
        pool: &PgPool,
        email: &str,
        name: &str,
        website: Option<&String>,
    ) -> Result<()> {
        let email = strip_nul_str(email);
        let name = strip_nul_str(name);
        let website = website.map(|v| strip_nul_str(v).into_owned());
        sqlx::query(
            "INSERT INTO developers (email, name, website) \
             VALUES ($1, $2, $3) \
             ON CONFLICT (email) DO UPDATE SET \
                name = EXCLUDED.name, \
                website = COALESCE(EXCLUDED.website, developers.website), \
                updated_at = NOW()",
        )
        .persistent(false)
        .bind(email.as_ref())
        .bind(name.as_ref())
        .bind(website.as_deref())
        .execute(pool)
        .await?;
        Ok(())
    }

    pub async fn get_products(&self, params: QueryParams) -> Result<Vec<Product>> {
        if let Some(pool) = &self.postgres {
            let mut last_err: Option<anyhow::Error> = None;
            for attempt in 0..2 {
                let attempt_result: Result<Vec<Product>> = async {
                    let mut tx = pool.begin().await?;
                    let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
                        "SELECT \
                            p.id::text as id, \
                            p.name, \
                            p.slogan, \
                            p.description, \
                            p.website, \
                            p.logo_url, \
                            p.category, \
                            COALESCE(p.tags, ARRAY[]::text[]) as tags, \
                            p.maker_name, \
                            p.maker_email, \
                            p.maker_website, \
                            p.language, \
                            p.status::text as status, \
                            p.rejection_reason, \
                            p.created_at, \
                            p.updated_at, \
                            (SELECT COUNT(*)::bigint FROM product_likes l WHERE l.product_id = p.id) as likes, \
                            (SELECT COUNT(*)::bigint FROM product_favorites f WHERE f.product_id = p.id) as favorites, \
                            COALESCE(d.sponsor_role, NULL::text) as maker_sponsor_role, \
                            COALESCE(d.sponsor_verified, FALSE) as maker_sponsor_verified \
                         FROM products p \
                         LEFT JOIN developers d ON lower(d.email) = lower(p.maker_email)",
                    );

                    qb.push(" WHERE 1=1");
                    if let Some(category) = &params.category {
                        qb.push(" AND ");
                        qb.push("p.category = ");
                        qb.push_bind(category);
                    }

                    if let Some(language) = &params.language {
                        qb.push(" AND ");
                        qb.push("p.language = ");
                        qb.push_bind(language);
                    }

                    if let Some(status) = &params.status {
                        qb.push(" AND ");
                        if dev_include_pending_in_approved() && status == "approved" {
                            qb.push("p.status::text IN ('approved','pending')");
                        } else {
                            qb.push("p.status::text = ");
                            qb.push_bind(status);
                        }
                    }

                    if let Some(search) = &params.search {
                        let q = format!("%{}%", search);
                        qb.push(" AND ");
                        qb.push("(p.name ILIKE ");
                        qb.push_bind(q.clone());
                        qb.push(" OR p.slogan ILIKE ");
                        qb.push_bind(q.clone());
                        qb.push(" OR p.description ILIKE ");
                        qb.push_bind(q.clone());
                        qb.push(" OR p.maker_name ILIKE ");
                        qb.push_bind(q.clone());
                        qb.push(" OR p.maker_email ILIKE ");
                        qb.push_bind(q);
                        qb.push(")");
                    }

                    if let Some(tags) = &params.tags {
                        let tag = tags.split(',').next().unwrap_or(tags).trim();
                        if !tag.is_empty() {
                            qb.push(" AND ");
                            qb.push("p.tags @> ARRAY[");
                            qb.push_bind(tag);
                            qb.push("]::text[]");
                        }
                    }

                    if let Some(maker_email) = &params.maker_email {
                        let normalized = maker_email.trim().to_ascii_lowercase();
                        if !normalized.is_empty() {
                            qb.push(" AND lower(p.maker_email) = lower(");
                            qb.push_bind(normalized);
                            qb.push(")");
                        }
                    }

                    let sort_by = params
                        .sort
                        .as_deref()
                        .unwrap_or("created_at")
                        .trim()
                        .to_ascii_lowercase();
                    let sort_dir = params
                        .dir
                        .as_deref()
                        .unwrap_or("desc")
                        .trim()
                        .to_ascii_lowercase();
                    let asc = sort_dir == "asc" || sort_dir == "ascending";

                    qb.push(" ORDER BY ");
                    if sort_by.as_str() == "likes" {
                        qb.push("(SELECT COUNT(*)::bigint FROM product_likes l WHERE l.product_id = p.id)");
                    } else if sort_by.as_str() == "favorites" {
                        qb.push(
                            "(SELECT COUNT(*)::bigint FROM product_favorites f WHERE f.product_id = p.id)",
                        );
                    } else if sort_by.as_str() == "popularity"
                        || sort_by.as_str() == "score"
                        || sort_by.as_str() == "featured"
                    {
                        qb.push("((");
                        qb.push("(SELECT COUNT(*)::bigint FROM product_likes l WHERE l.product_id = p.id)");
                        qb.push(") + (");
                        qb.push(
                            "(SELECT COUNT(*)::bigint FROM product_favorites f WHERE f.product_id = p.id)",
                        );
                        qb.push("))");
                    } else {
                        qb.push("p.created_at");
                    }
                    if asc {
                        qb.push(" ASC");
                    } else {
                        qb.push(" DESC");
                    }
                    qb.push(", p.created_at DESC, p.id ASC");

                    if let Some(limit) = params.limit {
                        qb.push(" LIMIT ");
                        qb.push_bind(limit);
                    }

                    if let Some(offset) = params.offset {
                        qb.push(" OFFSET ");
                        qb.push_bind(offset);
                    }

                    let rows = qb
                        .build_query_as::<ProductRow>()
                        .persistent(false)
                        .fetch_all(&mut *tx)
                        .await?;
                    tx.commit().await?;
                    Ok(rows.into_iter().map(map_product_row).collect())
                }
                .await;

                match attempt_result {
                    Ok(list) => return Ok(list),
                    Err(e) => {
                        if is_missing_column_error(&e, "rejection_reason")
                            && !PRODUCTS_REJECTION_REASON_READY.load(Ordering::Relaxed)
                            && ensure_products_rejection_reason_column(pool).await.is_ok()
                        {
                            continue;
                        }
                        if (is_missing_column_error(&e, "sponsor_role")
                            || is_missing_column_error(&e, "sponsor_verified"))
                            && !DEVELOPERS_SPONSOR_COLUMNS_READY.load(Ordering::Relaxed)
                            && ensure_developers_sponsor_columns(pool).await.is_ok()
                        {
                            continue;
                        }
                        last_err = Some(e);
                        let Some(ref err) = last_err else {
                            continue;
                        };
                        if is_retryable_db_error(err) && self.supabase.is_some() {
                            break;
                        }
                        if attempt == 0 && is_retryable_db_error(err) {
                            continue;
                        }
                        return Err(last_err.unwrap());
                    }
                }
            }

            if let Some(e) = last_err {
                if !(is_retryable_db_error(&e) && self.supabase.is_some()) {
                    return Err(e);
                }
            }
        }

        let supabase = self
            .supabase
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("No database configured"))?;

        let mut url = Url::parse(&format!("{}/rest/v1/products", supabase.supabase_url))?;
        {
            let mut qp = url.query_pairs_mut();

            if let Some(category) = &params.category {
                qp.append_pair("category", &format!("eq.{}", category));
            }

            if let Some(language) = &params.language {
                qp.append_pair("language", &format!("eq.{}", language));
            }

            if let Some(status) = &params.status {
                if dev_include_pending_in_approved() && status == "approved" {
                    qp.append_pair("status", "in.(approved,pending)");
                } else {
                    qp.append_pair("status", &format!("eq.{}", status));
                }
            }

            if let Some(tags) = &params.tags {
                let tag = tags.split(',').next().unwrap_or(tags).trim();
                if !tag.is_empty() {
                    qp.append_pair("tags", &format!("cs.{{{}}}", tag));
                }
            }

            if let Some(search) = &params.search {
                qp.append_pair("name", &format!("ilike.%{}%", search));
                qp.append_pair("slogan", &format!("ilike.%{}%", search));
                qp.append_pair("description", &format!("ilike.%{}%", search));
            }

            if let Some(maker_email) = &params.maker_email {
                let normalized = maker_email.trim().to_ascii_lowercase();
                if !normalized.is_empty() {
                    qp.append_pair("maker_email", &format!("eq.{}", normalized));
                }
            }

            if let Some(limit) = params.limit {
                qp.append_pair("limit", &limit.to_string());
            }

            if let Some(offset) = params.offset {
                qp.append_pair("offset", &offset.to_string());
            }

            let sort_by = params
                .sort
                .as_deref()
                .unwrap_or("created_at")
                .trim()
                .to_ascii_lowercase();
            let sort_dir = params
                .dir
                .as_deref()
                .unwrap_or("desc")
                .trim()
                .to_ascii_lowercase();
            let asc = sort_dir == "asc" || sort_dir == "ascending";

            let order_value = if sort_by == "created_at" {
                if asc {
                    "created_at.asc"
                } else {
                    "created_at.desc"
                }
            } else {
                "created_at.desc"
            };
            qp.append_pair("order", order_value);
        }

        let response = supabase
            .client
            .get(url)
            .header("apikey", &supabase.supabase_key)
            .header(
                "Authorization",
                &format!("Bearer {}", supabase.supabase_key),
            )
            .header("Accept", "application/json")
            .send()
            .await?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();

            if status.as_u16() == 401 || status.as_u16() == 403 {
                return Err(anyhow::anyhow!(
                    "Supabase auth failed: {}. Check SUPABASE_KEY. Body: {}",
                    status,
                    body
                ));
            }

            return Err(anyhow::anyhow!(
                "Failed to fetch products: {}. Body: {}",
                status,
                body
            ));
        }

        let products: Vec<Product> = response.json().await?;
        Ok(products)
    }

    pub async fn get_products_by_ids(&self, ids: &[String]) -> Result<Vec<Product>> {
        if ids.is_empty() {
            return Ok(Vec::new());
        }

        if let Some(pool) = &self.postgres {
            let mut last_err: Option<anyhow::Error> = None;
            for attempt in 0..2 {
                let attempt_result: Result<Vec<ProductRow>> = async {
                    let mut tx = pool.begin().await?;
                    let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
                        "SELECT \
                            p.id::text as id, \
                            p.name, \
                            p.slogan, \
                            p.description, \
                            p.website, \
                            p.logo_url, \
                            p.category, \
                            COALESCE(p.tags, ARRAY[]::text[]) as tags, \
                            p.maker_name, \
                            p.maker_email, \
                            p.maker_website, \
                            p.language, \
                            p.status::text as status, \
                            p.rejection_reason, \
                            p.created_at, \
                            p.updated_at, \
                            (SELECT COUNT(*)::bigint FROM product_likes l WHERE l.product_id = p.id) as likes, \
                            (SELECT COUNT(*)::bigint FROM product_favorites f WHERE f.product_id = p.id) as favorites, \
                            COALESCE(d.sponsor_role, NULL::text) as maker_sponsor_role, \
                            COALESCE(d.sponsor_verified, FALSE) as maker_sponsor_verified \
                         FROM products p \
                         LEFT JOIN developers d ON lower(d.email) = lower(p.maker_email) \
                         WHERE p.id::text = ANY(",
                    );
                    qb.push_bind(ids);
                    qb.push(")");

                    let rows = qb
                        .build_query_as::<ProductRow>()
                        .persistent(false)
                        .fetch_all(&mut *tx)
                        .await?;
                    tx.commit().await?;
                    Ok(rows)
                }
                .await;

                match attempt_result {
                    Ok(rows) => {
                        let mut map = std::collections::HashMap::<String, Product>::new();
                        for row in rows {
                            let product = map_product_row(row);
                            map.insert(product.id.clone(), product);
                        }

                        let mut ordered = Vec::with_capacity(ids.len());
                        for id in ids {
                            if let Some(p) = map.remove(id) {
                                ordered.push(p);
                            }
                        }
                        return Ok(ordered);
                    }
                    Err(e) => {
                        if is_missing_column_error(&e, "rejection_reason")
                            && !PRODUCTS_REJECTION_REASON_READY.load(Ordering::Relaxed)
                            && ensure_products_rejection_reason_column(pool).await.is_ok()
                        {
                            continue;
                        }
                        if (is_missing_column_error(&e, "sponsor_role")
                            || is_missing_column_error(&e, "sponsor_verified"))
                            && !DEVELOPERS_SPONSOR_COLUMNS_READY.load(Ordering::Relaxed)
                            && ensure_developers_sponsor_columns(pool).await.is_ok()
                        {
                            continue;
                        }
                        last_err = Some(e);
                        let Some(ref err) = last_err else {
                            continue;
                        };
                        if is_retryable_db_error(err) && self.supabase.is_some() {
                            break;
                        }
                        if attempt == 0 && is_retryable_db_error(err) {
                            continue;
                        }
                        return Err(last_err.unwrap());
                    }
                }
            }

            if let Some(e) = last_err {
                if !(is_retryable_db_error(&e) && self.supabase.is_some()) {
                    return Err(e);
                }
            }
        }

        let mut ordered = Vec::new();
        for id in ids {
            if let Some(p) = self.get_product_by_id(id).await? {
                ordered.push(p);
            }
        }
        Ok(ordered)
    }

    pub async fn get_home_module_state(&self, key: &str) -> Result<Option<HomeModuleState>> {
        if let Some(pool) = &self.postgres {
            let mut tx = pool.begin().await?;
            let row = sqlx::query_as::<_, HomeModuleStateRow>(
                "SELECT key, mode, day_key, remaining_ids, today_ids FROM home_module_state WHERE key = $1 LIMIT 1",
            )
            .persistent(false)
            .bind(key)
            .fetch_optional(&mut *tx)
            .await?;
            tx.commit().await?;
            return Ok(row.map(map_home_module_state_row));
        }

        Ok(None)
    }

    pub async fn upsert_home_module_state(&self, state: HomeModuleState) -> Result<()> {
        if let Some(pool) = &self.postgres {
            let mut tx = pool.begin().await?;
            sqlx::query(
                "INSERT INTO home_module_state (key, mode, day_key, remaining_ids, today_ids) \
                 VALUES ($1, $2, $3, $4, $5) \
                 ON CONFLICT (key) DO UPDATE SET \
                    mode = EXCLUDED.mode, \
                    day_key = EXCLUDED.day_key, \
                    remaining_ids = EXCLUDED.remaining_ids, \
                    today_ids = EXCLUDED.today_ids, \
                    updated_at = NOW()",
            )
            .persistent(false)
            .bind(&state.key)
            .bind(&state.mode)
            .bind(state.day_key)
            .bind(&state.remaining_ids)
            .bind(&state.today_ids)
            .execute(&mut *tx)
            .await?;
            tx.commit().await?;
            return Ok(());
        }

        Ok(())
    }

    #[allow(dead_code)]
    pub async fn get_first_developer_emails_by_created_at(
        &self,
        limit: i64,
    ) -> Result<Vec<String>> {
        let limit = limit.clamp(1, 5000);
        if let Some(pool) = &self.postgres {
            let rows = sqlx::query_as::<_, NewsletterRecipientRow>(
                "SELECT email FROM developers ORDER BY created_at ASC, email ASC LIMIT $1",
            )
            .persistent(false)
            .bind(limit)
            .fetch_all(pool)
            .await?;
            return Ok(rows
                .into_iter()
                .map(|r| strip_nul_str(&r.email).into_owned())
                .collect());
        }
        Ok(Vec::new())
    }

    #[allow(dead_code)]
    pub async fn get_free_sponsorship_candidate_product_ids(
        &self,
        first_n_developers: i64,
        window_days: i64,
        now: chrono::DateTime<chrono::Utc>,
        language: Option<&str>,
    ) -> Result<Vec<String>> {
        if let Some(pool) = &self.postgres {
            let emails = self
                .get_first_developer_emails_by_created_at(first_n_developers)
                .await?;
            if emails.is_empty() {
                return Ok(Vec::new());
            }

            let since = now - chrono::Duration::days(window_days.max(1));
            let status_clause = if dev_include_pending_in_approved() {
                "p.status::text IN ('approved','pending')"
            } else {
                "p.status::text = 'approved'"
            };

            let rows = if let Some(language) = language {
                let sql = format!(
                    "SELECT p.id::text as email \
                     FROM products p \
                     WHERE {} AND p.created_at >= $1 AND p.maker_email = ANY($2) AND p.language = $3 \
                     ORDER BY p.created_at DESC, p.id ASC \
                     LIMIT 5000",
                    status_clause
                );
                sqlx::query_as::<_, NewsletterRecipientRow>(&sql)
                    .persistent(false)
                    .bind(since)
                    .bind(&emails)
                    .bind(language)
                    .fetch_all(pool)
                    .await?
            } else {
                let sql = format!(
                    "SELECT p.id::text as email \
                     FROM products p \
                     WHERE {} AND p.created_at >= $1 AND p.maker_email = ANY($2) \
                     ORDER BY p.created_at DESC, p.id ASC \
                     LIMIT 5000",
                    status_clause
                );
                sqlx::query_as::<_, NewsletterRecipientRow>(&sql)
                    .persistent(false)
                    .bind(since)
                    .bind(&emails)
                    .fetch_all(pool)
                    .await?
            };

            return Ok(rows
                .into_iter()
                .map(|r| strip_nul_str(&r.email).into_owned())
                .collect());
        }

        Ok(Vec::new())
    }

    pub async fn get_first_product_ids_by_created_at(
        &self,
        limit: i64,
        language: Option<&str>,
    ) -> Result<Vec<String>> {
        let limit = limit.clamp(1, 5000);
        if let Some(pool) = &self.postgres {
            let status_clause = if dev_include_pending_in_approved() {
                "p.status::text IN ('approved','pending')"
            } else {
                "p.status::text = 'approved'"
            };

            let rows = if let Some(language) = language {
                let sql = format!(
                    "SELECT p.id::text as email \
                     FROM products p \
                     WHERE {} AND p.language = $2 \
                     ORDER BY p.created_at ASC, p.id ASC \
                     LIMIT $1",
                    status_clause
                );
                sqlx::query_as::<_, NewsletterRecipientRow>(&sql)
                    .persistent(false)
                    .bind(limit)
                    .bind(language)
                    .fetch_all(pool)
                    .await?
            } else {
                let sql = format!(
                    "SELECT p.id::text as email \
                     FROM products p \
                     WHERE {} \
                     ORDER BY p.created_at ASC, p.id ASC \
                     LIMIT $1",
                    status_clause
                );
                sqlx::query_as::<_, NewsletterRecipientRow>(&sql)
                    .persistent(false)
                    .bind(limit)
                    .fetch_all(pool)
                    .await?
            };

            return Ok(rows
                .into_iter()
                .map(|r| strip_nul_str(&r.email).into_owned())
                .collect());
        }

        Ok(Vec::new())
    }

    pub async fn get_active_sponsorship_grants(
        &self,
        placement: &str,
        now: chrono::DateTime<chrono::Utc>,
        language: Option<&str>,
    ) -> Result<Vec<(Option<i32>, String)>> {
        if let Some(pool) = &self.postgres {
            let placement = strip_nul_str(placement);
            let status_clause = if dev_include_pending_in_approved() {
                "p.status::text IN ('approved','pending')"
            } else {
                "p.status::text = 'approved'"
            };

            let mut last_err: Option<anyhow::Error> = None;
            for _attempt_idx in 0..2 {
                let attempt = if let Some(language) = language {
                    let sql = format!(
                        "SELECT s.id, p.id::text as product_id, s.slot_index \
                         FROM sponsorship_grants s \
                         JOIN products p ON p.id = s.product_id \
                         WHERE s.placement = $1 AND s.starts_at <= $2 AND s.ends_at > $2 AND {} AND p.language = $3 \
                         ORDER BY s.slot_index NULLS LAST, s.created_at ASC, p.created_at DESC, p.id ASC",
                        status_clause
                    );
                    sqlx::query_as::<_, SponsorshipGrantRow>(&sql)
                        .persistent(false)
                        .bind(placement.as_ref())
                        .bind(now)
                        .bind(language)
                        .fetch_all(pool)
                        .await
                } else {
                    let sql = format!(
                        "SELECT s.id, p.id::text as product_id, s.slot_index \
                         FROM sponsorship_grants s \
                         JOIN products p ON p.id = s.product_id \
                         WHERE s.placement = $1 AND s.starts_at <= $2 AND s.ends_at > $2 AND {} \
                         ORDER BY s.slot_index NULLS LAST, s.created_at ASC, p.created_at DESC, p.id ASC",
                        status_clause
                    );
                    sqlx::query_as::<_, SponsorshipGrantRow>(&sql)
                        .persistent(false)
                        .bind(placement.as_ref())
                        .bind(now)
                        .fetch_all(pool)
                        .await
                };

                match attempt {
                    Ok(rows) => {
                        return Ok(rows
                            .into_iter()
                            .map(|r| (r.slot_index, strip_nul_str(&r.product_id).into_owned()))
                            .collect())
                    }
                    Err(e) => {
                        let e: anyhow::Error = e.into();
                        if is_missing_relation_error(&e, "sponsorship_grants")
                            && !SPONSORSHIP_TABLES_READY.load(Ordering::Relaxed)
                            && ensure_sponsorship_tables(pool).await.is_ok()
                        {
                            continue;
                        }
                        last_err = Some(e);
                        break;
                    }
                }
            }

            return Err(last_err.unwrap_or_else(|| {
                anyhow::anyhow!("Failed to fetch active sponsorship grants after auto migration")
            }));
        }

        Ok(Vec::new())
    }

    pub async fn create_sponsorship_request(
        &self,
        req: CreateSponsorshipRequest,
    ) -> Result<SponsorshipRequest> {
        let pool = self
            .postgres
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("Postgres is not configured"))?;

        let email = strip_nul_str(req.email.trim());
        let product_ref = strip_nul_str(req.product_ref.trim());
        let placement = strip_nul_str(req.placement.trim());
        let note = req
            .note
            .as_ref()
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty());
        for _attempt_idx in 0..2 {
            let attempt = sqlx::query_as::<_, SponsorshipRequestRow>(
                "INSERT INTO sponsorship_requests (email, product_ref, placement, slot_index, duration_days, note) \
                 VALUES ($1, $2, $3, $4, $5, $6) \
                 RETURNING id, email, product_ref, placement, slot_index, duration_days, note, status, processed_grant_id, created_at, updated_at",
            )
            .persistent(false)
            .bind(email.as_ref())
            .bind(product_ref.as_ref())
            .bind(placement.as_ref())
            .bind(req.slot_index)
            .bind(req.duration_days)
            .bind(note.as_deref())
            .fetch_one(pool)
            .await;

            match attempt {
                Ok(row) => return Ok(map_sponsorship_request_row(row)),
                Err(e) => {
                    let e: anyhow::Error = e.into();
                    if is_missing_relation_error(&e, "sponsorship_requests")
                        && !SPONSORSHIP_TABLES_READY.load(Ordering::Relaxed)
                        && ensure_sponsorship_tables(pool).await.is_ok()
                    {
                        continue;
                    }
                    return Err(e);
                }
            }
        }

        Err(anyhow::anyhow!(
            "Failed to create sponsorship request after auto migration"
        ))
    }

    pub async fn list_sponsorship_requests(
        &self,
        status: Option<&str>,
        limit: i64,
        offset: i64,
    ) -> Result<Vec<SponsorshipRequest>> {
        let pool = self
            .postgres
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("Postgres is not configured"))?;

        let limit = limit.clamp(1, 200);
        let offset = offset.max(0);

        let mut last_err: Option<anyhow::Error> = None;
        for _attempt_idx in 0..2 {
            let attempt = if let Some(status) = status {
                let status = strip_nul_str(status.trim());
                sqlx::query_as::<_, SponsorshipRequestRow>(
                    "SELECT id, email, product_ref, placement, slot_index, duration_days, note, status, processed_grant_id, created_at, updated_at \
                     FROM sponsorship_requests \
                     WHERE status = $1 \
                     ORDER BY created_at DESC, id DESC \
                     LIMIT $2 OFFSET $3",
                )
                .persistent(false)
                .bind(status.as_ref())
                .bind(limit)
                .bind(offset)
                .fetch_all(pool)
                .await
            } else {
                sqlx::query_as::<_, SponsorshipRequestRow>(
                    "SELECT id, email, product_ref, placement, slot_index, duration_days, note, status, processed_grant_id, created_at, updated_at \
                     FROM sponsorship_requests \
                     ORDER BY created_at DESC, id DESC \
                     LIMIT $1 OFFSET $2",
                )
                .persistent(false)
                .bind(limit)
                .bind(offset)
                .fetch_all(pool)
                .await
            };

            match attempt {
                Ok(rows) => return Ok(rows.into_iter().map(map_sponsorship_request_row).collect()),
                Err(e) => {
                    let e: anyhow::Error = e.into();
                    if is_missing_relation_error(&e, "sponsorship_requests")
                        && !SPONSORSHIP_TABLES_READY.load(Ordering::Relaxed)
                        && ensure_sponsorship_tables(pool).await.is_ok()
                    {
                        continue;
                    }
                    last_err = Some(e);
                    break;
                }
            }
        }

        Err(last_err.unwrap_or_else(|| {
            anyhow::anyhow!("Failed to list sponsorship requests after auto migration")
        }))
    }

    pub async fn get_sponsorship_request_by_id(
        &self,
        id: i64,
    ) -> Result<Option<SponsorshipRequest>> {
        let pool = self
            .postgres
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("Postgres is not configured"))?;

        let mut last_err: Option<anyhow::Error> = None;
        for _attempt_idx in 0..2 {
            let attempt = sqlx::query_as::<_, SponsorshipRequestRow>(
                "SELECT id, email, product_ref, placement, slot_index, duration_days, note, status, processed_grant_id, created_at, updated_at \
                 FROM sponsorship_requests \
                 WHERE id = $1",
            )
            .persistent(false)
            .bind(id)
            .fetch_optional(pool)
            .await;

            match attempt {
                Ok(row) => return Ok(row.map(map_sponsorship_request_row)),
                Err(e) => {
                    let e: anyhow::Error = e.into();
                    if is_missing_relation_error(&e, "sponsorship_requests")
                        && !SPONSORSHIP_TABLES_READY.load(Ordering::Relaxed)
                        && ensure_sponsorship_tables(pool).await.is_ok()
                    {
                        continue;
                    }
                    last_err = Some(e);
                    break;
                }
            }
        }

        Err(last_err.unwrap_or_else(|| {
            anyhow::anyhow!("Failed to fetch sponsorship request after auto migration")
        }))
    }

    pub async fn reject_sponsorship_request(&self, id: i64, note: Option<&str>) -> Result<bool> {
        let pool = self
            .postgres
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("Postgres is not configured"))?;

        let note = note.map(|v| v.trim()).filter(|v| !v.is_empty());
        for _attempt_idx in 0..2 {
            let attempt = sqlx::query(
                "UPDATE sponsorship_requests \
                 SET status = 'rejected', note = COALESCE($2, note), updated_at = NOW() \
                 WHERE id = $1 AND status = 'pending'",
            )
            .persistent(false)
            .bind(id)
            .bind(note)
            .execute(pool)
            .await;

            match attempt {
                Ok(res) => return Ok(res.rows_affected() > 0),
                Err(e) => {
                    let e: anyhow::Error = e.into();
                    if is_missing_relation_error(&e, "sponsorship_requests")
                        && !SPONSORSHIP_TABLES_READY.load(Ordering::Relaxed)
                        && ensure_sponsorship_tables(pool).await.is_ok()
                    {
                        continue;
                    }
                    return Err(e);
                }
            }
        }

        Ok(false)
    }

    pub async fn upsert_developer_sponsor(
        &self,
        email: &str,
        sponsor_role: Option<&str>,
        sponsor_verified: bool,
    ) -> Result<bool> {
        let pool = self
            .postgres
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("Postgres is not configured"))?;

        let email_lower = email.trim().to_ascii_lowercase();
        let email_clean = strip_nul_str(email_lower.as_str());
        let role = sponsor_role.map(|v| strip_nul_str(v.trim()).into_owned());

        for _attempt_idx in 0..2 {
            let attempt = sqlx::query(
                "INSERT INTO developers (email, name, sponsor_role, sponsor_verified) \
                 VALUES ($1, $2, $3, $4) \
                 ON CONFLICT (email) DO UPDATE SET \
                    sponsor_role = EXCLUDED.sponsor_role, \
                    sponsor_verified = EXCLUDED.sponsor_verified, \
                    updated_at = NOW()",
            )
            .persistent(false)
            .bind(email_clean.as_ref())
            .bind(email_clean.as_ref())
            .bind(role.as_deref())
            .bind(sponsor_verified)
            .execute(pool)
            .await;

            match attempt {
                Ok(res) => return Ok(res.rows_affected() > 0),
                Err(e) => {
                    let e: anyhow::Error = e.into();
                    if (is_missing_column_error(&e, "sponsor_role")
                        || is_missing_column_error(&e, "sponsor_verified"))
                        && !DEVELOPERS_SPONSOR_COLUMNS_READY.load(Ordering::Relaxed)
                        && ensure_developers_sponsor_columns(pool).await.is_ok()
                    {
                        continue;
                    }
                    return Err(e);
                }
            }
        }

        Ok(false)
    }

    pub async fn resolve_product_id_by_ref(&self, product_ref: &str) -> Result<Option<String>> {
        let pool = self
            .postgres
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("Postgres is not configured"))?;

        let raw = product_ref.trim();
        if raw.is_empty() {
            return Ok(None);
        }

        if let Ok(uuid) = uuid::Uuid::parse_str(raw) {
            return Ok(Some(uuid.to_string()));
        }

        let q = strip_nul_str(raw);
        let like = format!("%{}%", q);

        if let Some(row) = sqlx::query_as::<_, (String,)>(
            "SELECT id::text FROM products WHERE website = $1 ORDER BY created_at DESC, id ASC LIMIT 1",
        )
        .persistent(false)
        .bind(q.as_ref())
        .fetch_optional(pool)
        .await?
        {
            return Ok(Some(strip_nul_str(&row.0).into_owned()));
        }

        let row = sqlx::query_as::<_, (String,)>(
            "SELECT id::text FROM products WHERE name ILIKE $1 OR website ILIKE $1 ORDER BY created_at DESC, id ASC LIMIT 1",
        )
        .persistent(false)
        .bind(like)
        .fetch_optional(pool)
        .await?;

        Ok(row.map(|r| strip_nul_str(&r.0).into_owned()))
    }

    pub async fn create_sponsorship_grant_from_request(
        &self,
        input: CreateSponsorshipGrantFromRequest,
    ) -> Result<SponsorshipGrant> {
        let pool = self
            .postgres
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("Postgres is not configured"))?;

        let mut last_err: Option<anyhow::Error> = None;
        for _attempt_idx in 0..2 {
            let mut tx = pool.begin().await?;

            let attempt: Result<SponsorshipGrantFullRow, anyhow::Error> = async {
                let requested_start = input.starts_at.unwrap_or_else(chrono::Utc::now);
                let max_end: Option<chrono::DateTime<chrono::Utc>> = sqlx::query_scalar(
                    "SELECT MAX(ends_at) FROM sponsorship_grants \
                     WHERE placement = $1 AND slot_index IS NOT DISTINCT FROM $2",
                )
                .persistent(false)
                .bind(strip_nul_str(&input.placement).as_ref())
                .bind(input.slot_index)
                .fetch_one(&mut *tx)
                .await?;

                let starts_at = match max_end {
                    Some(end) if end > requested_start => end,
                    _ => requested_start,
                };

                let duration_days = input.duration_days.max(1);
                let ends_at = starts_at + chrono::Duration::days(duration_days as i64);

                let product_id = strip_nul_str(&input.product_id);
                let placement = strip_nul_str(&input.placement);

                let grant_row = sqlx::query_as::<_, SponsorshipGrantFullRow>(
                    "INSERT INTO sponsorship_grants (product_id, placement, slot_index, starts_at, ends_at, source, amount_usd_cents) \
                     VALUES ($1::uuid, $2, $3, $4, $5, 'request', $6) \
                     RETURNING id, product_id::text as product_id, placement, slot_index, starts_at, ends_at, source, amount_usd_cents, created_at",
                )
                .persistent(false)
                .bind(product_id.as_ref())
                .bind(placement.as_ref())
                .bind(input.slot_index)
                .bind(starts_at)
                .bind(ends_at)
                .bind(input.amount_usd_cents)
                .fetch_one(&mut *tx)
                .await?;

                let updated = sqlx::query(
                    "UPDATE sponsorship_requests \
                     SET status = 'processed', processed_grant_id = $2, updated_at = NOW() \
                     WHERE id = $1 AND status = 'pending'",
                )
                .persistent(false)
                .bind(input.request_id)
                .bind(grant_row.id)
                .execute(&mut *tx)
                .await?;

                if updated.rows_affected() == 0 {
                    return Err(anyhow::anyhow!("Sponsorship request is not pending"));
                }

                Ok(grant_row)
            }
            .await;

            match attempt {
                Ok(grant_row) => {
                    tx.commit().await?;
                    return Ok(map_sponsorship_grant_full_row(grant_row));
                }
                Err(e) => {
                    let _ = tx.rollback().await;
                    if (is_missing_relation_error(&e, "sponsorship_grants")
                        || is_missing_relation_error(&e, "sponsorship_requests"))
                        && !SPONSORSHIP_TABLES_READY.load(Ordering::Relaxed)
                        && ensure_sponsorship_tables(pool).await.is_ok()
                    {
                        continue;
                    }
                    last_err = Some(e);
                    break;
                }
            }
        }

        Err(last_err.unwrap_or_else(|| {
            anyhow::anyhow!("Failed to create sponsorship grant after auto migration")
        }))
    }

    pub async fn list_sponsorship_grants(
        &self,
        placement: Option<&str>,
        limit: i64,
        offset: i64,
    ) -> Result<Vec<SponsorshipGrant>> {
        let pool = self
            .postgres
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("Postgres is not configured"))?;

        let limit = limit.clamp(1, 200);
        let offset = offset.max(0);

        let mut last_err: Option<anyhow::Error> = None;
        for _attempt_idx in 0..2 {
            let attempt = if let Some(placement) = placement {
                let placement = strip_nul_str(placement.trim());
                sqlx::query_as::<_, SponsorshipGrantFullRow>(
                    "SELECT id, product_id::text as product_id, placement, slot_index, starts_at, ends_at, source, amount_usd_cents, created_at \
                     FROM sponsorship_grants \
                     WHERE placement = $1 \
                     ORDER BY starts_at DESC, id DESC \
                     LIMIT $2 OFFSET $3",
                )
                .persistent(false)
                .bind(placement.as_ref())
                .bind(limit)
                .bind(offset)
                .fetch_all(pool)
                .await
            } else {
                sqlx::query_as::<_, SponsorshipGrantFullRow>(
                    "SELECT id, product_id::text as product_id, placement, slot_index, starts_at, ends_at, source, amount_usd_cents, created_at \
                     FROM sponsorship_grants \
                     ORDER BY starts_at DESC, id DESC \
                     LIMIT $1 OFFSET $2",
                )
                .persistent(false)
                .bind(limit)
                .bind(offset)
                .fetch_all(pool)
                .await
            };

            match attempt {
                Ok(rows) => {
                    return Ok(rows
                        .into_iter()
                        .map(map_sponsorship_grant_full_row)
                        .collect())
                }
                Err(e) => {
                    let e: anyhow::Error = e.into();
                    if is_missing_relation_error(&e, "sponsorship_grants")
                        && !SPONSORSHIP_TABLES_READY.load(Ordering::Relaxed)
                        && ensure_sponsorship_tables(pool).await.is_ok()
                    {
                        continue;
                    }
                    last_err = Some(e);
                    break;
                }
            }
        }

        Err(last_err.unwrap_or_else(|| {
            anyhow::anyhow!("Failed to list sponsorship grants after auto migration")
        }))
    }

    pub async fn delete_sponsorship_grant(&self, id: i64) -> Result<bool> {
        let pool = self
            .postgres
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("Postgres is not configured"))?;

        let mut last_err: Option<anyhow::Error> = None;
        for _attempt_idx in 0..2 {
            let attempt = sqlx::query("DELETE FROM sponsorship_grants WHERE id = $1")
                .persistent(false)
                .bind(id)
                .execute(pool)
                .await;

            match attempt {
                Ok(res) => return Ok(res.rows_affected() > 0),
                Err(e) => {
                    let e: anyhow::Error = e.into();
                    if is_missing_relation_error(&e, "sponsorship_grants")
                        && !SPONSORSHIP_TABLES_READY.load(Ordering::Relaxed)
                        && ensure_sponsorship_tables(pool).await.is_ok()
                    {
                        continue;
                    }
                    last_err = Some(e);
                    break;
                }
            }
        }

        Err(last_err.unwrap_or_else(|| {
            anyhow::anyhow!("Failed to delete sponsorship grant after auto migration")
        }))
    }

    pub async fn get_favorite_products(
        &self,
        user_id: &str,
        language: Option<&str>,
        limit: i64,
    ) -> Result<Vec<Product>> {
        let limit = limit.clamp(1, 200);

        if let Some(pool) = &self.postgres {
            let status_clause = if dev_include_pending_in_approved() {
                "p.status::text IN ('approved','pending')"
            } else {
                "p.status::text = 'approved'"
            };

            let rows = if let Some(language) = language {
                let sql = format!(
                    "SELECT \
                        p.id::text as id, \
                        p.name, \
                        p.slogan, \
                        p.description, \
                        p.website, \
                        p.logo_url, \
                        p.category, \
                        COALESCE(p.tags, ARRAY[]::text[]) as tags, \
                        p.maker_name, \
                        p.maker_email, \
                        p.maker_website, \
                        p.language, \
                        p.status::text as status, \
                        p.rejection_reason, \
                        p.created_at, \
                        p.updated_at, \
                        COALESCE(pl.likes, 0)::bigint as likes, \
                        COALESCE(pf2.favorites, 0)::bigint as favorites, \
                        COALESCE(d.sponsor_role, NULL::text) as maker_sponsor_role, \
                        COALESCE(d.sponsor_verified, FALSE) as maker_sponsor_verified \
                     FROM product_favorites f \
                     JOIN products p ON p.id = f.product_id \
                     LEFT JOIN developers d ON lower(d.email) = lower(p.maker_email) \
                     LEFT JOIN (SELECT product_id, COUNT(*)::bigint as likes FROM product_likes GROUP BY product_id) pl ON pl.product_id = p.id \
                     LEFT JOIN (SELECT product_id, COUNT(*)::bigint as favorites FROM product_favorites GROUP BY product_id) pf2 ON pf2.product_id = p.id \
                     WHERE f.user_id = $1 AND {} AND p.language = $2 \
                     ORDER BY f.created_at DESC \
                     LIMIT $3",
                    status_clause
                );

                {
                    let attempt = sqlx::query_as::<_, ProductRow>(&sql)
                        .persistent(false)
                        .bind(user_id)
                        .bind(language)
                        .bind(limit)
                        .fetch_all(pool)
                        .await;
                    match attempt {
                        Ok(rows) => rows,
                        Err(e) => {
                            let e: anyhow::Error = e.into();
                            if is_missing_column_error(&e, "rejection_reason")
                                && !PRODUCTS_REJECTION_REASON_READY.load(Ordering::Relaxed)
                                && ensure_products_rejection_reason_column(pool).await.is_ok()
                            {
                                let rows = sqlx::query_as::<_, ProductRow>(&sql)
                                    .persistent(false)
                                    .bind(user_id)
                                    .bind(language)
                                    .bind(limit)
                                    .fetch_all(pool)
                                    .await?;
                                return Ok(rows.into_iter().map(map_product_row).collect());
                            }
                            if (is_missing_column_error(&e, "sponsor_role")
                                || is_missing_column_error(&e, "sponsor_verified"))
                                && !DEVELOPERS_SPONSOR_COLUMNS_READY.load(Ordering::Relaxed)
                                && ensure_developers_sponsor_columns(pool).await.is_ok()
                            {
                                let rows = sqlx::query_as::<_, ProductRow>(&sql)
                                    .persistent(false)
                                    .bind(user_id)
                                    .bind(language)
                                    .bind(limit)
                                    .fetch_all(pool)
                                    .await?;
                                return Ok(rows.into_iter().map(map_product_row).collect());
                            }
                            return Err(e);
                        }
                    }
                }
            } else {
                let sql = format!(
                    "SELECT \
                        p.id::text as id, \
                        p.name, \
                        p.slogan, \
                        p.description, \
                        p.website, \
                        p.logo_url, \
                        p.category, \
                        COALESCE(p.tags, ARRAY[]::text[]) as tags, \
                        p.maker_name, \
                        p.maker_email, \
                        p.maker_website, \
                        p.language, \
                        p.status::text as status, \
                        p.rejection_reason, \
                        p.created_at, \
                        p.updated_at, \
                        COALESCE(pl.likes, 0)::bigint as likes, \
                        COALESCE(pf2.favorites, 0)::bigint as favorites, \
                        COALESCE(d.sponsor_role, NULL::text) as maker_sponsor_role, \
                        COALESCE(d.sponsor_verified, FALSE) as maker_sponsor_verified \
                     FROM product_favorites f \
                     JOIN products p ON p.id = f.product_id \
                     LEFT JOIN developers d ON lower(d.email) = lower(p.maker_email) \
                     LEFT JOIN (SELECT product_id, COUNT(*)::bigint as likes FROM product_likes GROUP BY product_id) pl ON pl.product_id = p.id \
                     LEFT JOIN (SELECT product_id, COUNT(*)::bigint as favorites FROM product_favorites GROUP BY product_id) pf2 ON pf2.product_id = p.id \
                     WHERE f.user_id = $1 AND {} \
                     ORDER BY f.created_at DESC \
                     LIMIT $2",
                    status_clause
                );

                {
                    let attempt = sqlx::query_as::<_, ProductRow>(&sql)
                        .persistent(false)
                        .bind(user_id)
                        .bind(limit)
                        .fetch_all(pool)
                        .await;
                    match attempt {
                        Ok(rows) => rows,
                        Err(e) => {
                            let e: anyhow::Error = e.into();
                            if is_missing_column_error(&e, "rejection_reason")
                                && !PRODUCTS_REJECTION_REASON_READY.load(Ordering::Relaxed)
                                && ensure_products_rejection_reason_column(pool).await.is_ok()
                            {
                                let rows = sqlx::query_as::<_, ProductRow>(&sql)
                                    .persistent(false)
                                    .bind(user_id)
                                    .bind(limit)
                                    .fetch_all(pool)
                                    .await?;
                                return Ok(rows.into_iter().map(map_product_row).collect());
                            }
                            if (is_missing_column_error(&e, "sponsor_role")
                                || is_missing_column_error(&e, "sponsor_verified"))
                                && !DEVELOPERS_SPONSOR_COLUMNS_READY.load(Ordering::Relaxed)
                                && ensure_developers_sponsor_columns(pool).await.is_ok()
                            {
                                let rows = sqlx::query_as::<_, ProductRow>(&sql)
                                    .persistent(false)
                                    .bind(user_id)
                                    .bind(limit)
                                    .fetch_all(pool)
                                    .await?;
                                return Ok(rows.into_iter().map(map_product_row).collect());
                            }
                            return Err(e);
                        }
                    }
                }
            };

            return Ok(rows.into_iter().map(map_product_row).collect());
        }

        Ok(Vec::new())
    }

    pub async fn get_product_by_id(&self, id: &str) -> Result<Option<Product>> {
        if let Some(pool) = &self.postgres {
            let mut last_err: Option<anyhow::Error> = None;
            for attempt_idx in 0..2 {
                let attempt = sqlx::query_as::<_, ProductRow>(
                    "SELECT \
                        p.id::text as id, \
                        p.name, \
                        p.slogan, \
                        p.description, \
                        p.website, \
                        p.logo_url, \
                        p.category, \
                        COALESCE(p.tags, ARRAY[]::text[]) as tags, \
                        p.maker_name, \
                        p.maker_email, \
                        p.maker_website, \
                        p.language, \
                        p.status::text as status, \
                        p.rejection_reason, \
                        p.created_at, \
                        p.updated_at, \
                        (SELECT COUNT(*)::bigint FROM product_likes l WHERE l.product_id = p.id) as likes, \
                        (SELECT COUNT(*)::bigint FROM product_favorites f WHERE f.product_id = p.id) as favorites, \
                        COALESCE(d.sponsor_role, NULL::text) as maker_sponsor_role, \
                        COALESCE(d.sponsor_verified, FALSE) as maker_sponsor_verified \
                     FROM products p \
                     LEFT JOIN developers d ON lower(d.email) = lower(p.maker_email) \
                     WHERE p.id::text = $1 \
                     LIMIT 1",
                )
                .persistent(false)
                .bind(id)
                .fetch_optional(pool)
                .await;

                match attempt {
                    Ok(row) => return Ok(row.map(map_product_row)),
                    Err(e) => {
                        let e: anyhow::Error = e.into();
                        if is_missing_column_error(&e, "rejection_reason")
                            && !PRODUCTS_REJECTION_REASON_READY.load(Ordering::Relaxed)
                            && ensure_products_rejection_reason_column(pool).await.is_ok()
                        {
                            continue;
                        }
                        if (is_missing_column_error(&e, "sponsor_role")
                            || is_missing_column_error(&e, "sponsor_verified"))
                            && !DEVELOPERS_SPONSOR_COLUMNS_READY.load(Ordering::Relaxed)
                            && ensure_developers_sponsor_columns(pool).await.is_ok()
                        {
                            continue;
                        }
                        last_err = Some(e);
                        let Some(ref err) = last_err else {
                            continue;
                        };
                        if is_retryable_db_error(err) && self.supabase.is_some() {
                            break;
                        }
                        if attempt_idx == 0 && is_retryable_db_error(err) {
                            continue;
                        }
                        return Err(last_err.unwrap());
                    }
                }
            }

            if let Some(e) = last_err {
                if !(is_retryable_db_error(&e) && self.supabase.is_some()) {
                    return Err(e);
                }
            }
        }

        let supabase = self
            .supabase
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("No database configured"))?;

        let mut url = Url::parse(&format!("{}/rest/v1/products", supabase.supabase_url))?;
        url.query_pairs_mut()
            .append_pair("id", &format!("eq.{}", id));

        let response = supabase
            .client
            .get(url)
            .header("apikey", &supabase.supabase_key)
            .header(
                "Authorization",
                &format!("Bearer {}", supabase.supabase_key),
            )
            .header("Accept", "application/json")
            .send()
            .await?;

        if response.status() == 404 {
            return Ok(None);
        }

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(anyhow::anyhow!(
                "Failed to fetch product: {}. Body: {}",
                status,
                body
            ));
        }

        let products: Vec<Product> = response.json().await?;
        Ok(products.first().cloned())
    }

    pub async fn create_product(&self, product: CreateProductRequest) -> Result<Product> {
        let mut product = product;
        sanitize_create_product_request(&mut product);
        if let Some(pool) = &self.postgres {
            let row = sqlx::query_as::<_, ProductRow>(
                "INSERT INTO products \
                    (name, slogan, description, website, logo_url, category, tags, maker_name, maker_email, maker_website, language, status) \
                 VALUES \
                    ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'pending') \
                 RETURNING \
                    id::text as id, \
                    name, \
                    slogan, \
                    description, \
                    website, \
                    logo_url, \
                    category, \
                    COALESCE(tags, ARRAY[]::text[]) as tags, \
                    maker_name, \
                    maker_email, \
                    maker_website, \
                    language, \
                    status::text as status, \
                    rejection_reason, \
                    created_at, \
                    updated_at, \
                    0::bigint as likes, \
                    0::bigint as favorites, \
                    NULL::text as maker_sponsor_role, \
                    FALSE as maker_sponsor_verified",
            )
            .persistent(false)
            .bind(&product.name)
            .bind(&product.slogan)
            .bind(&product.description)
            .bind(&product.website)
            .bind(&product.logo_url)
            .bind(&product.category)
            .bind(&product.tags)
            .bind(&product.maker_name)
            .bind(&product.maker_email)
            .bind(&product.maker_website)
            .bind(&product.language)
            .fetch_one(pool)
            .await?;

            self.upsert_developer_pg(
                pool,
                &product.maker_email,
                &product.maker_name,
                product.maker_website.as_ref(),
            )
            .await?;

            return Ok(map_product_row(row));
        }

        let supabase = self
            .supabase
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("No database configured"))?;

        let url = Url::parse(&format!("{}/rest/v1/products", supabase.supabase_url))?;

        let response = supabase
            .client
            .post(url)
            .header("apikey", &supabase.supabase_key)
            .header(
                "Authorization",
                &format!("Bearer {}", supabase.supabase_key),
            )
            .header("Accept", "application/json")
            .header("Prefer", "return=representation")
            .json(&product)
            .send()
            .await?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(anyhow::anyhow!(
                "Failed to create product: {}. Body: {}",
                status,
                body
            ));
        }

        let new_product: Product = response.json().await?;
        Ok(new_product)
    }

    pub async fn update_product(
        &self,
        id: &str,
        updates: UpdateProductRequest,
    ) -> Result<Option<Product>> {
        let mut updates = updates;
        sanitize_update_product_request(&mut updates);
        if let Some(pool) = &self.postgres {
            if updates.name.is_none()
                && updates.slogan.is_none()
                && updates.description.is_none()
                && updates.website.is_none()
                && updates.logo_url.is_none()
                && updates.category.is_none()
                && updates.tags.is_none()
                && updates.status.is_none()
                && updates.rejection_reason.is_none()
            {
                return self.get_product_by_id(id).await;
            }
            let mut last_err: Option<anyhow::Error> = None;
            for attempt_idx in 0..2 {
                let mut qb: QueryBuilder<Postgres> = QueryBuilder::new("UPDATE products SET ");
                let mut first = true;
                let push_comma = |qb: &mut QueryBuilder<Postgres>, first: &mut bool| {
                    if !*first {
                        qb.push(", ");
                    }
                    *first = false;
                };

                if let Some(name) = &updates.name {
                    push_comma(&mut qb, &mut first);
                    qb.push("name = ");
                    qb.push_bind(name);
                }
                if let Some(slogan) = &updates.slogan {
                    push_comma(&mut qb, &mut first);
                    qb.push("slogan = ");
                    qb.push_bind(slogan);
                }
                if let Some(description) = &updates.description {
                    push_comma(&mut qb, &mut first);
                    qb.push("description = ");
                    qb.push_bind(description);
                }
                if let Some(website) = &updates.website {
                    push_comma(&mut qb, &mut first);
                    qb.push("website = ");
                    qb.push_bind(website);
                }
                if let Some(logo_url) = &updates.logo_url {
                    push_comma(&mut qb, &mut first);
                    qb.push("logo_url = ");
                    qb.push_bind(logo_url);
                }
                if let Some(category) = &updates.category {
                    push_comma(&mut qb, &mut first);
                    qb.push("category = ");
                    qb.push_bind(category);
                }
                if let Some(tags) = &updates.tags {
                    push_comma(&mut qb, &mut first);
                    qb.push("tags = ");
                    qb.push_bind(tags);
                }
                if let Some(status) = &updates.status {
                    push_comma(&mut qb, &mut first);
                    qb.push("status = ");
                    qb.push_bind(serialize_product_status(status));
                }
                if let Some(reason) = &updates.rejection_reason {
                    push_comma(&mut qb, &mut first);
                    if reason.trim().is_empty() {
                        qb.push("rejection_reason = NULL");
                    } else {
                        qb.push("rejection_reason = ");
                        qb.push_bind(reason);
                    }
                }

                push_comma(&mut qb, &mut first);
                qb.push("updated_at = now()");

                qb.push(" WHERE id::text = ");
                qb.push_bind(id);

                qb.push(
                    " RETURNING \
                        id::text as id, \
                        name, \
                        slogan, \
                        description, \
                        website, \
                        logo_url, \
                        category, \
                        COALESCE(tags, ARRAY[]::text[]) as tags, \
                        maker_name, \
                        maker_email, \
                        maker_website, \
                        language, \
                        status::text as status, \
                        rejection_reason, \
                        created_at, \
                        updated_at, \
                        (SELECT COUNT(*)::bigint FROM product_likes l WHERE l.product_id = products.id) as likes, \
                        (SELECT COUNT(*)::bigint FROM product_favorites f WHERE f.product_id = products.id) as favorites, \
                        COALESCE((SELECT d.sponsor_role FROM developers d WHERE lower(d.email) = lower(products.maker_email) LIMIT 1), NULL::text) as maker_sponsor_role, \
                        COALESCE((SELECT d.sponsor_verified FROM developers d WHERE lower(d.email) = lower(products.maker_email) LIMIT 1), FALSE) as maker_sponsor_verified",
                );

                let attempt = qb
                    .build_query_as::<ProductRow>()
                    .persistent(false)
                    .fetch_optional(pool)
                    .await;

                match attempt {
                    Ok(row) => return Ok(row.map(map_product_row)),
                    Err(e) => {
                        let e: anyhow::Error = e.into();
                        if (is_missing_column_error(&e, "sponsor_role")
                            || is_missing_column_error(&e, "sponsor_verified"))
                            && !DEVELOPERS_SPONSOR_COLUMNS_READY.load(Ordering::Relaxed)
                            && ensure_developers_sponsor_columns(pool).await.is_ok()
                        {
                            continue;
                        }
                        last_err = Some(e);
                        if attempt_idx == 0 {
                            continue;
                        }
                        return Err(last_err.unwrap());
                    }
                }
            }

            if let Some(e) = last_err {
                return Err(e);
            }
        }

        let supabase = self
            .supabase
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("No database configured"))?;

        let mut url = Url::parse(&format!("{}/rest/v1/products", supabase.supabase_url))?;
        url.query_pairs_mut()
            .append_pair("id", &format!("eq.{}", id));

        let mut payload = serde_json::to_value(&updates)?;
        if let serde_json::Value::Object(ref mut map) = payload {
            if let Some(reason) = &updates.rejection_reason {
                if reason.trim().is_empty() {
                    map.insert("rejection_reason".to_string(), serde_json::Value::Null);
                }
            }
        }

        let response = supabase
            .client
            .patch(url)
            .header("apikey", &supabase.supabase_key)
            .header(
                "Authorization",
                &format!("Bearer {}", supabase.supabase_key),
            )
            .header("Accept", "application/json")
            .header("Prefer", "return=representation")
            .json(&payload)
            .send()
            .await?;

        if response.status() == 404 {
            return Ok(None);
        }

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(anyhow::anyhow!(
                "Failed to update product: {}. Body: {}",
                status,
                body
            ));
        }

        let updated_product: Product = response.json().await?;
        Ok(Some(updated_product))
    }

    pub async fn delete_product(&self, id: &str) -> Result<bool> {
        if let Some(pool) = &self.postgres {
            let res = sqlx::query("DELETE FROM products WHERE id::text = $1")
                .persistent(false)
                .bind(id)
                .execute(pool)
                .await?;
            return Ok(res.rows_affected() > 0);
        }

        let supabase = self
            .supabase
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("No database configured"))?;

        let mut url = Url::parse(&format!("{}/rest/v1/products", supabase.supabase_url))?;
        url.query_pairs_mut()
            .append_pair("id", &format!("eq.{}", id));

        let response = supabase
            .client
            .delete(url)
            .header("apikey", &supabase.supabase_key)
            .header(
                "Authorization",
                &format!("Bearer {}", supabase.supabase_key),
            )
            .send()
            .await?;

        Ok(response.status() == 204)
    }

    pub async fn get_categories(&self) -> Result<Vec<Category>> {
        if let Some(pool) = &self.postgres {
            let rows = sqlx::query_as::<_, CategoryRow>(
                "SELECT id::text as id, name_en, name_zh, icon, color FROM categories ORDER BY id",
            )
            .persistent(false)
            .fetch_all(pool)
            .await?;
            return Ok(rows.into_iter().map(map_category_row).collect());
        }

        let supabase = self
            .supabase
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("No database configured"))?;

        let url = Url::parse(&format!("{}/rest/v1/categories", supabase.supabase_url))?;

        let response = supabase
            .client
            .get(url)
            .header("apikey", &supabase.supabase_key)
            .header(
                "Authorization",
                &format!("Bearer {}", supabase.supabase_key),
            )
            .header("Accept", "application/json")
            .send()
            .await?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(anyhow::anyhow!(
                "Failed to fetch categories: {}. Body: {}",
                status,
                body
            ));
        }

        let categories: Vec<Category> = response.json().await?;
        Ok(categories)
    }

    pub async fn get_top_categories_by_product_count(
        &self,
        limit: i64,
    ) -> Result<Vec<crate::models::CategoryWithCount>> {
        let limit = limit.clamp(1, 50);

        if let Some(pool) = &self.postgres {
            let status_clause = if dev_include_pending_in_approved() {
                "p.status::text IN ('approved','pending')"
            } else {
                "p.status::text = 'approved'"
            };

            let sql = format!(
                "SELECT \
                    c.id::text as id, \
                    c.name_en, \
                    c.name_zh, \
                    c.icon, \
                    c.color, \
                    COUNT(p.id)::bigint as product_count \
                 FROM categories c \
                 JOIN products p ON p.category = c.id \
                 WHERE {} \
                 GROUP BY c.id, c.name_en, c.name_zh, c.icon, c.color \
                 ORDER BY product_count DESC, c.id ASC \
                 LIMIT $1",
                status_clause
            );

            let rows = sqlx::query_as::<_, CategoryWithCountRow>(&sql)
                .persistent(false)
                .bind(limit)
                .fetch_all(pool)
                .await?;

            return Ok(rows.into_iter().map(map_category_with_count_row).collect());
        }

        Ok(Vec::new())
    }

    /**
     * upsert_categories
     * 批量插入/更新 categories，用于开发阶段快速初始化数据。
     */
    pub async fn upsert_categories(&self, categories: Vec<Category>) -> Result<usize> {
        let mut categories = categories;
        if categories.is_empty() {
            return Ok(0);
        }
        sanitize_categories(&mut categories);

        if let Some(pool) = &self.postgres {
            let mut qb: QueryBuilder<Postgres> =
                QueryBuilder::new("INSERT INTO categories (id, name_en, name_zh, icon, color) ");

            qb.push_values(categories.iter(), |mut b, c| {
                b.push_bind(&c.id)
                    .push_bind(&c.name_en)
                    .push_bind(&c.name_zh)
                    .push_bind(&c.icon)
                    .push_bind(&c.color);
            });

            qb.push(
                " ON CONFLICT (id) DO UPDATE SET \
                    name_en = EXCLUDED.name_en, \
                    name_zh = EXCLUDED.name_zh, \
                    icon = EXCLUDED.icon, \
                    color = EXCLUDED.color",
            );

            let res = qb.build().persistent(false).execute(pool).await?;
            return Ok(res.rows_affected() as usize);
        }

        let supabase = self
            .supabase
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("No database configured"))?;

        let mut url = Url::parse(&format!("{}/rest/v1/categories", supabase.supabase_url))?;
        url.query_pairs_mut().append_pair("on_conflict", "id");

        let response = supabase
            .client
            .post(url)
            .header("apikey", &supabase.supabase_key)
            .header(
                "Authorization",
                &format!("Bearer {}", supabase.supabase_key),
            )
            .header("Accept", "application/json")
            .header(
                "Prefer",
                "resolution=merge-duplicates,return=representation",
            )
            .json(&categories)
            .send()
            .await?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(anyhow::anyhow!(
                "Failed to upsert categories: {}. Body: {}",
                status,
                body
            ));
        }

        let returned: Vec<Category> = response.json().await?;
        Ok(returned.len())
    }

    pub async fn delete_category(&self, id: &str) -> Result<bool> {
        if let Some(pool) = &self.postgres {
            let id = strip_nul_str(id);
            let res = sqlx::query("DELETE FROM categories WHERE id = $1")
                .persistent(false)
                .bind(id.as_ref())
                .execute(pool)
                .await?;
            return Ok(res.rows_affected() > 0);
        }

        let supabase = self
            .supabase
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("No database configured"))?;

        let url = Url::parse(&format!(
            "{}/rest/v1/categories?id=eq.{}",
            supabase.supabase_url,
            urlencoding::encode(id)
        ))?;

        let response = supabase
            .client
            .delete(url)
            .header("apikey", &supabase.supabase_key)
            .header(
                "Authorization",
                &format!("Bearer {}", supabase.supabase_key),
            )
            .send()
            .await?;

        Ok(response.status() == 204)
    }

    pub async fn search_developers(&self, query: &str, limit: i64) -> Result<Vec<Developer>> {
        let limit = limit.clamp(1, 50);

        if let Some(pool) = &self.postgres {
            let query = strip_nul_str(query);
            let q = format!("%{}%", query);
            let attempt = sqlx::query_as::<_, DeveloperRow>(
                "SELECT email, name, avatar_url, website, sponsor_role, sponsor_verified \
                 FROM developers \
                 WHERE name ILIKE $1 OR email ILIKE $1 OR website ILIKE $1 \
                 ORDER BY name ASC \
                 LIMIT $2",
            )
            .persistent(false)
            .bind(q.as_str())
            .bind(limit)
            .fetch_all(pool)
            .await;

            match attempt {
                Ok(rows) => return Ok(rows.into_iter().map(map_developer_row).collect()),
                Err(e) => {
                    let e: anyhow::Error = e.into();
                    if is_missing_column_error(&e, "sponsor_role")
                        || is_missing_column_error(&e, "sponsor_verified")
                    {
                        let rows = sqlx::query_as::<_, DeveloperRow>(
                            "SELECT email, name, avatar_url, website, NULL::text as sponsor_role, FALSE as sponsor_verified \
                             FROM developers \
                             WHERE name ILIKE $1 OR email ILIKE $1 OR website ILIKE $1 \
                             ORDER BY name ASC \
                             LIMIT $2",
                        )
                        .persistent(false)
                        .bind(q.as_str())
                        .bind(limit)
                        .fetch_all(pool)
                        .await?;
                        return Ok(rows.into_iter().map(map_developer_row).collect());
                    }
                    return Err(e);
                }
            }
        }

        Ok(Vec::new())
    }

    pub async fn get_top_developers_by_followers(
        &self,
        limit: i64,
    ) -> Result<Vec<DeveloperWithFollowers>> {
        let limit = limit.clamp(1, 50);

        if let Some(pool) = &self.postgres {
            let mut tx = pool.begin().await?;
            let attempt = sqlx::query_as::<_, DeveloperWithFollowersRow>(
                "SELECT \
                    d.email, \
                    d.name, \
                    d.avatar_url, \
                    d.website, \
                    d.sponsor_role, \
                    d.sponsor_verified, \
                    COUNT(f.id)::bigint::text as followers \
                 FROM developers d \
                 LEFT JOIN developer_follows f ON f.developer_email = d.email \
                 GROUP BY d.email, d.name, d.avatar_url, d.website, d.sponsor_role, d.sponsor_verified \
                 ORDER BY COUNT(f.id) DESC, d.name ASC \
                 LIMIT $1",
            )
            .persistent(false)
            .bind(limit)
            .fetch_all(&mut *tx)
            .await;

            match attempt {
                Ok(rows) => {
                    tx.commit().await?;
                    return Ok(rows
                        .into_iter()
                        .map(map_developer_with_followers_row)
                        .collect());
                }
                Err(e) => {
                    let _ = tx.rollback().await;
                    let e: anyhow::Error = e.into();
                    if is_missing_column_error(&e, "sponsor_role")
                        || is_missing_column_error(&e, "sponsor_verified")
                    {
                        let mut tx = pool.begin().await?;
                        let rows = sqlx::query_as::<_, DeveloperWithFollowersRow>(
                            "SELECT \
                                d.email, \
                                d.name, \
                                d.avatar_url, \
                                d.website, \
                                NULL::text as sponsor_role, \
                                FALSE as sponsor_verified, \
                                COUNT(f.id)::bigint::text as followers \
                             FROM developers d \
                             LEFT JOIN developer_follows f ON f.developer_email = d.email \
                             GROUP BY d.email, d.name, d.avatar_url, d.website \
                             ORDER BY COUNT(f.id) DESC, d.name ASC \
                             LIMIT $1",
                        )
                        .persistent(false)
                        .bind(limit)
                        .fetch_all(&mut *tx)
                        .await?;
                        tx.commit().await?;
                        return Ok(rows
                            .into_iter()
                            .map(map_developer_with_followers_row)
                            .collect());
                    }
                    return Err(e);
                }
            }
        }

        Ok(Vec::new())
    }

    pub async fn get_recent_developers_by_created_at(
        &self,
        limit: i64,
    ) -> Result<Vec<DeveloperWithFollowers>> {
        let limit = limit.clamp(1, 50);

        if let Some(pool) = &self.postgres {
            let mut tx = pool.begin().await?;
            let attempt = sqlx::query_as::<_, DeveloperWithFollowersRow>(
                "SELECT \
                    d.email, \
                    d.name, \
                    d.avatar_url, \
                    d.website, \
                    d.sponsor_role, \
                    d.sponsor_verified, \
                    COUNT(f.id)::bigint::text as followers \
                 FROM developers d \
                 LEFT JOIN developer_follows f ON f.developer_email = d.email \
                 GROUP BY d.email, d.name, d.avatar_url, d.website, d.sponsor_role, d.sponsor_verified, d.created_at \
                 ORDER BY d.created_at DESC, d.name ASC \
                 LIMIT $1",
            )
            .persistent(false)
            .bind(limit)
            .fetch_all(&mut *tx)
            .await;

            match attempt {
                Ok(rows) => {
                    tx.commit().await?;
                    return Ok(rows
                        .into_iter()
                        .map(map_developer_with_followers_row)
                        .collect());
                }
                Err(e) => {
                    let _ = tx.rollback().await;
                    let e: anyhow::Error = e.into();
                    if is_missing_column_error(&e, "sponsor_role")
                        || is_missing_column_error(&e, "sponsor_verified")
                    {
                        let mut tx = pool.begin().await?;
                        let rows = sqlx::query_as::<_, DeveloperWithFollowersRow>(
                            "SELECT \
                                d.email, \
                                d.name, \
                                d.avatar_url, \
                                d.website, \
                                NULL::text as sponsor_role, \
                                FALSE as sponsor_verified, \
                                COUNT(f.id)::bigint::text as followers \
                             FROM developers d \
                             LEFT JOIN developer_follows f ON f.developer_email = d.email \
                             GROUP BY d.email, d.name, d.avatar_url, d.website, d.created_at \
                             ORDER BY d.created_at DESC, d.name ASC \
                             LIMIT $1",
                        )
                        .persistent(false)
                        .bind(limit)
                        .fetch_all(&mut *tx)
                        .await?;
                        tx.commit().await?;
                        return Ok(rows
                            .into_iter()
                            .map(map_developer_with_followers_row)
                            .collect());
                    }
                    return Err(e);
                }
            }
        }

        Ok(Vec::new())
    }

    pub async fn get_developer_popularity_last_month(
        &self,
        limit: i64,
    ) -> Result<Vec<DeveloperPopularity>> {
        let limit = limit.clamp(1, 50);

        if let Some(pool) = &self.postgres {
            let now = chrono::Utc::now();
            let first_day_current_month = chrono::Utc
                .with_ymd_and_hms(now.year(), now.month(), 1, 0, 0, 0)
                .single()
                .unwrap_or_else(chrono::Utc::now);
            let first_day_last_month = (first_day_current_month - chrono::Duration::days(1))
                .with_day(1)
                .unwrap_or(first_day_current_month - chrono::Duration::days(30));

            let mut tx = pool.begin().await?;
            let attempt = sqlx::query_as::<_, DeveloperPopularityRow>(
                "WITH likes AS ( \
                    SELECT p.maker_email as email, COUNT(l.id)::bigint as likes \
                    FROM products p \
                    JOIN product_likes l ON l.product_id = p.id \
                    WHERE l.created_at >= $1 AND l.created_at < $2 \
                    GROUP BY p.maker_email \
                 ), \
                 favorites AS ( \
                    SELECT p.maker_email as email, COUNT(f.id)::bigint as favorites \
                    FROM products p \
                    JOIN product_favorites f ON f.product_id = p.id \
                    WHERE f.created_at >= $1 AND f.created_at < $2 \
                    GROUP BY p.maker_email \
                 ) \
                 SELECT \
                    d.email, \
                    d.name, \
                    d.avatar_url, \
                    d.website, \
                    d.sponsor_role, \
                    d.sponsor_verified, \
                    COALESCE(l.likes, 0)::bigint as likes, \
                    COALESCE(f.favorites, 0)::bigint as favorites, \
                    (COALESCE(l.likes, 0) + COALESCE(f.favorites, 0))::bigint as score \
                 FROM developers d \
                 LEFT JOIN likes l ON l.email = d.email \
                 LEFT JOIN favorites f ON f.email = d.email \
                 ORDER BY score DESC, favorites DESC, likes DESC, d.name ASC \
                 LIMIT $3",
            )
            .persistent(false)
            .bind(first_day_last_month)
            .bind(first_day_current_month)
            .bind(limit)
            .fetch_all(&mut *tx)
            .await;

            match attempt {
                Ok(rows) => {
                    tx.commit().await?;
                    return Ok(rows.into_iter().map(map_developer_popularity_row).collect());
                }
                Err(e) => {
                    let _ = tx.rollback().await;
                    let e: anyhow::Error = e.into();
                    if is_missing_column_error(&e, "sponsor_role")
                        || is_missing_column_error(&e, "sponsor_verified")
                    {
                        let mut tx = pool.begin().await?;
                        let rows = sqlx::query_as::<_, DeveloperPopularityRow>(
                            "WITH likes AS ( \
                                SELECT p.maker_email as email, COUNT(l.id)::bigint as likes \
                                FROM products p \
                                JOIN product_likes l ON l.product_id = p.id \
                                WHERE l.created_at >= $1 AND l.created_at < $2 \
                                GROUP BY p.maker_email \
                             ), \
                             favorites AS ( \
                                SELECT p.maker_email as email, COUNT(f.id)::bigint as favorites \
                                FROM products p \
                                JOIN product_favorites f ON f.product_id = p.id \
                                WHERE f.created_at >= $1 AND f.created_at < $2 \
                                GROUP BY p.maker_email \
                             ) \
                             SELECT \
                                d.email, \
                                d.name, \
                                d.avatar_url, \
                                d.website, \
                                NULL::text as sponsor_role, \
                                FALSE as sponsor_verified, \
                                COALESCE(l.likes, 0)::bigint as likes, \
                                COALESCE(f.favorites, 0)::bigint as favorites, \
                                (COALESCE(l.likes, 0) + COALESCE(f.favorites, 0))::bigint as score \
                             FROM developers d \
                             LEFT JOIN likes l ON l.email = d.email \
                             LEFT JOIN favorites f ON f.email = d.email \
                             ORDER BY score DESC, favorites DESC, likes DESC, d.name ASC \
                             LIMIT $3",
                        )
                        .persistent(false)
                        .bind(first_day_last_month)
                        .bind(first_day_current_month)
                        .bind(limit)
                        .fetch_all(&mut *tx)
                        .await?;
                        tx.commit().await?;
                        return Ok(rows.into_iter().map(map_developer_popularity_row).collect());
                    }
                    return Err(e);
                }
            }
        }

        Ok(Vec::new())
    }

    pub async fn get_developer_popularity_last_week(
        &self,
        limit: i64,
    ) -> Result<Vec<DeveloperPopularity>> {
        let limit = limit.clamp(1, 50);

        if let Some(pool) = &self.postgres {
            let now = chrono::Utc::now();
            let since = now - chrono::Duration::days(7);

            let mut tx = pool.begin().await?;
            let attempt = sqlx::query_as::<_, DeveloperPopularityRow>(
                "WITH likes AS ( \
                    SELECT p.maker_email as email, COUNT(l.id)::bigint as likes \
                    FROM products p \
                    JOIN product_likes l ON l.product_id = p.id \
                    WHERE l.created_at >= $1 \
                    GROUP BY p.maker_email \
                 ), \
                 favorites AS ( \
                    SELECT p.maker_email as email, COUNT(f.id)::bigint as favorites \
                    FROM products p \
                    JOIN product_favorites f ON f.product_id = p.id \
                    WHERE f.created_at >= $1 \
                    GROUP BY p.maker_email \
                 ) \
                 SELECT \
                    d.email, \
                    d.name, \
                    d.avatar_url, \
                    d.website, \
                    d.sponsor_role, \
                    d.sponsor_verified, \
                    COALESCE(l.likes, 0)::bigint as likes, \
                    COALESCE(f.favorites, 0)::bigint as favorites, \
                    (COALESCE(l.likes, 0) + COALESCE(f.favorites, 0))::bigint as score \
                 FROM developers d \
                 LEFT JOIN likes l ON l.email = d.email \
                 LEFT JOIN favorites f ON f.email = d.email \
                 ORDER BY score DESC, favorites DESC, likes DESC, d.name ASC \
                 LIMIT $2",
            )
            .persistent(false)
            .bind(since)
            .bind(limit)
            .fetch_all(&mut *tx)
            .await;

            match attempt {
                Ok(rows) => {
                    tx.commit().await?;
                    return Ok(rows.into_iter().map(map_developer_popularity_row).collect());
                }
                Err(e) => {
                    let _ = tx.rollback().await;
                    let e: anyhow::Error = e.into();
                    if is_missing_column_error(&e, "sponsor_role")
                        || is_missing_column_error(&e, "sponsor_verified")
                    {
                        let mut tx = pool.begin().await?;
                        let rows = sqlx::query_as::<_, DeveloperPopularityRow>(
                            "WITH likes AS ( \
                                SELECT p.maker_email as email, COUNT(l.id)::bigint as likes \
                                FROM products p \
                                JOIN product_likes l ON l.product_id = p.id \
                                WHERE l.created_at >= $1 \
                                GROUP BY p.maker_email \
                             ), \
                             favorites AS ( \
                                SELECT p.maker_email as email, COUNT(f.id)::bigint as favorites \
                                FROM products p \
                                JOIN product_favorites f ON f.product_id = p.id \
                                WHERE f.created_at >= $1 \
                                GROUP BY p.maker_email \
                             ) \
                             SELECT \
                                d.email, \
                                d.name, \
                                d.avatar_url, \
                                d.website, \
                                NULL::text as sponsor_role, \
                                FALSE as sponsor_verified, \
                                COALESCE(l.likes, 0)::bigint as likes, \
                                COALESCE(f.favorites, 0)::bigint as favorites, \
                                (COALESCE(l.likes, 0) + COALESCE(f.favorites, 0))::bigint as score \
                             FROM developers d \
                             LEFT JOIN likes l ON l.email = d.email \
                             LEFT JOIN favorites f ON f.email = d.email \
                             ORDER BY score DESC, favorites DESC, likes DESC, d.name ASC \
                             LIMIT $2",
                        )
                        .persistent(false)
                        .bind(since)
                        .bind(limit)
                        .fetch_all(&mut *tx)
                        .await?;
                        tx.commit().await?;
                        return Ok(rows.into_iter().map(map_developer_popularity_row).collect());
                    }
                    return Err(e);
                }
            }
        }

        Ok(Vec::new())
    }

    pub async fn get_developer_center_stats(&self, email: &str) -> Result<DeveloperCenterStats> {
        if let Some(pool) = &self.postgres {
            let email = strip_nul_str(email);
            let row = sqlx::query_as::<_, DeveloperCenterStatsRow>(
                "SELECT \
                    (SELECT COUNT(*)::bigint FROM developer_follows f WHERE lower(f.developer_email) = lower($1)) as followers, \
                    (SELECT COUNT(*)::bigint FROM product_likes l JOIN products p ON p.id = l.product_id WHERE lower(p.maker_email) = lower($1)) as total_likes, \
                    (SELECT COUNT(*)::bigint FROM product_favorites f2 JOIN products p2 ON p2.id = f2.product_id WHERE lower(p2.maker_email) = lower($1)) as total_favorites",
            )
            .persistent(false)
            .bind(email.as_ref())
            .fetch_one(pool)
            .await?;

            return Ok(map_developer_center_stats_row(row));
        }

        let supabase = self
            .supabase
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("No database configured"))?;

        let email = strip_nul_str(email).into_owned();

        let followers = supabase_count(
            supabase,
            "developer_follows",
            &[
                ("select", "id".to_string()),
                ("developer_email", format!("eq.{}", email)),
            ],
        )
        .await?;

        let total_likes = supabase_count(
            supabase,
            "product_likes",
            &[
                ("select", "id,products!inner(maker_email)".to_string()),
                ("products.maker_email", format!("eq.{}", email)),
            ],
        )
        .await?;

        let total_favorites = supabase_count(
            supabase,
            "product_favorites",
            &[
                ("select", "id,products!inner(maker_email)".to_string()),
                ("products.maker_email", format!("eq.{}", email)),
            ],
        )
        .await?;

        Ok(DeveloperCenterStats {
            followers,
            total_likes,
            total_favorites,
        })
    }

    pub async fn follow_developer(&self, email: &str, user_id: &str) -> Result<()> {
        if let Some(pool) = &self.postgres {
            let email = strip_nul_str(email);
            let user_id = strip_nul_str(user_id);
            sqlx::query(
                "INSERT INTO developer_follows (developer_email, user_id) \
                 VALUES ($1, $2) \
                 ON CONFLICT (developer_email, user_id) DO NOTHING",
            )
            .persistent(false)
            .bind(email.as_ref())
            .bind(user_id.as_ref())
            .execute(pool)
            .await?;
            return Ok(());
        }

        Err(anyhow::anyhow!("No database configured"))
    }

    pub async fn unfollow_developer(&self, email: &str, user_id: &str) -> Result<()> {
        if let Some(pool) = &self.postgres {
            let email = strip_nul_str(email);
            let user_id = strip_nul_str(user_id);
            sqlx::query(
                "DELETE FROM developer_follows \
                 WHERE developer_email = $1 AND user_id = $2",
            )
            .persistent(false)
            .bind(email.as_ref())
            .bind(user_id.as_ref())
            .execute(pool)
            .await?;
            return Ok(());
        }

        Err(anyhow::anyhow!("No database configured"))
    }

    pub async fn like_product(&self, product_id: &str, user_id: &str) -> Result<()> {
        if let Some(pool) = &self.postgres {
            sqlx::query(
                "INSERT INTO product_likes (product_id, user_id) \
                 VALUES ($1::uuid, $2) \
                 ON CONFLICT (product_id, user_id) DO NOTHING",
            )
            .persistent(false)
            .bind(product_id)
            .bind(user_id)
            .execute(pool)
            .await?;
            return Ok(());
        }

        Err(anyhow::anyhow!("No database configured"))
    }

    pub async fn unlike_product(&self, product_id: &str, user_id: &str) -> Result<()> {
        if let Some(pool) = &self.postgres {
            sqlx::query(
                "DELETE FROM product_likes \
                 WHERE product_id = $1::uuid AND user_id = $2",
            )
            .persistent(false)
            .bind(product_id)
            .bind(user_id)
            .execute(pool)
            .await?;
            return Ok(());
        }

        Err(anyhow::anyhow!("No database configured"))
    }

    pub async fn favorite_product(&self, product_id: &str, user_id: &str) -> Result<()> {
        if let Some(pool) = &self.postgres {
            sqlx::query(
                "INSERT INTO product_favorites (product_id, user_id) \
                 VALUES ($1::uuid, $2) \
                 ON CONFLICT (product_id, user_id) DO NOTHING",
            )
            .persistent(false)
            .bind(product_id)
            .bind(user_id)
            .execute(pool)
            .await?;
            return Ok(());
        }

        Err(anyhow::anyhow!("No database configured"))
    }

    pub async fn unfavorite_product(&self, product_id: &str, user_id: &str) -> Result<()> {
        if let Some(pool) = &self.postgres {
            sqlx::query(
                "DELETE FROM product_favorites \
                 WHERE product_id = $1::uuid AND user_id = $2",
            )
            .persistent(false)
            .bind(product_id)
            .bind(user_id)
            .execute(pool)
            .await?;
            return Ok(());
        }

        Err(anyhow::anyhow!("No database configured"))
    }

    pub async fn subscribe_newsletter(&self, email: &str) -> Result<()> {
        let email = strip_nul_str(email);
        let normalized = email.trim().to_ascii_lowercase();
        if normalized.is_empty() {
            return Err(anyhow::anyhow!("Missing email"));
        }

        if let Some(pool) = &self.postgres {
            sqlx::query(
                "INSERT INTO newsletter_subscriptions (email, unsubscribed) \
                 VALUES ($1, FALSE) \
                 ON CONFLICT (email) DO UPDATE SET \
                    unsubscribed = FALSE, \
                    updated_at = NOW()",
            )
            .persistent(false)
            .bind(normalized)
            .execute(pool)
            .await?;
            return Ok(());
        }

        Err(anyhow::anyhow!("No database configured"))
    }

    pub async fn unsubscribe_newsletter(&self, email: &str) -> Result<()> {
        let email = strip_nul_str(email);
        let normalized = email.trim().to_ascii_lowercase();
        if normalized.is_empty() {
            return Err(anyhow::anyhow!("Missing email"));
        }

        if let Some(pool) = &self.postgres {
            sqlx::query(
                "INSERT INTO newsletter_subscriptions (email, unsubscribed) \
                 VALUES ($1, TRUE) \
                 ON CONFLICT (email) DO UPDATE SET \
                    unsubscribed = TRUE, \
                    updated_at = NOW()",
            )
            .persistent(false)
            .bind(normalized)
            .execute(pool)
            .await?;
            return Ok(());
        }

        Err(anyhow::anyhow!("No database configured"))
    }

    /**
     * send_admin_product_submission_notification
     * 产品提交后给管理员发送通知邮件（可选：包含一键通过/拒绝链接）。
     */
    pub async fn send_admin_product_submission_notification(
        &self,
        product: &Product,
    ) -> Result<()> {
        let resend_key = env::var("RESEND_API_KEY").ok().unwrap_or_default();
        if resend_key.trim().is_empty() {
            return Ok(());
        }

        let to = env::var("ADMIN_REVIEW_EMAIL")
            .ok()
            .unwrap_or_else(|| "2217021563@qq.com".to_string())
            .trim()
            .to_string();
        if to.is_empty() {
            return Ok(());
        }

        let from = env::var("ADMIN_REVIEW_FROM")
            .ok()
            .filter(|v| !v.trim().is_empty())
            .or_else(|| env::var("NEWSLETTER_FROM").ok())
            .unwrap_or_default();
        if from.trim().is_empty() {
            log::warn!(
                "Admin notify sender not configured: ADMIN_REVIEW_FROM/NEWSLETTER_FROM missing"
            );
            return Ok(());
        }

        let token_secret = env::var("ADMIN_REVIEW_TOKEN_SECRET")
            .ok()
            .unwrap_or_default();
        let frontend_base_url = env::var("FRONTEND_BASE_URL")
            .ok()
            .unwrap_or_else(|| "http://localhost:3000".to_string());
        let public_api_base_url = env::var("BACKEND_PUBLIC_URL")
            .ok()
            .unwrap_or_else(|| "http://localhost:8080".to_string());

        let client = Client::builder()
            .timeout(Duration::from_secs(12))
            .http1_only()
            .build()
            .unwrap_or_else(|_| Client::new());

        let (subject, html, text) = build_admin_product_submission_email_content(
            product,
            &frontend_base_url,
            &public_api_base_url,
            &token_secret,
        );

        send_email_resend(&client, &resend_key, &from, &to, &subject, &html, &text).await?;
        Ok(())
    }

    pub async fn send_weekly_newsletter_if_due(&self) -> Result<usize> {
        let pool = match &self.postgres {
            Some(v) => v,
            None => return Ok(0),
        };

        let now = chrono::Utc::now();
        if now.weekday() != chrono::Weekday::Thu {
            return Ok(0);
        }
        let hour = now.hour();
        if !(8..10).contains(&hour) {
            return Ok(0);
        }

        let resend_key = env::var("RESEND_API_KEY").ok().unwrap_or_default();
        let from = env::var("NEWSLETTER_FROM").ok().unwrap_or_default();
        if resend_key.trim().is_empty() || from.trim().is_empty() {
            log::warn!("Newsletter sender not configured: RESEND_API_KEY/NEWSLETTER_FROM missing");
            return Ok(0);
        }

        let iso = now.iso_week();
        let week_key = format!("{}-W{:02}", iso.year(), iso.week());

        let mut conn = pool.acquire().await?;
        let lock_key: i64 = 9_876_543_210;
        let locked = sqlx::query_scalar::<_, bool>("SELECT pg_try_advisory_lock($1)")
            .persistent(false)
            .bind(lock_key)
            .fetch_one(&mut *conn)
            .await
            .unwrap_or(false);
        if !locked {
            return Ok(0);
        }

        let since = now - chrono::Duration::days(7);
        let products = sqlx::query_as::<_, NewsletterTopProductRow>(
            "WITH likes AS ( \
                SELECT product_id, COUNT(*)::bigint as likes \
                FROM product_likes \
                WHERE created_at >= $1 \
                GROUP BY product_id \
             ), favorites AS ( \
                SELECT product_id, COUNT(*)::bigint as favorites \
                FROM product_favorites \
                WHERE created_at >= $1 \
                GROUP BY product_id \
             ) \
             SELECT \
                p.id::text as id, \
                p.name, \
                p.slogan, \
                p.website, \
                p.logo_url, \
                p.maker_name, \
                p.maker_email, \
                COALESCE(l.likes, 0)::bigint as weekly_likes, \
                COALESCE(f.favorites, 0)::bigint as weekly_favorites, \
                (COALESCE(l.likes, 0) + COALESCE(f.favorites, 0))::bigint as score \
             FROM products p \
             LEFT JOIN likes l ON l.product_id = p.id \
             LEFT JOIN favorites f ON f.product_id = p.id \
             WHERE p.status = 'approved' \
             ORDER BY score DESC, p.created_at DESC \
             LIMIT $2",
        )
        .persistent(false)
        .bind(since)
        .bind(5i64)
        .fetch_all(&mut *conn)
        .await?;

        let recipients = sqlx::query_as::<_, NewsletterRecipientRow>(
            "SELECT email \
             FROM newsletter_subscriptions \
             WHERE unsubscribed = FALSE AND (last_sent_week IS DISTINCT FROM $1) \
             ORDER BY created_at ASC \
             LIMIT 1000",
        )
        .persistent(false)
        .bind(&week_key)
        .fetch_all(&mut *conn)
        .await?;

        if recipients.is_empty() {
            let _ = sqlx::query("SELECT pg_advisory_unlock($1)")
                .persistent(false)
                .bind(lock_key)
                .execute(&mut *conn)
                .await;
            return Ok(0);
        }

        let frontend_base_url = env::var("FRONTEND_BASE_URL")
            .ok()
            .unwrap_or_else(|| "http://localhost:3000".to_string());
        let public_api_base_url = env::var("BACKEND_PUBLIC_URL")
            .ok()
            .unwrap_or_else(|| "http://localhost:8080".to_string());
        let token_secret = env::var("NEWSLETTER_TOKEN_SECRET").ok().unwrap_or_default();
        let client = Client::builder()
            .timeout(Duration::from_secs(12))
            .http1_only()
            .build()
            .unwrap_or_else(|_| Client::new());

        let mut sent: Vec<String> = Vec::new();
        for r in recipients {
            let to = r.email.trim().to_string();
            if to.is_empty() {
                continue;
            }
            let token =
                compute_newsletter_unsubscribe_token(&to, &token_secret).unwrap_or_default();
            let unsubscribe_url = if token.trim().is_empty() {
                let base = normalize_base_url(&public_api_base_url);
                let email_q = urlencoding::encode(&to);
                format!("{}/api/newsletter/unsubscribe?email={}", base, email_q)
            } else {
                build_newsletter_unsubscribe_url(&public_api_base_url, &to, &token)
            };
            let (subject, html, text) = build_weekly_newsletter_content(
                now,
                since,
                &products,
                &frontend_base_url,
                &unsubscribe_url,
            );
            let res =
                send_email_resend(&client, &resend_key, &from, &to, &subject, &html, &text).await;
            match res {
                Ok(()) => sent.push(to),
                Err(e) => log::warn!("Newsletter send failed to={} err={:?}", r.email, e),
            }
        }

        if !sent.is_empty() {
            sqlx::query(
                "UPDATE newsletter_subscriptions \
                 SET last_sent_week = $1, last_sent_at = NOW(), updated_at = NOW() \
                 WHERE email = ANY($2)",
            )
            .persistent(false)
            .bind(&week_key)
            .bind(&sent)
            .execute(&mut *conn)
            .await?;
        }

        let _ = sqlx::query("SELECT pg_advisory_unlock($1)")
            .persistent(false)
            .bind(lock_key)
            .execute(&mut *conn)
            .await;

        Ok(sent.len())
    }

    pub async fn seed_engagement(&self, product_ids: &[String]) -> Result<()> {
        if product_ids.is_empty() {
            return Ok(());
        }

        let pool = self
            .postgres
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("Postgres is not configured"))?;

        let products = {
            let sql = "SELECT \
                p.id::text as id, \
                p.name, \
                p.slogan, \
                p.description, \
                p.website, \
                p.logo_url, \
                p.category, \
                COALESCE(p.tags, ARRAY[]::text[]) as tags, \
                p.maker_name, \
                p.maker_email, \
                p.maker_website, \
                p.language, \
                p.status::text as status, \
                p.rejection_reason, \
                p.created_at, \
                p.updated_at, \
                0::bigint as likes, \
                0::bigint as favorites, \
                COALESCE(d.sponsor_role, NULL::text) as maker_sponsor_role, \
                COALESCE(d.sponsor_verified, FALSE) as maker_sponsor_verified \
             FROM products p \
             LEFT JOIN developers d ON lower(d.email) = lower(p.maker_email) \
             WHERE p.id::text = ANY($1)";

            let attempt = sqlx::query_as::<_, ProductRow>(sql)
                .persistent(false)
                .bind(product_ids)
                .fetch_all(pool)
                .await;

            match attempt {
                Ok(rows) => rows,
                Err(e) => {
                    let e: anyhow::Error = e.into();
                    if is_missing_column_error(&e, "rejection_reason")
                        && !PRODUCTS_REJECTION_REASON_READY.load(Ordering::Relaxed)
                    {
                        if ensure_products_rejection_reason_column(pool).await.is_ok() {
                            sqlx::query_as::<_, ProductRow>(sql)
                                .persistent(false)
                                .bind(product_ids)
                                .fetch_all(pool)
                                .await?
                        } else {
                            return Err(e);
                        }
                    } else if (is_missing_column_error(&e, "sponsor_role")
                        || is_missing_column_error(&e, "sponsor_verified"))
                        && !DEVELOPERS_SPONSOR_COLUMNS_READY.load(Ordering::Relaxed)
                    {
                        if ensure_developers_sponsor_columns(pool).await.is_ok() {
                            sqlx::query_as::<_, ProductRow>(sql)
                                .persistent(false)
                                .bind(product_ids)
                                .fetch_all(pool)
                                .await?
                        } else {
                            return Err(e);
                        }
                    } else {
                        return Err(e);
                    }
                }
            }
        };

        for p in &products {
            self.upsert_developer_pg(
                pool,
                &p.maker_email,
                &p.maker_name,
                p.maker_website.as_ref(),
            )
            .await?;
        }

        let mut emails: Vec<String> = products.iter().map(|p| p.maker_email.clone()).collect();
        emails.sort();
        emails.dedup();

        for (idx, email) in emails.iter().enumerate() {
            let follows = 10 + (idx as i64 * 7);
            let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
                "INSERT INTO developer_follows (developer_email, user_id, created_at) ",
            );
            qb.push_values(0..follows, |mut b, i| {
                let user_id = format!("seed_user_{}_{}", idx, i);
                let created_at = if i % 3 == 0 {
                    chrono::Utc::now() - chrono::Duration::days(35)
                } else {
                    chrono::Utc::now() - chrono::Duration::days(5)
                };
                b.push_bind(email).push_bind(user_id).push_bind(created_at);
            });
            qb.push(" ON CONFLICT (developer_email, user_id) DO NOTHING");
            qb.build().persistent(false).execute(pool).await?;
        }

        for (idx, p) in products.iter().enumerate() {
            let product_uuid = match uuid::Uuid::parse_str(&p.id) {
                Ok(v) => v,
                Err(_) => continue,
            };
            let likes = 20 + (idx as i64 * 9);
            let favorites = 12 + (idx as i64 * 5);

            let mut likes_qb: QueryBuilder<Postgres> =
                QueryBuilder::new("INSERT INTO product_likes (product_id, user_id, created_at) ");
            likes_qb.push_values(0..likes, |mut b, i| {
                let user_id = format!("seed_like_{}_{}", idx, i);
                let created_at = if i % 2 == 0 {
                    chrono::Utc::now() - chrono::Duration::days(33)
                } else {
                    chrono::Utc::now() - chrono::Duration::days(3)
                };
                b.push_bind(product_uuid)
                    .push_bind(user_id)
                    .push_bind(created_at);
            });
            likes_qb.push(" ON CONFLICT (product_id, user_id) DO NOTHING");
            likes_qb.build().persistent(false).execute(pool).await?;

            let mut fav_qb: QueryBuilder<Postgres> = QueryBuilder::new(
                "INSERT INTO product_favorites (product_id, user_id, created_at) ",
            );
            fav_qb.push_values(0..favorites, |mut b, i| {
                let user_id = format!("seed_fav_{}_{}", idx, i);
                let created_at = if i % 2 == 0 {
                    chrono::Utc::now() - chrono::Duration::days(34)
                } else {
                    chrono::Utc::now() - chrono::Duration::days(4)
                };
                b.push_bind(product_uuid)
                    .push_bind(user_id)
                    .push_bind(created_at);
            });
            fav_qb.push(" ON CONFLICT (product_id, user_id) DO NOTHING");
            fav_qb.build().persistent(false).execute(pool).await?;
        }

        Ok(())
    }

    /**
     * bootstrap_schema
     * 在直连 Postgres 的情况下自动创建必要表结构与索引（开发环境使用）。
     */
    pub async fn bootstrap_schema(&self) -> Result<()> {
        let pool = self
            .postgres
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("Postgres is not configured"))?;

        let sql = include_str!("../database_schema.sql");
        for stmt in split_sql_statements(sql) {
            sqlx::query(&stmt).persistent(false).execute(pool).await?;
        }

        Ok(())
    }

    #[allow(dead_code)]
    pub async fn get_products_count(&self) -> Result<i64> {
        if let Some(pool) = &self.postgres {
            let (count,): (i64,) = sqlx::query_as("SELECT COUNT(*)::bigint FROM products")
                .persistent(false)
                .fetch_one(pool)
                .await?;
            return Ok(count);
        }

        let supabase = self
            .supabase
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("No database configured"))?;

        let mut url = Url::parse(&format!("{}/rest/v1/products", supabase.supabase_url))?;
        url.query_pairs_mut().append_pair("select", "count");

        let response = supabase
            .client
            .get(url)
            .header("apikey", &supabase.supabase_key)
            .header(
                "Authorization",
                &format!("Bearer {}", supabase.supabase_key),
            )
            .header("Accept", "application/json")
            .send()
            .await?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(anyhow::anyhow!(
                "Failed to fetch products count: {}. Body: {}",
                status,
                body
            ));
        }

        let result: Vec<serde_json::Value> = response.json().await?;
        Ok(result
            .first()
            .and_then(|v| v.get("count"))
            .and_then(|v| v.as_i64())
            .unwrap_or(0))
    }
}
