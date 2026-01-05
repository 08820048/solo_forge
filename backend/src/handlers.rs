use crate::db::Database;
use crate::models::{
    ApiError, ApiResponse, CreateProductRequest, EmptyApiResponse, Product, ProductApiResponse,
    ProductsApiResponse, QueryParams, SearchApiResponse, SearchResult, UpdateProductRequest,
};
use actix_web::{get, web, HttpRequest, HttpResponse, Responder};
use chrono::{Duration, Utc};
use serde::{Deserialize, Serialize};
use std::collections::hash_map::DefaultHasher;
use std::env;
use std::hash::{Hash, Hasher};
use std::sync::Arc;
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

/**
 * is_db_unavailable_error
 * 判断是否属于数据库未配置/不可用/鉴权失败这类可降级错误（Supabase 或 Postgres）。
 */
fn is_db_unavailable_error(err: &anyhow::Error) -> bool {
    let msg = format!("{:?}", err).to_ascii_lowercase();
    msg.contains("no database configured")
        || msg.contains("supabase auth failed")
        || msg.contains("invalid api key")
        || msg.contains("401 unauthorized")
        || msg.contains("403 forbidden")
        || msg.contains("operation timed out")
        || msg.contains("client error (connect)")
        || msg.contains("connection timed out")
        || msg.contains("connection refused")
        || msg.contains("error connecting")
        || msg.contains("decoding column")
        || msg.contains("value buffer exceeds 8 bytes while decoding to integer type")
        || msg.contains("invalid byte sequence for encoding")
        || msg.contains("encoding \"utf8\"")
        || msg.contains("null character not permitted")
        || msg.contains("password authentication failed")
        || msg.contains("could not translate host name")
        || msg.contains("pool timed out")
        || msg.contains("statement timeout")
        || msg.contains("canceling statement due to statement timeout")
        || msg.contains("prepared statement")
        || msg.contains("bind message supplies")
        || msg.contains("insufficient data left in message")
}

/**
 * get_language_from_request
 * 从请求头提取语言，默认 en。
 */
fn get_language_from_request(req: &HttpRequest) -> &str {
    req.headers()
        .get("Accept-Language")
        .and_then(|h| h.to_str().ok())
        .unwrap_or("en")
}

fn new_trace_id() -> String {
    Uuid::new_v4().to_string()
}

fn is_api_diagnostics_enabled() -> bool {
    matches!(
        env::var("SF_API_DIAGNOSTICS").ok().as_deref(),
        Some("1" | "true" | "TRUE")
    )
}

fn error_detail_for_client(err: &anyhow::Error) -> Option<String> {
    if !is_api_diagnostics_enabled() {
        return None;
    }
    let raw = format!("{:?}", err);
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    let max_len = 800usize;
    Some(trimmed.chars().take(max_len).collect())
}

fn make_db_degraded_error(endpoint: &str, err: &anyhow::Error) -> ApiError {
    let trace_id = new_trace_id();
    log::warn!(
        "db degraded endpoint={} trace_id={} err={:?}",
        endpoint,
        trace_id,
        err
    );
    ApiError {
        code: "DB_DEGRADED".to_string(),
        trace_id,
        degraded: true,
        hint: Some("查看后端日志并按 trace_id 定位具体数据库错误。".to_string()),
        detail: error_detail_for_client(err),
    }
}

fn make_db_degraded_response<T>(
    endpoint: &str,
    data: T,
    message: String,
    err: &anyhow::Error,
) -> ApiResponse<T> {
    ApiResponse {
        success: true,
        data: Some(data),
        message: Some(message),
        error: Some(make_db_degraded_error(endpoint, err)),
    }
}

#[derive(Debug, Serialize, ToSchema)]
pub struct HealthCheckResponse {
    pub status: String,
    pub timestamp: String,
}

#[utoipa::path(
    get,
    path = "/api/health",
    responses((status = 200, body = HealthCheckResponse))
)]
#[get("/health")]
pub async fn health_check() -> impl Responder {
    HttpResponse::Ok().json(HealthCheckResponse {
        status: "ok".to_string(),
        timestamp: Utc::now().to_rfc3339(),
    })
}

#[utoipa::path(
    get,
    path = "/api/products",
    params(QueryParams),
    responses(
        (status = 200, body = ProductsApiResponse),
        (status = 500, body = EmptyApiResponse)
    )
)]
pub async fn get_products(
    query: web::Query<QueryParams>,
    db: web::Data<Arc<Database>>,
) -> impl Responder {
    match db.get_products(query.into_inner()).await {
        Ok(products) => HttpResponse::Ok().json(ApiResponse::success(products)),
        Err(e) => {
            if is_db_unavailable_error(&e) {
                return HttpResponse::Ok().json(make_db_degraded_response(
                    "GET /api/products",
                    Vec::<crate::models::Product>::new(),
                    "数据库连接不可用，已降级返回空列表。".to_string(),
                    &e,
                ));
            }

            HttpResponse::InternalServerError()
                .json(ApiResponse::<()>::error(format!("Database error: {:?}", e)))
        }
    }
}

#[derive(Debug, Deserialize, IntoParams, ToSchema)]
pub struct SearchQuery {
    pub q: Option<String>,
    pub limit: Option<i64>,
    pub language: Option<String>,
}

#[utoipa::path(
    get,
    path = "/api/search",
    params(SearchQuery),
    responses(
        (status = 200, body = SearchApiResponse),
        (status = 500, body = EmptyApiResponse)
    )
)]
pub async fn search(
    req: HttpRequest,
    query: web::Query<SearchQuery>,
    db: web::Data<Arc<Database>>,
) -> impl Responder {
    let q = query.q.clone().unwrap_or_default();
    let q = q.trim();
    if q.is_empty() {
        return HttpResponse::Ok().json(ApiResponse::success(SearchResult {
            products: Vec::new(),
            developers: Vec::new(),
        }));
    }

    let limit = query.limit.unwrap_or(8).clamp(1, 20);
    let params = QueryParams {
        category: None,
        tags: None,
        language: query.language.clone(),
        status: Some("approved".to_string()),
        search: Some(q.to_string()),
        sort: None,
        dir: None,
        limit: Some(limit),
        offset: None,
    };

    let result = async {
        let products = db.get_products(params).await?;
        let developers = db.search_developers(q, limit).await?;
        Ok::<_, anyhow::Error>((products, developers))
    }
    .await;

    match result {
        Ok((products, developers)) => HttpResponse::Ok().json(ApiResponse::success(SearchResult {
            products,
            developers,
        })),
        Err(e) => {
            if is_db_unavailable_error(&e) {
                let lang = get_language_from_request(&req);
                let message = if lang.starts_with("zh") {
                    "数据库连接不可用，已降级返回空搜索结果。"
                } else {
                    "Database is unavailable. Search results are empty in degraded mode."
                };

                return HttpResponse::Ok().json(make_db_degraded_response(
                    "GET /api/search",
                    SearchResult {
                        products: Vec::new(),
                        developers: Vec::new(),
                    },
                    message.to_string(),
                    &e,
                ));
            }

            HttpResponse::InternalServerError()
                .json(ApiResponse::<()>::error(format!("Database error: {:?}", e)))
        }
    }
}

