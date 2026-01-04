use crate::models::{
    Category, CreateProductRequest, Developer, DeveloperPopularity, DeveloperWithFollowers,
    Product, QueryParams, UpdateProductRequest,
};
use anyhow::Result;
use chrono::{Datelike, TimeZone};
use reqwest::{Client, Url};
use sqlx::postgres::{PgConnectOptions, PgPool, PgPoolOptions};
use sqlx::{Postgres, QueryBuilder};
use std::borrow::Cow;
use std::env;
use std::str::FromStr;
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
    language: String,
    status: String,
    created_at: chrono::DateTime<chrono::Utc>,
    updated_at: chrono::DateTime<chrono::Utc>,
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
}

#[derive(sqlx::FromRow)]
struct DeveloperWithFollowersRow {
    email: String,
    name: String,
    avatar_url: Option<String>,
    website: Option<String>,
    followers: i64,
}

#[derive(sqlx::FromRow)]
struct DeveloperPopularityRow {
    email: String,
    name: String,
    avatar_url: Option<String>,
    website: Option<String>,
    likes: i64,
    favorites: i64,
    score: i64,
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
    match env::var("DEV_INCLUDE_PENDING_IN_APPROVED") {
        Ok(v) if v.eq_ignore_ascii_case("1") || v.eq_ignore_ascii_case("true") => true,
        _ => env::var("DEV_SEED_TOKEN").is_ok(),
    }
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
        language: row.language,
        status: parse_product_status(&row.status),
        created_at: row.created_at,
        updated_at: row.updated_at,
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
    Developer {
        email: row.email,
        name: row.name,
        avatar_url: row.avatar_url,
        website: row.website,
    }
}

fn map_developer_with_followers_row(row: DeveloperWithFollowersRow) -> DeveloperWithFollowers {
    DeveloperWithFollowers {
        email: row.email,
        name: row.name,
        avatar_url: row.avatar_url,
        website: row.website,
        followers: row.followers,
    }
}

