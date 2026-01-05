use crate::db::Database;
use crate::models::{
    ApiResponse, CreateProductRequest, Developer, Product, QueryParams, UpdateProductRequest,
};
use actix_web::{get, web, HttpRequest, HttpResponse, Responder};
use chrono::{Duration, Utc};
use serde::{Deserialize, Serialize};
use std::env;
use std::sync::Arc;
use std::time::Duration as StdDuration;

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

#[get("/health")]
pub async fn health_check() -> impl Responder {
    HttpResponse::Ok().json(serde_json::json!({
        "status": "ok",
        "timestamp": Utc::now().to_rfc3339()
    }))
}

pub async fn get_products(
    query: web::Query<QueryParams>,
    db: web::Data<Arc<Database>>,
) -> impl Responder {
    let result = tokio::time::timeout(
        StdDuration::from_secs(4),
        db.get_products(query.into_inner()),
    )
    .await;

    match result {
        Ok(Ok(products)) => HttpResponse::Ok().json(ApiResponse::success(products)),
        Ok(Err(e)) => {
            if is_db_unavailable_error(&e) {
                return HttpResponse::Ok().json(ApiResponse {
                    success: true,
                    data: Some(Vec::<crate::models::Product>::new()),
                    message: Some("数据库连接不可用，已降级返回空列表。".to_string()),
                });
            }

            HttpResponse::InternalServerError()
                .json(ApiResponse::<()>::error(format!("Database error: {:?}", e)))
        }
        Err(_) => HttpResponse::Ok().json(ApiResponse {
            success: true,
            data: Some(Vec::<crate::models::Product>::new()),
            message: Some("数据库请求超时，已降级返回空列表。".to_string()),
        }),
    }
}

#[derive(Debug, Deserialize)]
pub struct SearchQuery {
    pub q: Option<String>,
    pub limit: Option<usize>,
    pub language: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct SearchResult {
    pub products: Vec<Product>,
    pub developers: Vec<Developer>,
}

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

    let limit = query.limit.unwrap_or(8).clamp(1, 20) as i64;
    let params = QueryParams {
        category: None,
        tags: None,
        language: query.language.clone(),
        status: Some("approved".to_string()),
        search: Some(q.to_string()),
        limit: Some(limit),
        offset: None,
    };

    let result = tokio::time::timeout(StdDuration::from_secs(4), async {
        let products = db.get_products(params).await?;
        let developers = db.search_developers(q, limit).await?;
        Ok::<_, anyhow::Error>((products, developers))
    })
    .await;

    match result {
        Ok(Ok((products, developers))) => {
            HttpResponse::Ok().json(ApiResponse::success(SearchResult {
                products,
                developers,
            }))
        }
        Ok(Err(e)) => {
            if is_db_unavailable_error(&e) {
                let lang = get_language_from_request(&req);
                let message = if lang.starts_with("zh") {
                    "数据库连接不可用，已降级返回空搜索结果。"
                } else {
                    "Database is unavailable. Search results are empty in degraded mode."
                };

                return HttpResponse::Ok().json(ApiResponse {
                    success: true,
                    data: Some(SearchResult {
                        products: Vec::new(),
                        developers: Vec::new(),
                    }),
                    message: Some(message.to_string()),
                });
            }

            HttpResponse::InternalServerError()
                .json(ApiResponse::<()>::error(format!("Database error: {:?}", e)))
        }
        Err(_) => {
            let lang = get_language_from_request(&req);
            let message = if lang.starts_with("zh") {
                "数据库请求超时，已降级返回空搜索结果。"
            } else {
                "Database request timed out. Search results are empty in degraded mode."
            };

            HttpResponse::Ok().json(ApiResponse {
                success: true,
                data: Some(SearchResult {
                    products: Vec::new(),
                    developers: Vec::new(),
                }),
                message: Some(message.to_string()),
            })
        }
    }
}

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
            data: Some(serde_json::json!({"id": id})),
            message: Some("Product deleted successfully".to_string()),
        }),
        Ok(false) => {
            HttpResponse::NotFound().json(ApiResponse::<()>::error("Product not found".to_string()))
        }
        Err(e) => HttpResponse::InternalServerError()
            .json(ApiResponse::<()>::error(format!("Database error: {:?}", e))),
    }
}