#[utoipa::path(
    get,
    path = "/api/products/{id}",
    params(("id" = String, Path)),
    responses(
        (status = 200, body = ProductApiResponse),
        (status = 404, body = EmptyApiResponse),
        (status = 500, body = EmptyApiResponse)
    )
)]
pub async fn get_product_by_id(
    path: web::Path<String>,
    db: web::Data<Arc<Database>>,
) -> impl Responder {
    let id = path.into_inner();

    match db.get_product_by_id(&id).await {
        Ok(Some(product)) => HttpResponse::Ok().json(ApiResponse::success(product)),
        Ok(None) => {
            HttpResponse::NotFound().json(ApiResponse::<()>::error("Product not found".to_string()))
        }
        Err(e) => HttpResponse::InternalServerError()
            .json(ApiResponse::<()>::error(format!("Database error: {:?}", e))),
    }
}

#[utoipa::path(
    post,
    path = "/api/products",
    request_body = CreateProductRequest,
    responses(
        (status = 201, body = ProductApiResponse),
        (status = 500, body = EmptyApiResponse)
    )
)]
pub async fn create_product(
    req: HttpRequest,
    product_data: web::Json<CreateProductRequest>,
    db: web::Data<Arc<Database>>,
) -> impl Responder {
    // Get language from Accept-Language header
    let lang = req
        .headers()
        .get("Accept-Language")
        .and_then(|h| h.to_str().ok())
        .unwrap_or("en");

    match db.create_product(product_data.into_inner()).await {
        Ok(product) => {
            let message = if lang.starts_with("zh") {
                "产品提交成功，等待审核"
            } else {
                "Product submitted successfully, pending review"
            };

            HttpResponse::Created().json(ApiResponse {
                success: true,
                data: Some(product),
                message: Some(message.to_string()),
                error: None,
            })
        }
        Err(e) => HttpResponse::InternalServerError()
            .json(ApiResponse::<()>::error(format!("Database error: {:?}", e))),
    }
}

pub async fn update_product(
    path: web::Path<String>,
    update_data: web::Json<UpdateProductRequest>,
    db: web::Data<Arc<Database>>,
) -> impl Responder {
    let id = path.into_inner();

    match db.update_product(&id, update_data.into_inner()).await {
        Ok(Some(product)) => HttpResponse::Ok().json(ApiResponse::success(product)),
        Ok(None) => {
            HttpResponse::NotFound().json(ApiResponse::<()>::error("Product not found".to_string()))
        }
        Err(e) => HttpResponse::InternalServerError()
            .json(ApiResponse::<()>::error(format!("Database error: {:?}", e))),
    }
}

pub async fn delete_product(
    path: web::Path<String>,
    db: web::Data<Arc<Database>>,
) -> impl Responder {
    let id = path.into_inner();

    match db.delete_product(&id).await {
        Ok(true) => HttpResponse::Ok().json(ApiResponse {
            success: true,
            data: Some(DeletedIdPayload { id }),
            message: Some("Product deleted successfully".to_string()),
            error: None,
        }),
        Ok(false) => {
            HttpResponse::NotFound().json(ApiResponse::<()>::error("Product not found".to_string()))
        }
        Err(e) => HttpResponse::InternalServerError()
            .json(ApiResponse::<()>::error(format!("Database error: {:?}", e))),
    }
}

pub async fn get_categories(db: web::Data<Arc<Database>>) -> impl Responder {
    match db.get_categories().await {
        Ok(categories) => HttpResponse::Ok().json(ApiResponse::success(categories)),
        Err(e) => {
            if is_db_unavailable_error(&e) {
                return HttpResponse::Ok().json(make_db_degraded_response(
                    "GET /api/categories",
                    Vec::<crate::models::Category>::new(),
                    "数据库连接不可用，已降级返回空列表。".to_string(),
                    &e,
                ));
            }

            HttpResponse::InternalServerError()
                .json(ApiResponse::<()>::error(format!("Database error: {:?}", e)))
        }
    }
}

#[derive(Debug, Deserialize, IntoParams, ToSchema)]
pub struct TopCategoriesQuery {
    pub limit: Option<i64>,
}

pub async fn get_top_categories(
    query: web::Query<TopCategoriesQuery>,
    db: web::Data<Arc<Database>>,
) -> impl Responder {
    let limit = query.limit.unwrap_or(10).clamp(1, 50);
    match db.get_top_categories_by_product_count(limit).await {
        Ok(list) => HttpResponse::Ok().json(ApiResponse::success(list)),
        Err(e) => {
            if is_db_unavailable_error(&e) {
                return HttpResponse::Ok().json(make_db_degraded_response(
                    "GET /api/categories/top",
                    Vec::<crate::models::CategoryWithCount>::new(),
                    "数据库连接不可用，已降级返回空列表。".to_string(),
                    &e,
                ));
            }

            HttpResponse::InternalServerError()
                .json(ApiResponse::<()>::error(format!("Database error: {:?}", e)))
        }
    }
}

#[derive(Debug, Deserialize, IntoParams, ToSchema)]
pub struct TopDevelopersQuery {
    pub limit: Option<i64>,
}

pub async fn get_top_developers(
    query: web::Query<TopDevelopersQuery>,
    db: web::Data<Arc<Database>>,
) -> impl Responder {
    let limit = query.limit.unwrap_or(4).clamp(1, 20);
    match db.get_top_developers_by_followers(limit).await {
        Ok(list) => HttpResponse::Ok().json(ApiResponse::success(list)),
        Err(e) => {
            if is_db_unavailable_error(&e) {
                return HttpResponse::Ok().json(make_db_degraded_response(
                    "GET /api/developers/top",
                    Vec::<crate::models::DeveloperWithFollowers>::new(),
                    "数据库连接不可用，已降级返回空列表。".to_string(),
                    &e,
                ));
            }
            HttpResponse::InternalServerError()
                .json(ApiResponse::<()>::error(format!("Database error: {:?}", e)))
        }
    }
}

pub async fn get_recent_developers(
    query: web::Query<TopDevelopersQuery>,
    db: web::Data<Arc<Database>>,
) -> impl Responder {
    let limit = query.limit.unwrap_or(4).clamp(1, 20);
    match db.get_recent_developers_by_created_at(limit).await {
        Ok(list) => HttpResponse::Ok().json(ApiResponse::success(list)),
        Err(e) => {
            if is_db_unavailable_error(&e) {
                return HttpResponse::Ok().json(make_db_degraded_response(
                    "GET /api/developers/recent",
                    Vec::<crate::models::DeveloperWithFollowers>::new(),
                    "数据库连接不可用，已降级返回空列表。".to_string(),
                    &e,
                ));
            }
            HttpResponse::InternalServerError()
                .json(ApiResponse::<()>::error(format!("Database error: {:?}", e)))
        }
    }
}

#[derive(Debug, Deserialize, IntoParams, ToSchema)]
pub struct DeveloperPopularityQuery {
    pub limit: Option<i64>,
}