fn map_developer_popularity_row(row: DeveloperPopularityRow) -> DeveloperPopularity {
    DeveloperPopularity {
        email: row.email,
        name: row.name,
        avatar_url: row.avatar_url,
        website: row.website,
        likes: row.likes,
        favorites: row.favorites,
        score: row.score,
    }
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
            let mut options = PgConnectOptions::from_str(&u).ok()?;
            options = options.statement_cache_capacity(0);
            Some(
                PgPoolOptions::new()
                    .max_connections(5)
                    .connect_lazy_with(options),
            )
        });

        if postgres.is_none() && supabase.is_none() {
            panic!("DATABASE_URL or (SUPABASE_URL + SUPABASE_KEY) must be set");
        }

        Self { postgres, supabase }
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
            let mut qb: QueryBuilder<Postgres> = QueryBuilder::new(
                "SELECT \
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
                    created_at, \
                    updated_at \
                 FROM products",
            );

            let mut has_where = false;
            if let Some(category) = &params.category {
                qb.push(if has_where { " AND " } else { " WHERE " });
                has_where = true;
                qb.push("category = ");
                qb.push_bind(category);
            }

            if let Some(language) = &params.language {
                qb.push(if has_where { " AND " } else { " WHERE " });
                has_where = true;
                qb.push("language = ");
                qb.push_bind(language);
            }

            if let Some(status) = &params.status {
                qb.push(if has_where { " AND " } else { " WHERE " });
                has_where = true;
                if dev_include_pending_in_approved() && status == "approved" {
                    qb.push("status::text IN ('approved','pending')");
                } else {
                    qb.push("status::text = ");
                    qb.push_bind(status);
                }
            }

            if let Some(tags) = &params.tags {
                let tag = tags.split(',').next().unwrap_or(tags).trim();
                if !tag.is_empty() {
                    qb.push(if has_where { " AND " } else { " WHERE " });
                    has_where = true;
                    qb.push("tags @> ARRAY[");
                    qb.push_bind(tag);
                    qb.push("]::text[]");
                }
            }

            if let Some(search) = &params.search {
                let q = format!("%{}%", search);
                qb.push(if has_where { " AND " } else { " WHERE " });
                qb.push("(name ILIKE ");
                qb.push_bind(q.clone());
                qb.push(" OR slogan ILIKE ");
                qb.push_bind(q.clone());
                qb.push(" OR description ILIKE ");
                qb.push_bind(q.clone());
                qb.push(" OR maker_name ILIKE ");
                qb.push_bind(q.clone());
                qb.push(" OR maker_email ILIKE ");
                qb.push_bind(q);
                qb.push(")");
            }

            qb.push(" ORDER BY created_at DESC");

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
                .fetch_all(pool)
                .await?;
            return Ok(rows.into_iter().map(map_product_row).collect());
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

            if let Some(limit) = params.limit {
                qp.append_pair("limit", &limit.to_string());
            }

            if let Some(offset) = params.offset {
                qp.append_pair("offset", &offset.to_string());
            }

            qp.append_pair("order", "created_at.desc");
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
                        p.created_at, \
                        p.updated_at \
                     FROM product_favorites f \
                     JOIN products p ON p.id = f.product_id \
                     WHERE f.user_id = $1 AND {} AND p.language = $2 \
                     ORDER BY f.created_at DESC \
                     LIMIT $3",
                    status_clause
                );

                sqlx::query_as::<_, ProductRow>(&sql)
                    .persistent(false)
                    .bind(user_id)
                    .bind(language)
                    .bind(limit)
                    .fetch_all(pool)
                    .await?
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
                        p.created_at, \
                        p.updated_at \
                     FROM product_favorites f \
                     JOIN products p ON p.id = f.product_id \
                     WHERE f.user_id = $1 AND {} \
                     ORDER BY f.created_at DESC \
                     LIMIT $2",
                    status_clause
                );

                sqlx::query_as::<_, ProductRow>(&sql)
                    .persistent(false)
                    .bind(user_id)
                    .bind(limit)
                    .fetch_all(pool)
                    .await?
            };

            return Ok(rows.into_iter().map(map_product_row).collect());
        }

        Ok(Vec::new())
    }

    pub async fn get_product_by_id(&self, id: &str) -> Result<Option<Product>> {
        if let Some(pool) = &self.postgres {
            let row = sqlx::query_as::<_, ProductRow>(
                "SELECT \
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
                    created_at, \
                    updated_at \
                 FROM products \
                 WHERE id::text = $1 \
                 LIMIT 1",
            )
            .persistent(false)
            .bind(id)
            .fetch_optional(pool)
            .await?;
            return Ok(row.map(map_product_row));
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
                    created_at, \
                    updated_at",
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
            {
                return self.get_product_by_id(id).await;
            }

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
                    created_at, \
                    updated_at",
            );

            let row = qb
                .build_query_as::<ProductRow>()
                .persistent(false)
                .fetch_optional(pool)
                .await?;
            return Ok(row.map(map_product_row));
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
            .patch(url)
            .header("apikey", &supabase.supabase_key)
            .header(
                "Authorization",
                &format!("Bearer {}", supabase.supabase_key),
            )
            .header("Accept", "application/json")
            .header("Prefer", "return=representation")
            .json(&updates)
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

    pub async fn search_developers(&self, query: &str, limit: i64) -> Result<Vec<Developer>> {
        let limit = limit.clamp(1, 50);

        if let Some(pool) = &self.postgres {
            let q = format!("%{}%", query);
            let rows = sqlx::query_as::<_, DeveloperRow>(
                "SELECT email, name, avatar_url, website \
                 FROM developers \
                 WHERE name ILIKE $1 OR email ILIKE $1 OR website ILIKE $1 \
                 ORDER BY name ASC \
                 LIMIT $2",
            )
            .persistent(false)
            .bind(q)
            .bind(limit)
            .fetch_all(pool)
            .await?;

            return Ok(rows.into_iter().map(map_developer_row).collect());
        }

        Ok(Vec::new())
    }

    pub async fn get_top_developers_by_followers(
        &self,
        limit: i64,
    ) -> Result<Vec<DeveloperWithFollowers>> {
        let limit = limit.clamp(1, 50);

        if let Some(pool) = &self.postgres {
            let rows = sqlx::query_as::<_, DeveloperWithFollowersRow>(
                "SELECT \
                    d.email, \
                    d.name, \
                    d.avatar_url, \
                    d.website, \
                    COALESCE(COUNT(f.id), 0)::bigint as followers \
                 FROM developers d \
                 LEFT JOIN developer_follows f ON f.developer_email = d.email \
                 GROUP BY d.email, d.name, d.avatar_url, d.website \
                 ORDER BY followers DESC, d.name ASC \
                 LIMIT $1",
            )
            .persistent(false)
            .bind(limit)
            .fetch_all(pool)
            .await?;

            return Ok(rows
                .into_iter()
                .map(map_developer_with_followers_row)
                .collect());
        }

        Ok(Vec::new())
    }

    pub async fn get_recent_developers_by_created_at(
        &self,
        limit: i64,
    ) -> Result<Vec<DeveloperWithFollowers>> {
        let limit = limit.clamp(1, 50);

        if let Some(pool) = &self.postgres {
            let rows = sqlx::query_as::<_, DeveloperWithFollowersRow>(
                "SELECT \
                    d.email, \
                    d.name, \
                    d.avatar_url, \
                    d.website, \
                    COALESCE(COUNT(f.id), 0)::bigint as followers \
                 FROM developers d \
                 LEFT JOIN developer_follows f ON f.developer_email = d.email \
                 GROUP BY d.email, d.name, d.avatar_url, d.website, d.created_at \
                 ORDER BY d.created_at DESC, d.name ASC \
                 LIMIT $1",
            )
            .persistent(false)
            .bind(limit)
            .fetch_all(pool)
            .await?;

            return Ok(rows
                .into_iter()
                .map(map_developer_with_followers_row)
                .collect());
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
            .fetch_all(pool)
            .await?;

            return Ok(rows.into_iter().map(map_developer_popularity_row).collect());
        }

        Ok(Vec::new())
    }

    pub async fn follow_developer(&self, email: &str, user_id: &str) -> Result<()> {
        if let Some(pool) = &self.postgres {
            sqlx::query(
                "INSERT INTO developer_follows (developer_email, user_id) \
                 VALUES ($1, $2) \
                 ON CONFLICT (developer_email, user_id) DO NOTHING",
            )
            .persistent(false)
            .bind(email)
            .bind(user_id)
            .execute(pool)
            .await?;
            return Ok(());
        }

        Err(anyhow::anyhow!("No database configured"))
    }

    pub async fn unfollow_developer(&self, email: &str, user_id: &str) -> Result<()> {
        if let Some(pool) = &self.postgres {
            sqlx::query(
                "DELETE FROM developer_follows \
                 WHERE developer_email = $1 AND user_id = $2",
            )
            .persistent(false)
            .bind(email)
            .bind(user_id)
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

    pub async fn seed_engagement(&self, product_ids: &[String]) -> Result<()> {
        if product_ids.is_empty() {
            return Ok(());
        }

        let pool = self
            .postgres
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("Postgres is not configured"))?;

        let products = sqlx::query_as::<_, ProductRow>(
            "SELECT \
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
                created_at, \
                updated_at \
             FROM products \
             WHERE id::text = ANY($1)",
        )
        .persistent(false)
        .bind(product_ids)
        .fetch_all(pool)
        .await?;

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