pub async fn get_categories(db: web::Data<Arc<Database>>) -> impl Responder {
    let result = tokio::time::timeout(StdDuration::from_secs(4), db.get_categories()).await;

    match result {
        Ok(Ok(categories)) => HttpResponse::Ok().json(ApiResponse::success(categories)),
        Ok(Err(e)) => {
            if is_db_unavailable_error(&e) {
                return HttpResponse::Ok().json(ApiResponse {
                    success: true,
                    data: Some(Vec::<crate::models::Category>::new()),
                    message: Some("数据库连接不可用，已降级返回空列表。".to_string()),
                });
            }

            HttpResponse::InternalServerError()
                .json(ApiResponse::<()>::error(format!("Database error: {:?}", e)))
        }
        Err(_) => HttpResponse::Ok().json(ApiResponse {
            success: true,
            data: Some(Vec::<crate::models::Category>::new()),
            message: Some("数据库请求超时，已降级返回空列表。".to_string()),
        }),
    }
}

#[derive(Debug, Deserialize)]
pub struct TopCategoriesQuery {
    pub limit: Option<usize>,
}

pub async fn get_top_categories(
    query: web::Query<TopCategoriesQuery>,
    db: web::Data<Arc<Database>>,
) -> impl Responder {
    let limit = query.limit.unwrap_or(10).clamp(1, 50) as i64;
    let result = tokio::time::timeout(
        StdDuration::from_secs(4),
        db.get_top_categories_by_product_count(limit),
    )
    .await;

    match result {
        Ok(Ok(list)) => HttpResponse::Ok().json(ApiResponse::success(list)),
        Ok(Err(e)) => {
            if is_db_unavailable_error(&e) {
                return HttpResponse::Ok().json(ApiResponse {
                    success: true,
                    data: Some(Vec::<crate::models::CategoryWithCount>::new()),
                    message: Some("数据库连接不可用，已降级返回空列表。".to_string()),
                });
            }

            HttpResponse::InternalServerError()
                .json(ApiResponse::<()>::error(format!("Database error: {:?}", e)))
        }
        Err(_) => HttpResponse::Ok().json(ApiResponse {
            success: true,
            data: Some(Vec::<crate::models::CategoryWithCount>::new()),
            message: Some("数据库请求超时，已降级返回空列表。".to_string()),
        }),
    }
}

#[derive(Debug, Deserialize)]
pub struct TopDevelopersQuery {
    pub limit: Option<usize>,
}

pub async fn get_top_developers(
    query: web::Query<TopDevelopersQuery>,
    db: web::Data<Arc<Database>>,
) -> impl Responder {
    let limit = query.limit.unwrap_or(4).clamp(1, 20) as i64;
    let result = tokio::time::timeout(
        StdDuration::from_secs(4),
        db.get_top_developers_by_followers(limit),
    )
    .await;

    match result {
        Ok(Ok(list)) => HttpResponse::Ok().json(ApiResponse::success(list)),
        Ok(Err(e)) => {
            if is_db_unavailable_error(&e) {
                return HttpResponse::Ok().json(ApiResponse {
                    success: true,
                    data: Some(Vec::<crate::models::DeveloperWithFollowers>::new()),
                    message: Some("数据库连接不可用，已降级返回空列表。".to_string()),
                });
            }
            HttpResponse::InternalServerError()
                .json(ApiResponse::<()>::error(format!("Database error: {:?}", e)))
        }
        Err(_) => HttpResponse::Ok().json(ApiResponse {
            success: true,
            data: Some(Vec::<crate::models::DeveloperWithFollowers>::new()),
            message: Some("数据库请求超时，已降级返回空列表。".to_string()),
        }),
    }
}

pub async fn get_recent_developers(
    query: web::Query<TopDevelopersQuery>,
    db: web::Data<Arc<Database>>,
) -> impl Responder {
    let limit = query.limit.unwrap_or(4).clamp(1, 20) as i64;
    let result = tokio::time::timeout(
        StdDuration::from_secs(4),
        db.get_recent_developers_by_created_at(limit),
    )
    .await;

    match result {
        Ok(Ok(list)) => HttpResponse::Ok().json(ApiResponse::success(list)),
        Ok(Err(e)) => {
            if is_db_unavailable_error(&e) {
                return HttpResponse::Ok().json(ApiResponse {
                    success: true,
                    data: Some(Vec::<crate::models::DeveloperWithFollowers>::new()),
                    message: Some("数据库连接不可用，已降级返回空列表。".to_string()),
                });
            }
            HttpResponse::InternalServerError()
                .json(ApiResponse::<()>::error(format!("Database error: {:?}", e)))
        }
        Err(_) => HttpResponse::Ok().json(ApiResponse {
            success: true,
            data: Some(Vec::<crate::models::DeveloperWithFollowers>::new()),
            message: Some("数据库请求超时，已降级返回空列表。".to_string()),
        }),
    }
}