pub async fn get_developer_popularity_last_month(
    query: web::Query<DeveloperPopularityQuery>,
    db: web::Data<Arc<Database>>,
) -> impl Responder {
    let limit = query.limit.unwrap_or(10).clamp(1, 50);
    match db.get_developer_popularity_last_month(limit).await {
        Ok(list) => HttpResponse::Ok().json(ApiResponse::success(list)),
        Err(e) => {
            if is_db_unavailable_error(&e) {
                return HttpResponse::Ok().json(make_db_degraded_response(
                    "GET /api/developers/popularity-last-month",
                    Vec::<crate::models::DeveloperPopularity>::new(),
                    "数据库连接不可用，已降级返回空列表。".to_string(),
                    &e,
                ));
            }
            HttpResponse::InternalServerError()
                .json(ApiResponse::<()>::error(format!("Database error: {:?}", e)))
        }
    }
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct InteractionBody {
    pub user_id: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct OkPayload {
    pub ok: bool,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct DeletedIdPayload {
    pub id: String,
}

/**
 * extract_user_id
 * 从交互请求体提取用户标识（并做 trim），缺失则返回 None。
 */
fn extract_user_id(body: &Option<web::Json<InteractionBody>>) -> Option<String> {
    body.as_ref()
        .and_then(|b| b.user_id.clone())
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

/**
 * is_anonymous_user_id
 * 判断是否为匿名用户标识（前端曾使用 anon_ 前缀）。
 */
fn is_anonymous_user_id(user_id: &str) -> bool {
    user_id.to_ascii_lowercase().starts_with("anon_")
}

fn is_same_user_email(a: &str, b: &str) -> bool {
    let left = a.trim();
    let right = b.trim();
    if left.is_empty() || right.is_empty() {
        return false;
    }
    left.eq_ignore_ascii_case(right)
}

pub async fn follow_developer(
    path: web::Path<String>,
    body: Option<web::Json<InteractionBody>>,
    db: web::Data<Arc<Database>>,
) -> impl Responder {
    let email = path.into_inner();
    let user_id = match extract_user_id(&body) {
        Some(v) if !is_anonymous_user_id(&v) => v,
        _ => {
            return HttpResponse::Unauthorized()
                .json(ApiResponse::<()>::error("Unauthorized".to_string()))
        }
    };
    if is_same_user_email(&email, &user_id) {
        return HttpResponse::BadRequest().json(ApiResponse::<()>::error(
            "Cannot follow yourself".to_string(),
        ));
    }

    match db.follow_developer(&email, &user_id).await {
        Ok(()) => HttpResponse::Ok().json(ApiResponse::success(OkPayload { ok: true })),
        Err(e) => {
            if is_db_unavailable_error(&e) {
                return HttpResponse::Ok().json(make_db_degraded_response(
                    "POST /api/developers/{email}/follow",
                    OkPayload { ok: false },
                    "数据库连接不可用，已降级忽略写入。".to_string(),
                    &e,
                ));
            }
            HttpResponse::InternalServerError()
                .json(ApiResponse::<()>::error(format!("Database error: {:?}", e)))
        }
    }
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct DeveloperPath {
    pub email: String,
}

pub async fn get_developer_by_email(
    path: web::Path<DeveloperPath>,
    db: web::Data<Arc<Database>>,
) -> impl Responder {
    let email = path.into_inner().email.trim().to_ascii_lowercase();

    match db.get_developer_by_email(&email).await {
        Ok(Some(dev)) => HttpResponse::Ok().json(ApiResponse::success(dev)),
        Ok(None) => HttpResponse::NotFound()
            .json(ApiResponse::<()>::error("Developer not found".to_string())),
        Err(e) => HttpResponse::InternalServerError()
            .json(ApiResponse::<()>::error(format!("Database error: {:?}", e))),
    }
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct UpdateDeveloperRequest {
    pub user_id: Option<String>,
    pub name: Option<String>,
    pub avatar_url: Option<Option<String>>,
    pub website: Option<Option<String>>,
}

pub async fn update_developer_profile(
    path: web::Path<DeveloperPath>,
    body: web::Json<UpdateDeveloperRequest>,
    db: web::Data<Arc<Database>>,
) -> impl Responder {
    let email = path.into_inner().email.trim().to_ascii_lowercase();

    let user_id = body.user_id.as_deref().unwrap_or("").trim().to_string();
    if user_id.is_empty() || is_anonymous_user_id(&user_id) || user_id.to_ascii_lowercase() != email
    {
        return HttpResponse::Unauthorized()
            .json(ApiResponse::<()>::error("Unauthorized".to_string()));
    }

    let name = body
        .name
        .as_ref()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty());
    let avatar_url = body.avatar_url.clone().map(|v| {
        v.and_then(|s| {
            let trimmed = s.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        })
    });
    let website = body.website.clone().map(|v| {
        v.and_then(|s| {
            let trimmed = s.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        })
    });

    match db
        .update_developer_profile(&email, name, avatar_url, website)
        .await
    {
        Ok(dev) => HttpResponse::Ok().json(ApiResponse::success(dev)),
        Err(e) => HttpResponse::InternalServerError()
            .json(ApiResponse::<()>::error(format!("Database error: {:?}", e))),
    }
}

pub async fn unfollow_developer(
    path: web::Path<String>,
    body: Option<web::Json<InteractionBody>>,
    db: web::Data<Arc<Database>>,
) -> impl Responder {
    let email = path.into_inner();
    let user_id = match extract_user_id(&body) {
        Some(v) if !is_anonymous_user_id(&v) => v,
        _ => {
            return HttpResponse::Unauthorized()
                .json(ApiResponse::<()>::error("Unauthorized".to_string()))
        }
    };
    if is_same_user_email(&email, &user_id) {
        return HttpResponse::BadRequest().json(ApiResponse::<()>::error(
            "Cannot unfollow yourself".to_string(),
        ));
    }

    match db.unfollow_developer(&email, &user_id).await {
        Ok(()) => HttpResponse::Ok().json(ApiResponse::success(OkPayload { ok: true })),
        Err(e) => {
            if is_db_unavailable_error(&e) {
                return HttpResponse::Ok().json(make_db_degraded_response(
                    "POST /api/developers/{email}/unfollow",
                    OkPayload { ok: false },
                    "数据库连接不可用，已降级忽略写入。".to_string(),
                    &e,
                ));
            }
            HttpResponse::InternalServerError()
                .json(ApiResponse::<()>::error(format!("Database error: {:?}", e)))
        }
    }
}

pub async fn like_product(
    path: web::Path<String>,
    body: Option<web::Json<InteractionBody>>,
    db: web::Data<Arc<Database>>,
) -> impl Responder {
    let product_id = path.into_inner();
    let user_id = match extract_user_id(&body) {
        Some(v) if !is_anonymous_user_id(&v) => v,
        _ => {
            return HttpResponse::Unauthorized()
                .json(ApiResponse::<()>::error("Unauthorized".to_string()))
        }
    };

    let product = match db.get_product_by_id(&product_id).await {
        Ok(Some(v)) => v,
        Ok(None) => {
            return HttpResponse::NotFound()
                .json(ApiResponse::<()>::error("Product not found".to_string()))
        }
        Err(e) => {
            if is_db_unavailable_error(&e) {
                return HttpResponse::Ok().json(make_db_degraded_response(
                    "POST /api/products/{id}/like",
                    OkPayload { ok: false },
                    "数据库连接不可用，已降级忽略写入。".to_string(),
                    &e,
                ));
            }
            return HttpResponse::InternalServerError()
                .json(ApiResponse::<()>::error(format!("Database error: {:?}", e)));
        }
    };
    if is_same_user_email(&product.maker_email, &user_id) {
        return HttpResponse::BadRequest().json(ApiResponse::<()>::error(
            "Cannot like your own product".to_string(),
        ));
    }

    match db.like_product(&product_id, &user_id).await {
        Ok(()) => HttpResponse::Ok().json(ApiResponse::success(OkPayload { ok: true })),
        Err(e) => {
            if is_db_unavailable_error(&e) {
                return HttpResponse::Ok().json(make_db_degraded_response(
                    "POST /api/products/{id}/like",
                    OkPayload { ok: false },
                    "数据库连接不可用，已降级忽略写入。".to_string(),
                    &e,
                ));
            }
            HttpResponse::InternalServerError()
                .json(ApiResponse::<()>::error(format!("Database error: {:?}", e)))
        }
    }
}

pub async fn unlike_product(
    path: web::Path<String>,
    body: Option<web::Json<InteractionBody>>,
    db: web::Data<Arc<Database>>,
) -> impl Responder {
    let product_id = path.into_inner();
    let user_id = match extract_user_id(&body) {
        Some(v) if !is_anonymous_user_id(&v) => v,
        _ => {
            return HttpResponse::Unauthorized()
                .json(ApiResponse::<()>::error("Unauthorized".to_string()))
        }
    };

    let product = match db.get_product_by_id(&product_id).await {
        Ok(Some(v)) => v,
        Ok(None) => {
            return HttpResponse::NotFound()
                .json(ApiResponse::<()>::error("Product not found".to_string()))
        }
        Err(e) => {
            if is_db_unavailable_error(&e) {
                return HttpResponse::Ok().json(make_db_degraded_response(
                    "POST /api/products/{id}/unlike",
                    OkPayload { ok: false },
                    "数据库连接不可用，已降级忽略写入。".to_string(),
                    &e,
                ));
            }
            return HttpResponse::InternalServerError()
                .json(ApiResponse::<()>::error(format!("Database error: {:?}", e)));
        }
    };
    if is_same_user_email(&product.maker_email, &user_id) {
        return HttpResponse::BadRequest().json(ApiResponse::<()>::error(
            "Cannot unlike your own product".to_string(),
        ));
    }

    match db.unlike_product(&product_id, &user_id).await {
        Ok(()) => HttpResponse::Ok().json(ApiResponse::success(OkPayload { ok: true })),
        Err(e) => {
            if is_db_unavailable_error(&e) {
                return HttpResponse::Ok().json(make_db_degraded_response(
                    "POST /api/products/{id}/unlike",
                    OkPayload { ok: false },
                    "数据库连接不可用，已降级忽略写入。".to_string(),
                    &e,
                ));
            }
            HttpResponse::InternalServerError()
                .json(ApiResponse::<()>::error(format!("Database error: {:?}", e)))
        }
    }
}

pub async fn favorite_product(
    path: web::Path<String>,
    body: Option<web::Json<InteractionBody>>,
    db: web::Data<Arc<Database>>,
) -> impl Responder {
    let product_id = path.into_inner();
    let user_id = match extract_user_id(&body) {
        Some(v) if !is_anonymous_user_id(&v) => v,
        _ => {
            return HttpResponse::Unauthorized()
                .json(ApiResponse::<()>::error("Unauthorized".to_string()))
        }
    };

    let product = match db.get_product_by_id(&product_id).await {
        Ok(Some(v)) => v,
        Ok(None) => {
            return HttpResponse::NotFound()
                .json(ApiResponse::<()>::error("Product not found".to_string()))
        }
        Err(e) => {
            if is_db_unavailable_error(&e) {
                return HttpResponse::Ok().json(make_db_degraded_response(
                    "POST /api/products/{id}/favorite",
                    OkPayload { ok: false },
                    "数据库连接不可用，已降级忽略写入。".to_string(),
                    &e,
                ));
            }
            return HttpResponse::InternalServerError()
                .json(ApiResponse::<()>::error(format!("Database error: {:?}", e)));
        }
    };
    if is_same_user_email(&product.maker_email, &user_id) {
        return HttpResponse::BadRequest().json(ApiResponse::<()>::error(
            "Cannot favorite your own product".to_string(),
        ));
    }

    match db.favorite_product(&product_id, &user_id).await {
        Ok(()) => HttpResponse::Ok().json(ApiResponse::success(OkPayload { ok: true })),
        Err(e) => {
            if is_db_unavailable_error(&e) {
                return HttpResponse::Ok().json(make_db_degraded_response(
                    "POST /api/products/{id}/favorite",
                    OkPayload { ok: false },
                    "数据库连接不可用，已降级忽略写入。".to_string(),
                    &e,
                ));
            }
            HttpResponse::InternalServerError()
                .json(ApiResponse::<()>::error(format!("Database error: {:?}", e)))
        }
    }
}

pub async fn unfavorite_product(
    path: web::Path<String>,
    body: Option<web::Json<InteractionBody>>,
    db: web::Data<Arc<Database>>,
) -> impl Responder {
    let product_id = path.into_inner();
    let user_id = match extract_user_id(&body) {
        Some(v) if !is_anonymous_user_id(&v) => v,
        _ => {
            return HttpResponse::Unauthorized()
                .json(ApiResponse::<()>::error("Unauthorized".to_string()))
        }
    };

    let product = match db.get_product_by_id(&product_id).await {
        Ok(Some(v)) => v,
        Ok(None) => {
            return HttpResponse::NotFound()
                .json(ApiResponse::<()>::error("Product not found".to_string()))
        }
        Err(e) => {
            if is_db_unavailable_error(&e) {
                return HttpResponse::Ok().json(make_db_degraded_response(
                    "POST /api/products/{id}/unfavorite",
                    OkPayload { ok: false },
                    "数据库连接不可用，已降级忽略写入。".to_string(),
                    &e,
                ));
            }
            return HttpResponse::InternalServerError()
                .json(ApiResponse::<()>::error(format!("Database error: {:?}", e)));
        }
    };
    if is_same_user_email(&product.maker_email, &user_id) {
        return HttpResponse::BadRequest().json(ApiResponse::<()>::error(
            "Cannot unfavorite your own product".to_string(),
        ));
    }

    match db.unfavorite_product(&product_id, &user_id).await {
        Ok(()) => HttpResponse::Ok().json(ApiResponse::success(OkPayload { ok: true })),
        Err(e) => {
            if is_db_unavailable_error(&e) {
                return HttpResponse::Ok().json(make_db_degraded_response(
                    "POST /api/products/{id}/unfavorite",
                    OkPayload { ok: false },
                    "数据库连接不可用，已降级忽略写入。".to_string(),
                    &e,
                ));
            }
            HttpResponse::InternalServerError()
                .json(ApiResponse::<()>::error(format!("Database error: {:?}", e)))
        }
    }
}

#[derive(Debug, Deserialize, IntoParams, ToSchema)]
pub struct FavoriteProductsQuery {
    pub user_id: String,
    pub limit: Option<i64>,
    pub language: Option<String>,
}

pub async fn get_favorite_products(
    req: HttpRequest,
    query: web::Query<FavoriteProductsQuery>,
    db: web::Data<Arc<Database>>,
) -> impl Responder {
    let limit = query.limit.unwrap_or(50).clamp(1, 200);
    let user_id = query.user_id.trim().to_string();
    let language = query.language.clone();

    if user_id.is_empty() {
        return HttpResponse::BadRequest()
            .json(ApiResponse::<()>::error("Missing user_id".to_string()));
    }

    match db
        .get_favorite_products(&user_id, language.as_deref(), limit)
        .await
    {
        Ok(list) => HttpResponse::Ok().json(ApiResponse::success(list)),
        Err(e) => {
            if is_db_unavailable_error(&e) {
                let lang = get_language_from_request(&req);
                let message = if lang.starts_with("zh") {
                    "数据库连接不可用，已降级返回空列表。"
                } else {
                    "Database is unavailable. Returning empty list in degraded mode."
                };

                return HttpResponse::Ok().json(make_db_degraded_response(
                    "GET /api/products/favorites",
                    Vec::<crate::models::Product>::new(),
                    message.to_string(),
                    &e,
                ));
            }

            HttpResponse::InternalServerError()
                .json(ApiResponse::<()>::error(format!("Database error: {:?}", e)))
        }
    }
}

#[derive(Debug, Deserialize, IntoParams, ToSchema)]
pub struct LeaderboardQuery {
    pub window: Option<String>,
    pub limit: Option<i64>,
    pub language: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct MakerRank {
    pub maker_name: String,
    pub product_count: usize,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct LeaderboardData {
    pub top_products: Vec<Product>,
    pub top_makers: Vec<MakerRank>,
}

pub async fn get_leaderboard(
    req: HttpRequest,
    query: web::Query<LeaderboardQuery>,
    db: web::Data<Arc<Database>>,
) -> impl Responder {
    let limit = query.limit.unwrap_or(20).clamp(1, 100) as usize;

    let window = query
        .window
        .as_deref()
        .unwrap_or("week")
        .to_ascii_lowercase();

    let threshold = match window.as_str() {
        "day" | "daily" => Some(Utc::now() - Duration::days(1)),
        "week" | "weekly" => Some(Utc::now() - Duration::days(7)),
        "month" | "monthly" => Some(Utc::now() - Duration::days(30)),
        "all" | "alltime" => None,
        _ => Some(Utc::now() - Duration::days(7)),
    };

    let params = QueryParams {
        category: None,
        tags: None,
        language: query.language.clone(),
        status: Some("approved".to_string()),
        search: None,
        sort: None,
        dir: None,
        limit: Some((limit as i64) * 5),
        offset: None,
    };

    let products = match db.get_products(params).await {
        Ok(products) => products,
        Err(e) => {
            if is_db_unavailable_error(&e) {
                let lang = get_language_from_request(&req);
                let message = if lang.starts_with("zh") {
                    "数据库连接不可用，排行榜已降级为暂无数据。"
                } else {
                    "Database is unavailable. Leaderboard is empty in degraded mode."
                };

                return HttpResponse::Ok().json(make_db_degraded_response(
                    "GET /api/leaderboard",
                    LeaderboardData {
                        top_products: Vec::new(),
                        top_makers: Vec::new(),
                    },
                    message.to_string(),
                    &e,
                ));
            }

            return HttpResponse::InternalServerError()
                .json(ApiResponse::<()>::error(format!("Database error: {:?}", e)));
        }
    };

    let mut filtered: Vec<_> = match threshold {
        Some(ts) => products
            .into_iter()
            .filter(|p| p.created_at >= ts)
            .collect(),
        None => products,
    };

    filtered.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    let top_products = filtered.into_iter().take(limit).collect::<Vec<_>>();

    let mut maker_counts = std::collections::HashMap::<String, usize>::new();
    for product in &top_products {
        *maker_counts.entry(product.maker_name.clone()).or_insert(0) += 1;
    }

    let mut top_makers = maker_counts
        .into_iter()
        .map(|(maker_name, product_count)| MakerRank {
            maker_name,
            product_count,
        })
        .collect::<Vec<_>>();
    top_makers.sort_by(|a, b| b.product_count.cmp(&a.product_count));
    top_makers.truncate(10);

    HttpResponse::Ok().json(ApiResponse::success(LeaderboardData {
        top_products,
        top_makers,
    }))
}

#[derive(Debug, Deserialize, IntoParams, ToSchema)]
pub struct HomeModuleQuery {
    pub language: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct HomeProductsPayload {
    pub products: Vec<Product>,
    pub next_refresh_at: String,
}

fn start_of_next_day_utc(now: chrono::DateTime<Utc>) -> chrono::DateTime<Utc> {
    let today = now.date_naive();
    let next = today
        .succ_opt()
        .unwrap_or_else(|| today + chrono::Duration::days(1));
    chrono::DateTime::<Utc>::from_naive_utc_and_offset(next.and_hms_opt(0, 0, 0).unwrap(), Utc)
}

fn stable_pick_ids(ids: &[String], k: usize, seed: u64) -> Vec<String> {
    if k == 0 || ids.is_empty() {
        return Vec::new();
    }
    if ids.len() <= k {
        return ids.to_vec();
    }

    let mut scored: Vec<(u64, &String)> = ids
        .iter()
        .map(|id| {
            let mut hasher = DefaultHasher::new();
            seed.hash(&mut hasher);
            id.hash(&mut hasher);
            (hasher.finish(), id)
        })
        .collect();
    scored.sort_by(|a, b| a.0.cmp(&b.0));
    scored
        .into_iter()
        .take(k)
        .map(|(_, id)| id.clone())
        .collect()
}

fn stable_seed_from_day_key(day: chrono::NaiveDate, extra: u64) -> u64 {
    let origin = chrono::NaiveDate::from_ymd_opt(1, 1, 1).unwrap();
    let days = day.signed_duration_since(origin).num_days().max(0) as u64;
    (days << 1) ^ extra.wrapping_mul(1315423911)
}

#[allow(dead_code)]
fn stable_seed_from_window_key(window_start_ts: i64, extra: u64) -> u64 {
    (window_start_ts as u64) ^ extra.wrapping_mul(2654435761)
}

pub async fn get_home_sponsored_top(
    req: HttpRequest,
    query: web::Query<HomeModuleQuery>,
    db: web::Data<Arc<Database>>,
) -> impl Responder {
    let now = Utc::now();
    let next_refresh = start_of_next_day_utc(now);
    let day_key = now.date_naive();

    let key = "home_sponsored_top";
    let mut ids: Vec<String> = Vec::new();
    if let Ok(Some(state)) = db.get_home_module_state(key).await {
        if state.day_key == Some(day_key) && state.today_ids.len() == 2 {
            ids = state.today_ids;
        }
    }

    if ids.is_empty() {
        let params = QueryParams {
            category: None,
            tags: None,
            language: query.language.clone(),
            status: Some("approved".to_string()),
            search: None,
            sort: Some("popularity".to_string()),
            dir: Some("desc".to_string()),
            limit: Some(2),
            offset: None,
        };

        let products = match db.get_products(params).await {
            Ok(list) => list,
            Err(e) => {
                if is_db_unavailable_error(&e) {
                    let message = if get_language_from_request(&req).starts_with("zh") {
                        "数据库连接不可用，已降级返回空列表。"
                    } else {
                        "Database is unavailable. Returning empty list in degraded mode."
                    };
                    return HttpResponse::Ok().json(make_db_degraded_response(
                        "GET /api/home/sponsored-top",
                        HomeProductsPayload {
                            products: Vec::new(),
                            next_refresh_at: next_refresh.to_rfc3339(),
                        },
                        message.to_string(),
                        &e,
                    ));
                }
                return HttpResponse::InternalServerError()
                    .json(ApiResponse::<()>::error(format!("Database error: {:?}", e)));
            }
        };

        ids = products.iter().map(|p| p.id.clone()).collect();
        let _ = db
            .upsert_home_module_state(crate::db::HomeModuleState {
                key: key.to_string(),
                mode: Some("daily".to_string()),
                day_key: Some(day_key),
                remaining_ids: Vec::new(),
                today_ids: ids.clone(),
            })
            .await;

        return HttpResponse::Ok().json(ApiResponse::success(HomeProductsPayload {
            products,
            next_refresh_at: next_refresh.to_rfc3339(),
        }));
    }

    let products = match db.get_products_by_ids(&ids).await {
        Ok(list) => list,
        Err(e) => {
            return HttpResponse::InternalServerError()
                .json(ApiResponse::<()>::error(format!("Database error: {:?}", e)));
        }
    };

    HttpResponse::Ok().json(ApiResponse::success(HomeProductsPayload {
        products,
        next_refresh_at: next_refresh.to_rfc3339(),
    }))
}

pub async fn get_home_sponsored_right(
    req: HttpRequest,
    query: web::Query<HomeModuleQuery>,
    db: web::Data<Arc<Database>>,
) -> impl Responder {
    let now = Utc::now();
    let next_refresh = start_of_next_day_utc(now);
    let day_key = now.date_naive();
    let key = "home_sponsored_right";

    let mut mode = "first100".to_string();
    let mut remaining_ids: Vec<String> = Vec::new();
    let mut today_ids: Vec<String> = Vec::new();

    if let Ok(Some(state)) = db.get_home_module_state(key).await {
        if let Some(m) = state.mode {
            mode = m;
        }
        remaining_ids = state.remaining_ids;
        if state.day_key == Some(day_key) && state.today_ids.len() == 3 {
            today_ids = state.today_ids;
        }
    }

    if today_ids.is_empty() {
        if mode == "first100" && remaining_ids.is_empty() {
            let params = QueryParams {
                category: None,
                tags: None,
                language: query.language.clone(),
                status: Some("approved".to_string()),
                search: None,
                sort: Some("created_at".to_string()),
                dir: Some("asc".to_string()),
                limit: Some(100),
                offset: None,
            };
            remaining_ids = match db.get_products(params).await {
                Ok(list) => list.into_iter().map(|p| p.id).collect(),
                Err(_) => Vec::new(),
            };
            if remaining_ids.is_empty() {
                mode = "all".to_string();
            }
        }

        let seed = stable_seed_from_day_key(day_key, 0x9E3779B97F4A7C15);
        if mode == "first100" && !remaining_ids.is_empty() {
            let pick = stable_pick_ids(&remaining_ids, 3, seed);
            let pick_set: std::collections::HashSet<String> = pick.iter().cloned().collect();
            remaining_ids.retain(|id| !pick_set.contains(id));

            today_ids = pick;
            if today_ids.len() < 3 {
                mode = "all".to_string();
            }
        }

        if mode != "first100" || today_ids.len() < 3 {
            let params = QueryParams {
                category: None,
                tags: None,
                language: query.language.clone(),
                status: Some("approved".to_string()),
                search: None,
                sort: Some("created_at".to_string()),
                dir: Some("desc".to_string()),
                limit: Some(5000),
                offset: None,
            };
            let all_ids: Vec<String> = match db.get_products(params).await {
                Ok(list) => list.into_iter().map(|p| p.id).collect(),
                Err(e) => {
                    if is_db_unavailable_error(&e) {
                        let message = if get_language_from_request(&req).starts_with("zh") {
                            "数据库连接不可用，已降级返回空列表。"
                        } else {
                            "Database is unavailable. Returning empty list in degraded mode."
                        };
                        return HttpResponse::Ok().json(make_db_degraded_response(
                            "GET /api/home/sponsored-right",
                            HomeProductsPayload {
                                products: Vec::new(),
                                next_refresh_at: next_refresh.to_rfc3339(),
                            },
                            message.to_string(),
                            &e,
                        ));
                    }
                    return HttpResponse::InternalServerError()
                        .json(ApiResponse::<()>::error(format!("Database error: {:?}", e)));
                }
            };

            let existing: std::collections::HashSet<String> = today_ids.iter().cloned().collect();
            let candidates: Vec<String> = all_ids
                .into_iter()
                .filter(|id| !existing.contains(id))
                .collect();
            let needed = 3usize.saturating_sub(today_ids.len());
            let extra = stable_pick_ids(&candidates, needed, seed ^ 0xD1B54A32D192ED03);
            today_ids.extend(extra);
        }

        let _ = db
            .upsert_home_module_state(crate::db::HomeModuleState {
                key: key.to_string(),
                mode: Some(mode.clone()),
                day_key: Some(day_key),
                remaining_ids,
                today_ids: today_ids.clone(),
            })
            .await;
    }

    if today_ids.is_empty() {
        return HttpResponse::Ok().json(ApiResponse::success(HomeProductsPayload {
            products: Vec::new(),
            next_refresh_at: next_refresh.to_rfc3339(),
        }));
    }

    let products = match db.get_products_by_ids(&today_ids).await {
        Ok(list) => list,
        Err(e) => {
            return HttpResponse::InternalServerError()
                .json(ApiResponse::<()>::error(format!("Database error: {:?}", e)));
        }
    };

    HttpResponse::Ok().json(ApiResponse::success(HomeProductsPayload {
        products,
        next_refresh_at: next_refresh.to_rfc3339(),
    }))
}

pub async fn get_home_featured(
    req: HttpRequest,
    query: web::Query<HomeModuleQuery>,
    db: web::Data<Arc<Database>>,
) -> impl Responder {
    let now = Utc::now();
    let window_seconds: i64 = 2 * 60 * 60;
    let window_start_ts = (now.timestamp() / window_seconds) * window_seconds;
    let window_end_ts = window_start_ts + window_seconds;
    let next_refresh = chrono::DateTime::<Utc>::from_timestamp(window_end_ts, 0)
        .unwrap_or_else(|| now + chrono::Duration::seconds(window_seconds));

    let key = "home_featured";
    let window_key = window_start_ts.to_string();
    let mut ids: Vec<String> = Vec::new();
    if let Ok(Some(state)) = db.get_home_module_state(key).await {
        if state.mode.as_deref() == Some(window_key.as_str()) && state.today_ids.len() == 6 {
            ids = state.today_ids;
        }
    }

    if ids.is_empty() {
        let params = QueryParams {
            category: None,
            tags: None,
            language: query.language.clone(),
            status: Some("approved".to_string()),
            search: None,
            sort: Some("popularity".to_string()),
            dir: Some("desc".to_string()),
            limit: Some(6),
            offset: None,
        };

        let products = match db.get_products(params).await {
            Ok(list) => list,
            Err(e) => {
                if is_db_unavailable_error(&e) {
                    let message = if get_language_from_request(&req).starts_with("zh") {
                        "数据库连接不可用，已降级返回空列表。"
                    } else {
                        "Database is unavailable. Returning empty list in degraded mode."
                    };
                    return HttpResponse::Ok().json(make_db_degraded_response(
                        "GET /api/home/featured",
                        HomeProductsPayload {
                            products: Vec::new(),
                            next_refresh_at: next_refresh.to_rfc3339(),
                        },
                        message.to_string(),
                        &e,
                    ));
                }
                return HttpResponse::InternalServerError()
                    .json(ApiResponse::<()>::error(format!("Database error: {:?}", e)));
            }
        };

        ids = products.iter().map(|p| p.id.clone()).collect();
        let _ = db
            .upsert_home_module_state(crate::db::HomeModuleState {
                key: key.to_string(),
                mode: Some(window_key),
                day_key: None,
                remaining_ids: Vec::new(),
                today_ids: ids.clone(),
            })
            .await;

        return HttpResponse::Ok().json(ApiResponse::success(HomeProductsPayload {
            products,
            next_refresh_at: next_refresh.to_rfc3339(),
        }));
    }

    let products = match db.get_products_by_ids(&ids).await {
        Ok(list) => list,
        Err(e) => {
            return HttpResponse::InternalServerError()
                .json(ApiResponse::<()>::error(format!("Database error: {:?}", e)));
        }
    };

    HttpResponse::Ok().json(ApiResponse::success(HomeProductsPayload {
        products,
        next_refresh_at: next_refresh.to_rfc3339(),
    }))
}

#[derive(Debug, Serialize, ToSchema)]
pub struct DevSeedResult {
    pub categories_upserted: usize,
    pub products_created: usize,
    pub product_ids: Vec<String>,
}

/**
 * default_seed_categories
 * 提供一组默认分类，便于开发阶段快速写入数据库。
 */
fn default_seed_categories() -> Vec<crate::models::Category> {
    vec![
        crate::models::Category {
            id: "ai".to_string(),
            name_en: "AI Tools".to_string(),
            name_zh: "AI 工具".to_string(),
            icon: "🤖".to_string(),
            color: "from-purple-500 to-pink-500".to_string(),
        },
        crate::models::Category {
            id: "productivity".to_string(),
            name_en: "Productivity".to_string(),
            name_zh: "效率工具".to_string(),
            icon: "⚡".to_string(),
            color: "from-blue-500 to-cyan-500".to_string(),
        },
        crate::models::Category {
            id: "developer".to_string(),
            name_en: "Developer Tools".to_string(),
            name_zh: "开发者工具".to_string(),
            icon: "💻".to_string(),
            color: "from-green-500 to-emerald-500".to_string(),
        },
        crate::models::Category {
            id: "design".to_string(),
            name_en: "Design Tools".to_string(),
            name_zh: "设计工具".to_string(),
            icon: "🎨".to_string(),
            color: "from-pink-500 to-rose-500".to_string(),
        },
        crate::models::Category {
            id: "writing".to_string(),
            name_en: "Writing Tools".to_string(),
            name_zh: "写作工具".to_string(),
            icon: "✍️".to_string(),
            color: "from-orange-500 to-amber-500".to_string(),
        },
        crate::models::Category {
            id: "marketing".to_string(),
            name_en: "Marketing".to_string(),
            name_zh: "营销工具".to_string(),
            icon: "📈".to_string(),
            color: "from-indigo-500 to-purple-500".to_string(),
        },
        crate::models::Category {
            id: "education".to_string(),
            name_en: "Education".to_string(),
            name_zh: "教育工具".to_string(),
            icon: "📚".to_string(),
            color: "from-cyan-500 to-blue-500".to_string(),
        },
        crate::models::Category {
            id: "games".to_string(),
            name_en: "Games".to_string(),
            name_zh: "游戏".to_string(),
            icon: "🎮".to_string(),
            color: "from-red-500 to-orange-500".to_string(),
        },
        crate::models::Category {
            id: "finance".to_string(),
            name_en: "Finance".to_string(),
            name_zh: "金融工具".to_string(),
            icon: "💰".to_string(),
            color: "from-green-600 to-emerald-600".to_string(),
        },
        crate::models::Category {
            id: "lifestyle".to_string(),
            name_en: "Lifestyle".to_string(),
            name_zh: "生活方式".to_string(),
            icon: "🌟".to_string(),
            color: "from-yellow-500 to-orange-500".to_string(),
        },
    ]
}

/**
 * is_rls_policy_error
 * 判断错误是否为 RLS（Row Level Security）策略导致的拒绝写入。
 */
fn is_rls_policy_error(err: &anyhow::Error) -> bool {
    let msg = format!("{:?}", err).to_ascii_lowercase();
    msg.contains("row-level security")
        || msg.contains("row level security")
        || msg.contains("violates row level security policy")
        || msg.contains("42501")
}

/**
 * validate_dev_seed_token
 * 校验开发环境 seed token，避免开放写接口被滥用。
 */
fn validate_dev_seed_token(req: &HttpRequest) -> Result<(), HttpResponse> {
    let expected = env::var("DEV_SEED_TOKEN").ok();
    let expected = match expected {
        Some(v) if !v.trim().is_empty() => v,
        _ => {
            return Err(
                HttpResponse::InternalServerError().json(ApiResponse::<()>::error(
                    "DEV_SEED_TOKEN 未配置，拒绝执行 seed".to_string(),
                )),
            )
        }
    };

    let provided = req
        .headers()
        .get("x-seed-token")
        .and_then(|h| h.to_str().ok())
        .unwrap_or("");

    if provided != expected {
        return Err(
            HttpResponse::Forbidden().json(ApiResponse::<()>::error("seed token 无效".to_string()))
        );
    }

    Ok(())
}

#[derive(Debug, Serialize, ToSchema)]
pub struct DevBootstrapResult {
    pub bootstrapped: bool,
}

pub async fn dev_bootstrap(req: HttpRequest, db: web::Data<Arc<Database>>) -> impl Responder {
    if let Err(resp) = validate_dev_seed_token(&req) {
        return resp;
    }

    match db.bootstrap_schema().await {
        Ok(()) => HttpResponse::Ok().json(ApiResponse::success(DevBootstrapResult {
            bootstrapped: true,
        })),
        Err(e) => HttpResponse::InternalServerError()
            .json(ApiResponse::<()>::error(format!("Database error: {:?}", e))),
    }
}

/**
 * dev_seed
 * 写入一批开发用的 categories 与 products，便于新项目快速看到页面效果。
 */
pub async fn dev_seed(req: HttpRequest, db: web::Data<Arc<Database>>) -> impl Responder {
    if let Err(resp) = validate_dev_seed_token(&req) {
        return resp;
    }

    let categories = default_seed_categories();

    let categories_upserted = match db.upsert_categories(categories).await {
        Ok(n) => n,
        Err(e) => {
            if is_rls_policy_error(&e) {
                0
            } else {
                return HttpResponse::InternalServerError()
                    .json(ApiResponse::<()>::error(format!("Database error: {:?}", e)));
            }
        }
    };

    let sample_products = vec![
        CreateProductRequest {
            name: "PromptDock".to_string(),
            slogan: "Manage prompts & snippets fast".to_string(),
            description: "A lightweight prompt/snippet manager for solo developers.".to_string(),
            website: "https://example.com/promptdock".to_string(),
            logo_url: None,
            category: "ai".to_string(),
            tags: vec![
                "ai".to_string(),
                "productivity".to_string(),
                "sponsored".to_string(),
            ],
            maker_name: "Alex".to_string(),
            maker_email: "alex@example.com".to_string(),
            maker_website: Some("https://example.com/alex".to_string()),
            language: "en".to_string(),
        },
        CreateProductRequest {
            name: "SoloInvoice".to_string(),
            slogan: "Invoices for indie makers".to_string(),
            description: "Generate invoices and track payments in minutes.".to_string(),
            website: "https://example.com/soloinvoice".to_string(),
            logo_url: None,
            category: "finance".to_string(),
            tags: vec![
                "finance".to_string(),
                "saas".to_string(),
                "sponsored".to_string(),
            ],
            maker_name: "Li".to_string(),
            maker_email: "li@example.com".to_string(),
            maker_website: Some("https://example.com/li".to_string()),
            language: "en".to_string(),
        },
        CreateProductRequest {
            name: "写作加速器".to_string(),
            slogan: "让内容产出更快".to_string(),
            description: "面向独立创作者的写作与发布工作流工具。".to_string(),
            website: "https://example.com/writing-booster".to_string(),
            logo_url: None,
            category: "writing".to_string(),
            tags: vec!["writing".to_string(), "productivity".to_string()],
            maker_name: "小王".to_string(),
            maker_email: "xiaowang@example.com".to_string(),
            maker_website: Some("https://example.com/xiaowang".to_string()),
            language: "zh".to_string(),
        },
        CreateProductRequest {
            name: "DevPalette".to_string(),
            slogan: "Design tokens for developers".to_string(),
            description: "Create and export design tokens for your UI in seconds.".to_string(),
            website: "https://example.com/devpalette".to_string(),
            logo_url: None,
            category: "design".to_string(),
            tags: vec!["design".to_string(), "developer".to_string()],
            maker_name: "Mina".to_string(),
            maker_email: "mina@example.com".to_string(),
            maker_website: Some("https://example.com/mina".to_string()),
            language: "en".to_string(),
        },
        CreateProductRequest {
            name: "LaunchKit".to_string(),
            slogan: "Landing page + waitlist template".to_string(),
            description: "A starter kit for launching fast with SEO-ready pages.".to_string(),
            website: "https://example.com/launchkit".to_string(),
            logo_url: None,
            category: "marketing".to_string(),
            tags: vec!["marketing".to_string(), "developer".to_string()],
            maker_name: "Chen".to_string(),
            maker_email: "chen@example.com".to_string(),
            maker_website: Some("https://example.com/chen".to_string()),
            language: "en".to_string(),
        },
        CreateProductRequest {
            name: "FocusFlow".to_string(),
            slogan: "Pomodoro meets deep work".to_string(),
            description: "A minimal focus timer with sessions, stats, and shortcuts.".to_string(),
            website: "https://example.com/focusflow".to_string(),
            logo_url: None,
            category: "productivity".to_string(),
            tags: vec!["productivity".to_string(), "desktop".to_string()],
            maker_name: "Nora".to_string(),
            maker_email: "nora@example.com".to_string(),
            maker_website: Some("https://example.com/nora".to_string()),
            language: "en".to_string(),
        },
        CreateProductRequest {
            name: "API 体检".to_string(),
            slogan: "自动化检查接口健康".to_string(),
            description: "面向团队的 API 健康度监控与告警工具。".to_string(),
            website: "https://example.com/api-health".to_string(),
            logo_url: None,
            category: "developer".to_string(),
            tags: vec!["developer".to_string(), "monitoring".to_string()],
            maker_name: "阿杰".to_string(),
            maker_email: "ajie@example.com".to_string(),
            maker_website: Some("https://example.com/ajie".to_string()),
            language: "zh".to_string(),
        },
        CreateProductRequest {
            name: "StoryBoard".to_string(),
            slogan: "Write, publish, grow".to_string(),
            description: "A writing tool with publishing pipelines and analytics.".to_string(),
            website: "https://example.com/storyboard".to_string(),
            logo_url: None,
            category: "writing".to_string(),
            tags: vec!["writing".to_string(), "marketing".to_string()],
            maker_name: "Ivy".to_string(),
            maker_email: "ivy@example.com".to_string(),
            maker_website: Some("https://example.com/ivy".to_string()),
            language: "en".to_string(),
        },
        CreateProductRequest {
            name: "PixelPack".to_string(),
            slogan: "Icons & UI kits for builders".to_string(),
            description: "Curated icons, components, and templates to ship faster.".to_string(),
            website: "https://example.com/pixelpack".to_string(),
            logo_url: None,
            category: "design".to_string(),
            tags: vec!["design".to_string(), "assets".to_string()],
            maker_name: "Ryo".to_string(),
            maker_email: "ryo@example.com".to_string(),
            maker_website: Some("https://example.com/ryo".to_string()),
            language: "en".to_string(),
        },
        CreateProductRequest {
            name: "BudgetBee".to_string(),
            slogan: "Personal finance for creators".to_string(),
            description: "Track income, expenses, and subscriptions in one place.".to_string(),
            website: "https://example.com/budgetbee".to_string(),
            logo_url: None,
            category: "finance".to_string(),
            tags: vec!["finance".to_string(), "lifestyle".to_string()],
            maker_name: "Sana".to_string(),
            maker_email: "sana@example.com".to_string(),
            maker_website: Some("https://example.com/sana".to_string()),
            language: "en".to_string(),
        },
        CreateProductRequest {
            name: "GameLoop".to_string(),
            slogan: "Indie game dev toolkit".to_string(),
            description: "A toolbox with templates, assets, and build scripts.".to_string(),
            website: "https://example.com/gameloop".to_string(),
            logo_url: None,
            category: "games".to_string(),
            tags: vec!["games".to_string(), "developer".to_string()],
            maker_name: "Kai".to_string(),
            maker_email: "kai@example.com".to_string(),
            maker_website: Some("https://example.com/kai".to_string()),
            language: "en".to_string(),
        },
    ];

    let mut product_ids = Vec::new();
    for p in sample_products {
        match db.create_product(p).await {
            Ok(created) => {
                let id = created.id;
                product_ids.push(id.clone());
                let updates = UpdateProductRequest {
                    name: None,
                    slogan: None,
                    description: None,
                    website: None,
                    logo_url: None,
                    category: None,
                    tags: None,
                    status: Some(crate::models::ProductStatus::Approved),
                };

                match db.update_product(&id, updates).await {
                    Ok(_) => {}
                    Err(e) => {
                        if !is_rls_policy_error(&e) {
                            return HttpResponse::InternalServerError().json(
                                ApiResponse::<()>::error(format!("Database error: {:?}", e)),
                            );
                        }
                    }
                }
            }
            Err(e) => {
                return HttpResponse::InternalServerError()
                    .json(ApiResponse::<()>::error(format!("Database error: {:?}", e)))
            }
        }
    }

    if let Err(e) = db.seed_engagement(&product_ids).await {
        return HttpResponse::InternalServerError()
            .json(ApiResponse::<()>::error(format!("Database error: {:?}", e)));
    }

    HttpResponse::Ok().json(ApiResponse::success(DevSeedResult {
        categories_upserted,
        products_created: product_ids.len(),
        product_ids,
    }))
}