#[derive(Debug, Deserialize)]
pub struct DeveloperPopularityQuery {
    pub limit: Option<usize>,
}

pub async fn get_developer_popularity_last_month(
    query: web::Query<DeveloperPopularityQuery>,
    db: web::Data<Arc<Database>>,
) -> impl Responder {
    let limit = query.limit.unwrap_or(10).clamp(1, 50) as i64;
    let result = tokio::time::timeout(
        StdDuration::from_secs(4),
        db.get_developer_popularity_last_month(limit),
    )
    .await;

    match result {
        Ok(Ok(list)) => HttpResponse::Ok().json(ApiResponse::success(list)),
        Ok(Err(e)) => {
            if is_db_unavailable_error(&e) {
                return HttpResponse::Ok().json(ApiResponse {
                    success: true,
                    data: Some(Vec::<crate::models::DeveloperPopularity>::new()),
                    message: Some("数据库连接不可用，已降级返回空列表。".to_string()),
                });
            }
            HttpResponse::InternalServerError()
                .json(ApiResponse::<()>::error(format!("Database error: {:?}", e)))
        }
        Err(_) => HttpResponse::Ok().json(ApiResponse {
            success: true,
            data: Some(Vec::<crate::models::DeveloperPopularity>::new()),
            message: Some("数据库请求超时，已降级返回空列表。".to_string()),
        }),
    }
}

#[derive(Debug, Deserialize)]
pub struct InteractionBody {
    pub user_id: Option<String>,
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

    match db.follow_developer(&email, &user_id).await {
        Ok(()) => HttpResponse::Ok().json(ApiResponse::success(serde_json::json!({ "ok": true }))),
        Err(e) => {
            if is_db_unavailable_error(&e) {
                return HttpResponse::Ok().json(ApiResponse {
                    success: true,
                    data: Some(serde_json::json!({ "ok": false })),
                    message: Some("数据库连接不可用，已降级忽略写入。".to_string()),
                });
            }
            HttpResponse::InternalServerError()
                .json(ApiResponse::<()>::error(format!("Database error: {:?}", e)))
        }
    }
}

#[derive(Debug, Deserialize)]
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

#[derive(Debug, Deserialize)]
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

    match db.unfollow_developer(&email, &user_id).await {
        Ok(()) => HttpResponse::Ok().json(ApiResponse::success(serde_json::json!({ "ok": true }))),
        Err(e) => {
            if is_db_unavailable_error(&e) {
                return HttpResponse::Ok().json(ApiResponse {
                    success: true,
                    data: Some(serde_json::json!({ "ok": false })),
                    message: Some("数据库连接不可用，已降级忽略写入。".to_string()),
                });
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

    match db.like_product(&product_id, &user_id).await {
        Ok(()) => HttpResponse::Ok().json(ApiResponse::success(serde_json::json!({ "ok": true }))),
        Err(e) => {
            if is_db_unavailable_error(&e) {
                return HttpResponse::Ok().json(ApiResponse {
                    success: true,
                    data: Some(serde_json::json!({ "ok": false })),
                    message: Some("数据库连接不可用，已降级忽略写入。".to_string()),
                });
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

    match db.unlike_product(&product_id, &user_id).await {
        Ok(()) => HttpResponse::Ok().json(ApiResponse::success(serde_json::json!({ "ok": true }))),
        Err(e) => {
            if is_db_unavailable_error(&e) {
                return HttpResponse::Ok().json(ApiResponse {
                    success: true,
                    data: Some(serde_json::json!({ "ok": false })),
                    message: Some("数据库连接不可用，已降级忽略写入。".to_string()),
                });
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

    match db.favorite_product(&product_id, &user_id).await {
        Ok(()) => HttpResponse::Ok().json(ApiResponse::success(serde_json::json!({ "ok": true }))),
        Err(e) => {
            if is_db_unavailable_error(&e) {
                return HttpResponse::Ok().json(ApiResponse {
                    success: true,
                    data: Some(serde_json::json!({ "ok": false })),
                    message: Some("数据库连接不可用，已降级忽略写入。".to_string()),
                });
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

    match db.unfavorite_product(&product_id, &user_id).await {
        Ok(()) => HttpResponse::Ok().json(ApiResponse::success(serde_json::json!({ "ok": true }))),
        Err(e) => {
            if is_db_unavailable_error(&e) {
                return HttpResponse::Ok().json(ApiResponse {
                    success: true,
                    data: Some(serde_json::json!({ "ok": false })),
                    message: Some("数据库连接不可用，已降级忽略写入。".to_string()),
                });
            }
            HttpResponse::InternalServerError()
                .json(ApiResponse::<()>::error(format!("Database error: {:?}", e)))
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct FavoriteProductsQuery {
    pub user_id: String,
    pub limit: Option<usize>,
    pub language: Option<String>,
}

pub async fn get_favorite_products(
    req: HttpRequest,
    query: web::Query<FavoriteProductsQuery>,
    db: web::Data<Arc<Database>>,
) -> impl Responder {
    let limit = query.limit.unwrap_or(50).clamp(1, 200) as i64;
    let user_id = query.user_id.trim().to_string();
    let language = query.language.clone();

    if user_id.is_empty() {
        return HttpResponse::BadRequest()
            .json(ApiResponse::<()>::error("Missing user_id".to_string()));
    }

    let result = tokio::time::timeout(
        StdDuration::from_secs(4),
        db.get_favorite_products(&user_id, language.as_deref(), limit),
    )
    .await;

    match result {
        Ok(Ok(list)) => HttpResponse::Ok().json(ApiResponse::success(list)),
        Ok(Err(e)) => {
            if is_db_unavailable_error(&e) {
                let lang = get_language_from_request(&req);
                let message = if lang.starts_with("zh") {
                    "数据库连接不可用，已降级返回空列表。"
                } else {
                    "Database is unavailable. Returning empty list in degraded mode."
                };

                return HttpResponse::Ok().json(ApiResponse {
                    success: true,
                    data: Some(Vec::<crate::models::Product>::new()),
                    message: Some(message.to_string()),
                });
            }

            HttpResponse::InternalServerError()
                .json(ApiResponse::<()>::error(format!("Database error: {:?}", e)))
        }
        Err(_) => HttpResponse::Ok().json(ApiResponse {
            success: true,
            data: Some(Vec::<crate::models::Product>::new()),
            message: Some("数据库请求超时，已降级返回空列表。".to_string()),
        }),
    }
}

#[derive(Debug, Deserialize)]
pub struct LeaderboardQuery {
    pub window: Option<String>,
    pub limit: Option<usize>,
    pub language: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct MakerRank {
    pub maker_name: String,
    pub product_count: usize,
}

#[derive(Debug, Serialize)]
pub struct LeaderboardData<T> {
    pub top_products: Vec<T>,
    pub top_makers: Vec<MakerRank>,
}

pub async fn get_leaderboard(
    req: HttpRequest,
    query: web::Query<LeaderboardQuery>,
    db: web::Data<Arc<Database>>,
) -> impl Responder {
    let limit = query.limit.unwrap_or(20).clamp(1, 100);

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
        limit: Some((limit as i64) * 5),
        offset: None,
    };

    let products_result =
        tokio::time::timeout(StdDuration::from_secs(4), db.get_products(params)).await;

    let products = match products_result {
        Ok(Ok(products)) => products,
        Ok(Err(e)) => {
            if is_db_unavailable_error(&e) {
                let lang = get_language_from_request(&req);
                let message = if lang.starts_with("zh") {
                    "数据库连接不可用，排行榜已降级为暂无数据。"
                } else {
                    "Database is unavailable. Leaderboard is empty in degraded mode."
                };

                return HttpResponse::Ok().json(ApiResponse {
                    success: true,
                    data: Some(LeaderboardData::<crate::models::Product> {
                        top_products: Vec::new(),
                        top_makers: Vec::new(),
                    }),
                    message: Some(message.to_string()),
                });
            }

            return HttpResponse::InternalServerError()
                .json(ApiResponse::<()>::error(format!("Database error: {:?}", e)));
        }
        Err(_) => {
            let lang = get_language_from_request(&req);
            let message = if lang.starts_with("zh") {
                "数据库请求超时，排行榜已降级为暂无数据。"
            } else {
                "Database request timed out. Leaderboard is empty in degraded mode."
            };

            return HttpResponse::Ok().json(ApiResponse {
                success: true,
                data: Some(LeaderboardData::<crate::models::Product> {
                    top_products: Vec::new(),
                    top_makers: Vec::new(),
                }),
                message: Some(message.to_string()),
            });
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

#[derive(Debug, Serialize)]
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

#[derive(Debug, Serialize)]
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
