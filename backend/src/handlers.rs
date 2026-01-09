use crate::db::Database;
use crate::models::{
    ApiError, ApiResponse, Category, CreateProductRequest, CreateSponsorshipGrantFromRequest,
    CreateSponsorshipRequest, DeveloperCenterStats, EmptyApiResponse, NewsletterSubscribeRequest,
    Product, ProductApiResponse, ProductsApiResponse, QueryParams, SearchApiResponse, SearchResult,
    SponsorshipRequest, UpsertPricingPlanRequest,
    UpdateProductRequest,
};
use actix_web::{get, web, HttpRequest, HttpResponse, Responder};
use base64::{engine::general_purpose, Engine as _};
use chrono::{Duration, Utc};
use hmac::{Hmac, Mac};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use std::collections::hash_map::DefaultHasher;
use std::env;
use std::hash::{Hash, Hasher};
use std::sync::Arc;
use std::time::Duration as StdDuration;
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

#[derive(Debug, Deserialize, ToSchema)]
pub struct CreateSponsorshipRequestBody {
    pub email: String,
    pub product_ref: String,
    pub placement: String,
    pub slot_index: Option<i32>,
    pub duration_days: i32,
    pub note: Option<String>,
}

pub async fn create_sponsorship_request(
    req: HttpRequest,
    body: web::Json<CreateSponsorshipRequestBody>,
    db: web::Data<Arc<Database>>,
) -> impl Responder {
    let lang = get_language_from_request(&req);
    let body = body.into_inner();

    let email = body.email.trim().to_string();
    let product_ref = body.product_ref.trim().to_string();
    let placement = body.placement.trim().to_string();
    let duration_days = body.duration_days;

    if email.is_empty() || product_ref.is_empty() || placement.is_empty() || duration_days <= 0 {
        return HttpResponse::BadRequest().json(ApiResponse::<()>::error(
            if lang.starts_with("zh") {
                "缺少必填字段（邮箱 / 产品 / 展示位置 / 展示时长）".to_string()
            } else {
                "Missing required fields (email / product / placement / duration)".to_string()
            },
        ));
    }

    if placement != "home_top" && placement != "home_right" {
        return HttpResponse::BadRequest()
            .json(ApiResponse::<()>::error("Invalid placement".to_string()));
    }

    if placement == "home_top" {
        match body.slot_index {
            Some(0 | 1) => {}
            _ => {
                return HttpResponse::BadRequest().json(ApiResponse::<()>::error(
                    if lang.starts_with("zh") {
                        "顶部赞助位必须指定 slot_index=0(左) 或 1(右)".to_string()
                    } else {
                        "home_top requires slot_index 0 (left) or 1 (right)".to_string()
                    },
                ))
            }
        }
    }

    if placement == "home_right" {
        match body.slot_index {
            Some(0..=2) => {}
            _ => {
                return HttpResponse::BadRequest().json(ApiResponse::<()>::error(
                    if lang.starts_with("zh") {
                        "右侧赞助位必须指定 slot_index=0/1/2（对应 1/2/3 槽位）".to_string()
                    } else {
                        "home_right requires slot_index 0/1/2".to_string()
                    },
                ))
            }
        }
    }

    let req_model = CreateSponsorshipRequest {
        email,
        product_ref,
        placement,
        slot_index: body.slot_index,
        duration_days: duration_days.clamp(1, 365),
        note: body
            .note
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty()),
    };

    match db.create_sponsorship_request(req_model).await {
        Ok(created) => HttpResponse::Ok().json(ApiResponse::success(created)),
        Err(e) => {
            if is_db_unavailable_error(&e) {
                return HttpResponse::Ok().json(make_db_degraded_response(
                    "POST /api/sponsorship/requests",
                    SponsorshipRequest {
                        id: 0,
                        email: "".to_string(),
                        product_ref: "".to_string(),
                        placement: "".to_string(),
                        slot_index: None,
                        duration_days: 0,
                        note: None,
                        status: "pending".to_string(),
                        processed_grant_id: None,
                        created_at: Utc::now(),
                        updated_at: Utc::now(),
                    },
                    if lang.starts_with("zh") {
                        "数据库连接不可用，已降级为接受请求但不写入。".to_string()
                    } else {
                        "Database is unavailable. Degraded mode: request accepted but not stored."
                            .to_string()
                    },
                    &e,
                ));
            }
            HttpResponse::InternalServerError()
                .json(ApiResponse::<()>::error(format!("Database error: {:?}", e)))
        }
    }
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct CreateSponsorshipCheckoutBody {
    pub product_ref: String,
    pub placement: String,
    pub slot_index: Option<i32>,
    pub months: i32,
    pub note: Option<String>,
    pub plan_id: Option<String>,
    pub plan_key: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct CreateSponsorshipCheckoutPayload {
    pub order_id: String,
    pub checkout_url: String,
}

fn creem_base_url() -> String {
    if let Ok(v) = env::var("CREEM_API_BASE_URL") {
        let trimmed = v.trim();
        if !trimmed.is_empty() {
            return trimmed.trim_end_matches('/').to_string();
        }
    }
    let test_mode = matches!(
        env::var("CREEM_TEST_MODE").ok().as_deref(),
        Some("1" | "true" | "TRUE")
    );
    if test_mode {
        "https://test-api.creem.io".to_string()
    } else {
        "https://api.creem.io".to_string()
    }
}

fn frontend_base_url() -> String {
    env::var("FRONTEND_BASE_URL")
        .ok()
        .filter(|v| !v.trim().is_empty())
        .unwrap_or_else(|| "http://localhost:3000".to_string())
        .trim_end_matches('/')
        .to_string()
}

fn locale_from_accept_language(lang: &str) -> &'static str {
    if lang.to_ascii_lowercase().starts_with("zh") {
        "zh"
    } else {
        "en"
    }
}

#[derive(Debug, Serialize)]
struct CreemCreateCheckoutRequest<'a> {
    product_id: &'a str,
    request_id: &'a str,
    units: i32,
    success_url: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    customer: Option<CreemCustomer<'a>>,
    metadata: serde_json::Value,
}

#[derive(Debug, Serialize)]
struct CreemCustomer<'a> {
    email: &'a str,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct CreemCreateCheckoutResponse {
    id: Option<String>,
    checkout_url: Option<String>,
    status: Option<String>,
}

pub async fn create_creem_sponsorship_checkout(
    req: HttpRequest,
    body: web::Json<CreateSponsorshipCheckoutBody>,
    db: web::Data<Arc<Database>>,
) -> impl Responder {
    let lang = get_language_from_request(&req);
    let body = body.into_inner();

    let token = match extract_bearer_token(&req) {
        Some(v) => v,
        None => {
            return HttpResponse::Unauthorized().json(ApiResponse::<()>::error(
                "Missing Authorization bearer token".to_string(),
            ))
        }
    };
    let (user_email, user_id) = match resolve_supabase_user_from_bearer(&token).await {
        Some(v) => v,
        None => {
            return HttpResponse::Unauthorized()
                .json(ApiResponse::<()>::error("Invalid session".to_string()))
        }
    };

    let placement = body.placement.trim().to_string();
    if placement != "home_top" && placement != "home_right" {
        return HttpResponse::BadRequest()
            .json(ApiResponse::<()>::error("Invalid placement".to_string()));
    }
    if placement == "home_top" {
        match body.slot_index {
            Some(0 | 1) => {}
            _ => {
                return HttpResponse::BadRequest().json(ApiResponse::<()>::error(
                    if lang.starts_with("zh") {
                        "顶部定价位必须指定 slot_index=0(左) 或 1(右)".to_string()
                    } else {
                        "home_top requires slot_index 0 (left) or 1 (right)".to_string()
                    },
                ))
            }
        }
    }
    if placement == "home_right" {
        match body.slot_index {
            Some(0..=2) => {}
            _ => {
                return HttpResponse::BadRequest().json(ApiResponse::<()>::error(
                    if lang.starts_with("zh") {
                        "右侧定价位必须指定 slot_index=0/1/2（对应 1/2/3 槽位）".to_string()
                    } else {
                        "home_right requires slot_index 0/1/2".to_string()
                    },
                ))
            }
        }
    }

    let product_ref = body.product_ref.trim();
    if product_ref.is_empty() {
        return HttpResponse::BadRequest()
            .json(ApiResponse::<()>::error("Missing product_ref".to_string()));
    }

    let product_id = match db.resolve_product_id_by_ref(product_ref).await {
        Ok(Some(id)) => id,
        Ok(None) => {
            return HttpResponse::BadRequest().json(ApiResponse::<()>::error(
                if lang.starts_with("zh") {
                    "无法匹配到产品，请填写产品链接 / 产品名称 / 产品 ID".to_string()
                } else {
                    "Cannot resolve product. Please provide product URL/name/id.".to_string()
                },
            ))
        }
        Err(e) => {
            if is_db_unavailable_error(&e) {
                return HttpResponse::Ok().json(make_db_degraded_response(
                    "POST /api/sponsorship/checkout",
                    CreateSponsorshipCheckoutPayload {
                        order_id: String::new(),
                        checkout_url: String::new(),
                    },
                    if lang.starts_with("zh") {
                        "数据库连接不可用，暂无法创建支付。".to_string()
                    } else {
                        "Database is unavailable. Cannot create checkout in degraded mode."
                            .to_string()
                    },
                    &e,
                ));
            }
            return HttpResponse::InternalServerError()
                .json(ApiResponse::<()>::error(format!("Database error: {:?}", e)));
        }
    };

    let product = match db.get_product_by_id(&product_id).await {
        Ok(Some(v)) => v,
        Ok(None) => {
            return HttpResponse::BadRequest()
                .json(ApiResponse::<()>::error("Product not found".to_string()))
        }
        Err(e) => {
            return HttpResponse::InternalServerError()
                .json(ApiResponse::<()>::error(format!("Database error: {:?}", e)))
        }
    };

    if !matches!(product.status, crate::models::ProductStatus::Approved) {
        return HttpResponse::BadRequest().json(ApiResponse::<()>::error(
            if lang.starts_with("zh") {
                "仅支持对已通过审核的产品购买定价位。".to_string()
            } else {
                "Only approved products can be sponsored.".to_string()
            },
        ));
    }
    if !is_same_user_email(&product.maker_email, &user_email) {
        return HttpResponse::Forbidden().json(ApiResponse::<()>::error(
            if lang.starts_with("zh") {
                "只能为自己提交的产品购买定价位。".to_string()
            } else {
                "You can only sponsor products you submitted.".to_string()
            },
        ));
    }

    let months = body.months.clamp(1, 24);

    /*
     * resolvePricingPlanForCheckout
     * 为本次支付解析对应的定价方案（优先 plan_id/plan_key，其次 placement 默认方案）。
     */
    let pricing_plan = {
        let plan_id = body.plan_id.as_deref().map(|v| v.trim()).filter(|v| !v.is_empty());
        let plan_key = body.plan_key.as_deref().map(|v| v.trim()).filter(|v| !v.is_empty());

        if let Some(id) = plan_id {
            match db.get_pricing_plan_by_id(id).await {
                Ok(Some(plan)) => Some(plan),
                Ok(None) => {
                    return HttpResponse::BadRequest()
                        .json(ApiResponse::<()>::error("Invalid plan_id".to_string()))
                }
                Err(e) => {
                    return HttpResponse::InternalServerError()
                        .json(ApiResponse::<()>::error(format!("Database error: {:?}", e)))
                }
            }
        } else if let Some(key) = plan_key {
            match db.get_pricing_plan_by_key(key).await {
                Ok(Some(plan)) => Some(plan),
                Ok(None) => {
                    return HttpResponse::BadRequest()
                        .json(ApiResponse::<()>::error("Invalid plan_key".to_string()))
                }
                Err(e) => {
                    return HttpResponse::InternalServerError()
                        .json(ApiResponse::<()>::error(format!("Database error: {:?}", e)))
                }
            }
        } else {
            match db.get_default_pricing_plan_for_placement(Some(&placement)).await {
                Ok(v) => v,
                Err(e) => {
                    return HttpResponse::InternalServerError()
                        .json(ApiResponse::<()>::error(format!("Database error: {:?}", e)))
                }
            }
        }
    };

    if let Some(ref plan) = pricing_plan {
        if !plan.is_active {
            return HttpResponse::BadRequest()
                .json(ApiResponse::<()>::error("Pricing plan is inactive".to_string()));
        }
        if plan
            .placement
            .as_deref()
            .map(|v| v.trim())
            .filter(|v| !v.is_empty())
            != Some(placement.as_str())
        {
            return HttpResponse::BadRequest().json(ApiResponse::<()>::error(
                "Pricing plan placement mismatch".to_string(),
            ));
        }
    }

    let order_id = match db
        .create_sponsorship_order(
            &user_email,
            user_id.as_deref(),
            &product_id,
            &placement,
            body.slot_index,
            months,
            pricing_plan
                .as_ref()
                .map(|p| (p.id.as_str(), p.plan_key.as_str(), p.monthly_usd_cents, p.campaign.percent_off)),
        )
        .await
    {
        Ok(id) => id,
        Err(e) => {
            return HttpResponse::InternalServerError()
                .json(ApiResponse::<()>::error(format!("Database error: {:?}", e)))
        }
    };

    let creem_api_key = env::var("CREEM_API_KEY").ok().unwrap_or_default();
    if creem_api_key.trim().is_empty() {
        return HttpResponse::ServiceUnavailable().json(ApiResponse::<()>::error(
            if lang.starts_with("zh") {
                "支付未配置：缺少 Creem API Key（CREEM_API_KEY）。".to_string()
            } else {
                "Payment is not configured: missing CREEM_API_KEY.".to_string()
            },
        ));
    }

    /*
     * resolveCreemProductId
     * 根据定价方案（含活动）选择 Creem product_id；若缺失则回退到旧的环境变量。
     */
    let creem_product_id = {
        let now = Utc::now();
        let mut selected: Option<String> = None;
        if let Some(ref plan) = pricing_plan {
            let campaign = &plan.campaign;
            let within = (campaign.starts_at.is_none() || campaign.starts_at.unwrap() <= now)
                && (campaign.ends_at.is_none() || campaign.ends_at.unwrap() >= now);
            if campaign.active && within {
                if let Some(v) = campaign.creem_product_id.as_deref().map(|v| v.trim()).filter(|v| !v.is_empty()) {
                    selected = Some(v.to_string());
                }
            }
            if selected.is_none() {
                if let Some(v) = plan
                    .creem_product_id
                    .as_deref()
                    .map(|v| v.trim())
                    .filter(|v| !v.is_empty())
                {
                    selected = Some(v.to_string());
                }
            }
        }

        if let Some(v) = selected {
            v
        } else if placement == "home_top" {
            env::var("CREEM_PRODUCT_ID_HOME_TOP")
                .ok()
                .unwrap_or_default()
        } else {
            env::var("CREEM_PRODUCT_ID_HOME_RIGHT")
                .ok()
                .unwrap_or_default()
        }
    };
    if creem_product_id.trim().is_empty() {
        return HttpResponse::ServiceUnavailable().json(ApiResponse::<()>::error(
            if lang.starts_with("zh") {
                if pricing_plan.is_some() {
                    "支付未配置：当前定价方案未设置 Creem 产品 ID，请在管理后台的「定价管理」为该方案配置 creem_product_id。".to_string()
                } else {
                    "支付未配置：缺少 Creem 产品 ID（CREEM_PRODUCT_ID_HOME_TOP / CREEM_PRODUCT_ID_HOME_RIGHT）。".to_string()
                }
            } else {
                if pricing_plan.is_some() {
                    "Payment is not configured: the selected pricing plan has no Creem product id.".to_string()
                } else {
                    "Payment is not configured: missing CREEM_PRODUCT_ID_HOME_TOP / CREEM_PRODUCT_ID_HOME_RIGHT."
                        .to_string()
                }
            },
        ));
    }

    let locale = locale_from_accept_language(lang);
    let success_url = format!(
        "{}/{}/pricing?paid=1&order_id={}",
        frontend_base_url(),
        locale,
        urlencoding::encode(&order_id)
    );

    let metadata = serde_json::json!({
        "sf_kind": "sponsorship",
        "sf_order_id": order_id,
        "sf_user_email": user_email,
        "sf_user_id": user_id,
        "sf_product_id": product_id,
        "sf_placement": placement,
        "sf_slot_index": body.slot_index,
        "sf_requested_months": months,
        "sf_note": body.note.as_deref().unwrap_or("").trim(),
        "sf_plan_id": pricing_plan.as_ref().map(|p| p.id.as_str()).unwrap_or(""),
        "sf_plan_key": pricing_plan.as_ref().map(|p| p.plan_key.as_str()).unwrap_or(""),
    });

    let creem_req = CreemCreateCheckoutRequest {
        product_id: creem_product_id.trim(),
        request_id: &order_id,
        units: months,
        success_url: &success_url,
        customer: Some(CreemCustomer { email: &user_email }),
        metadata,
    };

    let client = Client::builder()
        .timeout(StdDuration::from_secs(12))
        .connect_timeout(StdDuration::from_secs(4))
        .http1_only()
        .build()
        .unwrap_or_else(|_| Client::new());

    let url = format!("{}/v1/checkouts", creem_base_url());
    let resp = match client
        .post(url)
        .header("x-api-key", creem_api_key)
        .header("Content-Type", "application/json")
        .header("Accept", "application/json")
        .json(&creem_req)
        .send()
        .await
    {
        Ok(v) => v,
        Err(e) => {
            return HttpResponse::BadGateway().json(ApiResponse::<()>::error(format!(
                "Creem request failed: {}",
                e
            )));
        }
    };

    let status = resp.status();
    let parsed = resp.json::<CreemCreateCheckoutResponse>().await.ok();
    let checkout_id = parsed
        .as_ref()
        .and_then(|v| v.id.as_deref())
        .unwrap_or("")
        .trim()
        .to_string();
    let checkout_url = parsed
        .as_ref()
        .and_then(|v| v.checkout_url.as_deref())
        .unwrap_or("")
        .trim()
        .to_string();

    if !status.is_success() || checkout_url.is_empty() {
        return HttpResponse::BadGateway().json(ApiResponse::<()>::error(
            if lang.starts_with("zh") {
                "创建支付失败，请稍后重试。".to_string()
            } else {
                "Failed to create checkout. Please try again later.".to_string()
            },
        ));
    }

    if !checkout_id.is_empty() {
        let _ = db
            .set_sponsorship_order_provider_checkout_id(&order_id, &checkout_id)
            .await;
    }

    HttpResponse::Ok().json(ApiResponse::success(CreateSponsorshipCheckoutPayload {
        order_id,
        checkout_url,
    }))
}

fn hex_lower(bytes: &[u8]) -> String {
    const CHARS: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        out.push(CHARS[(b >> 4) as usize] as char);
        out.push(CHARS[(b & 0x0f) as usize] as char);
    }
    out
}

fn decode_hex_bytes(hex: &str) -> Option<Vec<u8>> {
    let s = hex.trim();
    if s.len() % 2 != 0 {
        return None;
    }
    let mut out = Vec::with_capacity(s.len() / 2);
    let bytes = s.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        let hi = bytes[i];
        let lo = bytes[i + 1];
        let hi = (hi as char).to_digit(16)? as u8;
        let lo = (lo as char).to_digit(16)? as u8;
        out.push((hi << 4) | lo);
        i += 2;
    }
    Some(out)
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff: u8 = 0;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

fn verify_creem_signature(payload: &[u8], signature_hex: &str, secret: &str) -> bool {
    let signature_hex = signature_hex.trim().to_ascii_lowercase();
    if signature_hex.is_empty() || secret.trim().is_empty() {
        return false;
    }
    type HmacSha256 = Hmac<Sha256>;
    let mut mac = match HmacSha256::new_from_slice(secret.as_bytes()) {
        Ok(v) => v,
        Err(_) => return false,
    };
    mac.update(payload);
    let computed = mac.finalize().into_bytes();
    if let Some(sig) = decode_hex_bytes(&signature_hex) {
        constant_time_eq(&computed, &sig)
    } else {
        hex_lower(&computed) == signature_hex
    }
}

fn get_json_string_field<'a>(v: &'a serde_json::Value, key: &str) -> Option<&'a str> {
    v.get(key)
        .and_then(|vv| vv.as_str())
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
}

fn get_json_i64_field(v: &serde_json::Value, key: &str) -> Option<i64> {
    v.get(key).and_then(|vv| vv.as_i64())
}

fn get_json_object<'a>(v: &'a serde_json::Value, key: &str) -> Option<&'a serde_json::Value> {
    v.get(key).filter(|vv| vv.is_object())
}

fn extract_creem_event_envelope(
    payload: &serde_json::Value,
) -> (String, String, serde_json::Value) {
    let event_id = get_json_string_field(payload, "id")
        .unwrap_or("")
        .to_string();
    let event_type = get_json_string_field(payload, "eventType")
        .or_else(|| get_json_string_field(payload, "type"))
        .unwrap_or("")
        .to_string();

    if let Some(obj) = get_json_object(payload, "object") {
        return (event_id, event_type, obj.clone());
    }
    if let Some(data) = get_json_object(payload, "data") {
        if let Some(obj) = get_json_object(data, "object") {
            return (event_id, event_type, obj.clone());
        }
    }
    (event_id, event_type, serde_json::Value::Null)
}

pub async fn creem_webhook(
    req: HttpRequest,
    body: web::Bytes,
    db: web::Data<Arc<Database>>,
) -> impl Responder {
    let secret = env::var("CREEM_WEBHOOK_SECRET").ok().unwrap_or_default();
    if secret.trim().is_empty() {
        return HttpResponse::InternalServerError().json(ApiResponse::<()>::error(
            "CREEM_WEBHOOK_SECRET is not configured".to_string(),
        ));
    }
    let signature = req
        .headers()
        .get("creem-signature")
        .and_then(|h| h.to_str().ok())
        .unwrap_or("")
        .to_string();
    if !verify_creem_signature(&body, &signature, &secret) {
        return HttpResponse::BadRequest()
            .json(ApiResponse::<()>::error("Invalid signature".to_string()));
    }

    let payload: serde_json::Value = match serde_json::from_slice(&body) {
        Ok(v) => v,
        Err(_) => {
            return HttpResponse::BadRequest()
                .json(ApiResponse::<()>::error("Invalid JSON payload".to_string()))
        }
    };
    let (event_id, event_type, object) = extract_creem_event_envelope(&payload);
    if event_id.trim().is_empty() {
        return HttpResponse::Ok().json(ApiResponse::success(OkPayload { ok: true }));
    }

    let _ = db
        .insert_creem_webhook_event_if_absent(&event_id, &event_type, &payload)
        .await;

    let mut processing_error: Option<String> = None;
    let mut transient_error = false;

    if event_type != "checkout.completed" {
        let _ = db.mark_creem_webhook_event_succeeded(&event_id).await;
        return HttpResponse::Ok().json(ApiResponse::success(OkPayload { ok: true }));
    }

    if event_type == "checkout.completed" {
        let metadata = object
            .get("metadata")
            .cloned()
            .unwrap_or(serde_json::Value::Null);
        let order_id = get_json_string_field(&metadata, "sf_order_id")
            .unwrap_or("")
            .to_string();
        let user_email = get_json_string_field(&metadata, "sf_user_email")
            .unwrap_or("")
            .to_string();
        let product_id = get_json_string_field(&metadata, "sf_product_id")
            .unwrap_or("")
            .to_string();
        let placement = get_json_string_field(&metadata, "sf_placement")
            .unwrap_or("")
            .to_string();
        let slot_index = metadata
            .get("sf_slot_index")
            .and_then(|v| v.as_i64())
            .map(|v| v as i32);

        let order_obj = object
            .get("order")
            .cloned()
            .unwrap_or(serde_json::Value::Null);
        let amount_paid = get_json_i64_field(&order_obj, "amount_paid")
            .or_else(|| get_json_i64_field(&order_obj, "amount_due"))
            .or_else(|| get_json_i64_field(&order_obj, "amount"))
            .unwrap_or(0);
        let currency = get_json_string_field(&order_obj, "currency").unwrap_or("USD");
        let provider_order_id = get_json_string_field(&order_obj, "id").map(|s| s.to_string());

        let months = get_json_i64_field(&metadata, "sf_requested_months")
            .map(|v| v.clamp(1, 24) as i32)
            .unwrap_or(0);

        if order_id.trim().is_empty()
            || user_email.trim().is_empty()
            || product_id.trim().is_empty()
            || amount_paid <= 0
            || !currency.eq_ignore_ascii_case("USD")
        {
            processing_error = Some("Invalid checkout metadata or amount".to_string());
        } else {
            match db.get_sponsorship_order_basic(&order_id).await {
                Ok(Some((
                    status,
                    order_email,
                    order_product_id,
                    order_placement,
                    order_slot_index,
                    order_requested_months,
                    grant_id,
                ))) => {
                    let paid_months = if months > 0 { months } else { order_requested_months };
                    if paid_months <= 0 {
                        processing_error = Some("Invalid requested months".to_string());
                    } else if !is_same_user_email(&order_email, &user_email)
                        || order_product_id.trim() != product_id.trim()
                        || order_placement.trim() != placement.trim()
                        || order_slot_index != slot_index
                    {
                        processing_error =
                            Some("Checkout metadata does not match order record".to_string());
                    } else if status == "paid" && grant_id.is_some() {
                        let _ = db.mark_creem_webhook_event_succeeded(&event_id).await;
                        return HttpResponse::Ok().json(ApiResponse::success(OkPayload { ok: true }));
                    } else if let Err(e) = db
                        .upsert_developer_sponsor(&user_email, Some("sponsor"), true)
                        .await
                    {
                        transient_error = true;
                        processing_error = Some(format!("Failed to update sponsor: {:?}", e));
                    } else {
                        match db
                            .create_sponsorship_grant_and_mark_order_paid_from_creem(
                                &order_id,
                                provider_order_id.as_deref(),
                                amount_paid as i32,
                                paid_months,
                            )
                            .await
                        {
                            Ok(_grant) => {}
                            Err(e) => {
                                transient_error = true;
                                processing_error = Some(format!("Failed to finalize order: {:?}", e));
                            }
                        }
                    }
                }
                Ok(None) => {
                    processing_error = Some("Sponsorship order not found".to_string());
                }
                Err(e) => {
                    transient_error = true;
                    processing_error = Some(format!("Failed to fetch order: {:?}", e));
                }
            }
        }
    }

    if let Some(err) = processing_error.as_deref() {
        let _ = db
            .mark_creem_webhook_event_failed(&event_id, err, !transient_error)
            .await;
        if transient_error {
            return HttpResponse::InternalServerError().json(ApiResponse::<()>::error(
                "Temporary processing error".to_string(),
            ));
        }
        return HttpResponse::BadRequest().json(ApiResponse::<()>::error(err.to_string()));
    }

    let _ = db.mark_creem_webhook_event_succeeded(&event_id).await;
    HttpResponse::Ok().json(ApiResponse::success(OkPayload { ok: true }))
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
        maker_email: None,
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
    req: HttpRequest,
    path: web::Path<String>,
    db: web::Data<Arc<Database>>,
) -> impl Responder {
    let id = path.into_inner();

    match db.get_product_by_id(&id).await {
        Ok(Some(product)) => {
            let is_admin = validate_admin_token(&req).is_ok();
            if matches!(product.status, crate::models::ProductStatus::Approved) || is_admin {
                return HttpResponse::Ok().json(ApiResponse::success(product));
            }

            if let Some(token) = extract_bearer_token(&req) {
                if let Some(email) = resolve_supabase_email_from_bearer(&token).await {
                    if is_same_user_email(&product.maker_email, &email) {
                        return HttpResponse::Ok().json(ApiResponse::success(product));
                    }
                }
            }

            HttpResponse::NotFound().json(ApiResponse::<()>::error("Product not found".to_string()))
        }
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
        (status = 400, body = EmptyApiResponse),
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

    /**
     * count_unicode_characters
     * 统计字符串的 Unicode 字符数量（按 Rust char 计数）。
     */
    fn count_unicode_characters(value: &str) -> usize {
        value.chars().count()
    }

    const MIN_PRODUCT_DESCRIPTION_CHARS: usize = 250;

    let product = product_data.into_inner();
    let desc_len = count_unicode_characters(product.description.trim());
    if desc_len < MIN_PRODUCT_DESCRIPTION_CHARS {
        let message = if lang.starts_with("zh") {
            format!(
                "产品描述至少需要 {} 个字符（当前 {}）。",
                MIN_PRODUCT_DESCRIPTION_CHARS, desc_len
            )
        } else {
            format!(
                "Product description must be at least {} characters (current {}).",
                MIN_PRODUCT_DESCRIPTION_CHARS, desc_len
            )
        };
        return HttpResponse::BadRequest().json(ApiResponse::<()>::error(message));
    }

    match db.create_product(product).await {
        Ok(product) => {
            let db_for_email = db.get_ref().clone();
            let product_for_email = product.clone();
            tokio::spawn(async move {
                let _ = db_for_email
                    .send_admin_product_submission_notification(&product_for_email)
                    .await;
            });

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

fn verify_admin_review_token(
    product_id: &str,
    action: &str,
    exp_ts: i64,
    token: &str,
    secret: &str,
) -> bool {
    if secret.trim().is_empty() {
        return false;
    }
    let token = token.trim();
    if token.is_empty() {
        return false;
    }
    if exp_ts <= Utc::now().timestamp() {
        return false;
    }

    let sig = match general_purpose::URL_SAFE_NO_PAD.decode(token) {
        Ok(v) => v,
        Err(_) => return false,
    };

    type HmacSha256 = Hmac<Sha256>;
    let mut mac = match HmacSha256::new_from_slice(secret.as_bytes()) {
        Ok(v) => v,
        Err(_) => return false,
    };
    mac.update(product_id.as_bytes());
    mac.update(b"|");
    mac.update(action.as_bytes());
    mac.update(b"|");
    mac.update(exp_ts.to_string().as_bytes());
    mac.verify_slice(&sig).is_ok()
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct AdminReviewProductQuery {
    pub product_id: Option<String>,
    pub action: Option<String>,
    pub exp: Option<i64>,
    pub sig: Option<String>,
}

pub async fn admin_review_product(
    query: web::Query<AdminReviewProductQuery>,
    db: web::Data<Arc<Database>>,
) -> impl Responder {
    let product_id = query.product_id.as_deref().unwrap_or("").trim().to_string();
    let action = query
        .action
        .as_deref()
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();
    let exp = query.exp.unwrap_or(0);
    let sig = query.sig.as_deref().unwrap_or("").trim().to_string();

    if product_id.is_empty() {
        return HttpResponse::BadRequest()
            .content_type("text/html; charset=utf-8")
            .body("<h2>请求无效</h2><p>缺少 product_id。</p><hr/><h2>Invalid request</h2><p>Missing product_id.</p>");
    }
    if action != "approve" && action != "reject" {
        return HttpResponse::BadRequest()
            .content_type("text/html; charset=utf-8")
            .body("<h2>请求无效</h2><p>action 必须为 approve 或 reject。</p><hr/><h2>Invalid request</h2><p>action must be approve or reject.</p>");
    }

    let secret = env::var("ADMIN_REVIEW_TOKEN_SECRET")
        .ok()
        .unwrap_or_default();
    if !verify_admin_review_token(&product_id, &action, exp, &sig, &secret) {
        return HttpResponse::BadRequest()
            .content_type("text/html; charset=utf-8")
            .body("<h2>链接无效或已过期</h2><p>请检查链接或重新发起审核。</p><hr/><h2>Invalid or expired link</h2><p>Please check the link or request a new review.</p>");
    }

    let existing = match db.get_product_by_id(&product_id).await {
        Ok(Some(v)) => v,
        Ok(None) => {
            return HttpResponse::NotFound()
                .content_type("text/html; charset=utf-8")
                .body("<h2>产品不存在</h2><p>未找到该产品。</p><hr/><h2>Product not found</h2><p>No product matches the given id.</p>");
        }
        Err(e) => {
            if is_db_unavailable_error(&e) {
                return HttpResponse::Ok()
                    .content_type("text/html; charset=utf-8")
                    .body("<h2>数据库暂不可用</h2><p>请稍后重试。</p><hr/><h2>Database unavailable</h2><p>Please try again later.</p>");
            }
            return HttpResponse::InternalServerError()
                .content_type("text/html; charset=utf-8")
                .body("<h2>服务器错误</h2><p>请稍后重试。</p><hr/><h2>Server error</h2><p>Please try again later.</p>");
        }
    };

    if action == "approve" && matches!(existing.status, crate::models::ProductStatus::Approved) {
        return HttpResponse::Ok()
            .content_type("text/html; charset=utf-8")
            .body("<h2>已通过</h2><p>该产品之前已通过审核。</p><hr/><h2>Already approved</h2><p>This product has already been approved.</p>");
    }
    if action == "reject" && matches!(existing.status, crate::models::ProductStatus::Rejected) {
        return HttpResponse::Ok()
            .content_type("text/html; charset=utf-8")
            .body("<h2>已拒绝</h2><p>该产品之前已被拒绝。</p><hr/><h2>Already rejected</h2><p>This product has already been rejected.</p>");
    }

    let updates = if action == "approve" {
        UpdateProductRequest {
            name: None,
            slogan: None,
            description: None,
            website: None,
            logo_url: None,
            category: None,
            tags: None,
            status: Some(crate::models::ProductStatus::Approved),
            rejection_reason: Some(String::new()),
        }
    } else {
        UpdateProductRequest {
            name: None,
            slogan: None,
            description: None,
            website: None,
            logo_url: None,
            category: None,
            tags: None,
            status: Some(crate::models::ProductStatus::Rejected),
            rejection_reason: Some("Rejected by admin review".to_string()),
        }
    };

    match db.update_product(&product_id, updates).await {
        Ok(Some(product)) => {
            let db_for_email = db.get_ref().clone();
            let product_for_email = product.clone();
            tokio::spawn(async move {
                let _ = db_for_email
                    .send_maker_product_review_notification(&product_for_email)
                    .await;
            });

            if action == "approve" {
                HttpResponse::Ok().content_type("text/html; charset=utf-8").body(
                    "<h2>审核通过</h2><p>该产品已被标记为 approved。</p><hr/><h2>Approved</h2><p>The product is now approved.</p>",
                )
            } else {
                HttpResponse::Ok().content_type("text/html; charset=utf-8").body(
                    "<h2>已拒绝</h2><p>该产品已被标记为 rejected。</p><hr/><h2>Rejected</h2><p>The product is now rejected.</p>",
                )
            }
        }
        Ok(None) => HttpResponse::NotFound()
            .content_type("text/html; charset=utf-8")
            .body("<h2>产品不存在</h2><p>未找到该产品。</p><hr/><h2>Product not found</h2><p>No product matches the given id.</p>"),
        Err(e) => {
            if is_db_unavailable_error(&e) {
                return HttpResponse::Ok()
                    .content_type("text/html; charset=utf-8")
                    .body("<h2>数据库暂不可用</h2><p>请稍后重试。</p><hr/><h2>Database unavailable</h2><p>Please try again later.</p>");
            }
            HttpResponse::InternalServerError()
                .content_type("text/html; charset=utf-8")
                .body("<h2>服务器错误</h2><p>请稍后重试。</p><hr/><h2>Server error</h2><p>Please try again later.</p>")
        }
    }
}

pub async fn update_product(
    req: HttpRequest,
    path: web::Path<String>,
    update_data: web::Json<UpdateProductRequest>,
    db: web::Data<Arc<Database>>,
) -> impl Responder {
    let id = path.into_inner();
    let mut updates = update_data.into_inner();

    /**
     * count_unicode_characters
     * 统计字符串的 Unicode 字符数量（按 Rust char 计数）。
     */
    fn count_unicode_characters(value: &str) -> usize {
        value.chars().count()
    }

    const MIN_PRODUCT_DESCRIPTION_CHARS: usize = 250;

    if let Some(desc) = updates.description.as_deref() {
        let lang = req
            .headers()
            .get("Accept-Language")
            .and_then(|h| h.to_str().ok())
            .unwrap_or("en");
        let desc_len = count_unicode_characters(desc.trim());
        if desc_len < MIN_PRODUCT_DESCRIPTION_CHARS {
            let message = if lang.starts_with("zh") {
                format!(
                    "产品描述至少需要 {} 个字符（当前 {}）。",
                    MIN_PRODUCT_DESCRIPTION_CHARS, desc_len
                )
            } else {
                format!(
                    "Product description must be at least {} characters (current {}).",
                    MIN_PRODUCT_DESCRIPTION_CHARS, desc_len
                )
            };
            return HttpResponse::BadRequest().json(ApiResponse::<()>::error(message));
        }
    }
    let existing = match db.get_product_by_id(&id).await {
        Ok(Some(v)) => v,
        Ok(None) => {
            return HttpResponse::NotFound()
                .json(ApiResponse::<()>::error("Product not found".to_string()))
        }
        Err(e) => {
            return HttpResponse::InternalServerError()
                .json(ApiResponse::<()>::error(format!("Database error: {:?}", e)))
        }
    };

    if let Some(status) = updates.status.clone() {
        match status {
            crate::models::ProductStatus::Rejected => {
                let reason = updates
                    .rejection_reason
                    .as_deref()
                    .unwrap_or("")
                    .trim()
                    .to_string();
                if reason.is_empty() {
                    return HttpResponse::BadRequest().json(ApiResponse::<()>::error(
                        "Missing rejection_reason".to_string(),
                    ));
                }
                updates.rejection_reason = Some(reason);
            }
            _ => {
                updates.rejection_reason = Some(String::new());
            }
        }
    }

    match db.update_product(&id, updates).await {
        Ok(Some(product)) => {
            let should_notify = product.status != existing.status
                && matches!(
                    product.status,
                    crate::models::ProductStatus::Approved | crate::models::ProductStatus::Rejected
                );
            if should_notify {
                let db_for_email = db.get_ref().clone();
                let product_for_email = product.clone();
                tokio::spawn(async move {
                    let _ = db_for_email
                        .send_maker_product_review_notification(&product_for_email)
                        .await;
                });
            }

            HttpResponse::Ok().json(ApiResponse::success(product))
        }
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

pub async fn get_developer_popularity_last_week(
    query: web::Query<DeveloperPopularityQuery>,
    db: web::Data<Arc<Database>>,
) -> impl Responder {
    let limit = query.limit.unwrap_or(10).clamp(1, 50);
    match db.get_developer_popularity_last_week(limit).await {
        Ok(list) => HttpResponse::Ok().json(ApiResponse::success(list)),
        Err(e) => {
            if is_db_unavailable_error(&e) {
                return HttpResponse::Ok().json(make_db_degraded_response(
                    "GET /api/developers/popularity-last-week",
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

fn is_valid_email_basic(email: &str) -> bool {
    let e = email.trim();
    if e.is_empty() || e.len() > 320 {
        return false;
    }
    let at = match e.find('@') {
        Some(v) => v,
        None => return false,
    };
    if at == 0 || at + 1 >= e.len() {
        return false;
    }
    let domain = &e[at + 1..];
    domain.contains('.') && !domain.starts_with('.') && !domain.ends_with('.')
}

/**
 * verify_newsletter_unsubscribe_token
 * 校验退订 token（HMAC-SHA256 + URL-safe base64，无 padding）。
 */
fn verify_newsletter_unsubscribe_token(email: &str, token: &str, secret: &str) -> bool {
    if secret.trim().is_empty() {
        return true;
    }
    let token = token.trim();
    if token.is_empty() {
        return false;
    }
    let sig = match general_purpose::URL_SAFE_NO_PAD.decode(token) {
        Ok(v) => v,
        Err(_) => return false,
    };

    type HmacSha256 = Hmac<Sha256>;
    let mut mac = match HmacSha256::new_from_slice(secret.as_bytes()) {
        Ok(v) => v,
        Err(_) => return false,
    };
    mac.update(email.as_bytes());
    mac.verify_slice(&sig).is_ok()
}

pub async fn subscribe_newsletter(
    req: HttpRequest,
    body: web::Json<NewsletterSubscribeRequest>,
    db: web::Data<Arc<Database>>,
) -> impl Responder {
    let raw = body.email.trim().to_string();
    let email = raw.trim().to_ascii_lowercase();
    if !is_valid_email_basic(&email) {
        let lang = get_language_from_request(&req);
        let msg = if lang.starts_with("zh") {
            "邮箱格式不正确。"
        } else {
            "Invalid email address."
        };
        return HttpResponse::BadRequest().json(ApiResponse::<()>::error(msg.to_string()));
    }

    match db.subscribe_newsletter(&email).await {
        Ok(()) => HttpResponse::Ok().json(ApiResponse::success(OkPayload { ok: true })),
        Err(e) => {
            if is_db_unavailable_error(&e) {
                let lang = get_language_from_request(&req);
                let msg = if lang.starts_with("zh") {
                    "数据库连接不可用，已降级忽略写入。"
                } else {
                    "Database is unavailable. Subscription write is skipped in degraded mode."
                };
                return HttpResponse::Ok().json(make_db_degraded_response(
                    "POST /api/newsletter/subscribe",
                    OkPayload { ok: false },
                    msg.to_string(),
                    &e,
                ));
            }
            HttpResponse::InternalServerError()
                .json(ApiResponse::<()>::error(format!("Database error: {:?}", e)))
        }
    }
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct NewsletterUnsubscribeQuery {
    pub email: String,
    pub token: Option<String>,
}

/**
 * unsubscribe_newsletter
 * 退订周报（用于邮件内退订链接）。
 */
pub async fn unsubscribe_newsletter(
    query: web::Query<NewsletterUnsubscribeQuery>,
    db: web::Data<Arc<Database>>,
) -> impl Responder {
    let email = query.email.trim().to_ascii_lowercase();
    if !is_valid_email_basic(&email) {
        let html = r#"<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;line-height:1.6;">
<h2>退订失败</h2>
<p>邮箱格式不正确。</p>
<hr style="border:none;border-top:1px solid #eee;margin:18px 0;"/>
<h2>Unsubscribe failed</h2>
<p>Invalid email address.</p>
</div>"#;
        return HttpResponse::BadRequest()
            .content_type("text/html; charset=utf-8")
            .body(html);
    }

    let secret = env::var("NEWSLETTER_TOKEN_SECRET").ok().unwrap_or_default();
    let token = query.token.as_deref().unwrap_or("");
    if !verify_newsletter_unsubscribe_token(&email, token, &secret) {
        let html = r#"<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;line-height:1.6;">
<h2>退订失败</h2>
<p>退订链接无效或已过期。</p>
<hr style="border:none;border-top:1px solid #eee;margin:18px 0;"/>
<h2>Unsubscribe failed</h2>
<p>The unsubscribe link is invalid or expired.</p>
</div>"#;
        return HttpResponse::BadRequest()
            .content_type("text/html; charset=utf-8")
            .body(html);
    }

    match db.unsubscribe_newsletter(&email).await {
        Ok(()) => {
            let html = r#"<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;line-height:1.6;">
<h2>退订成功</h2>
<p>你已成功退订 SoloForge 周报。</p>
<hr style="border:none;border-top:1px solid #eee;margin:18px 0;"/>
<h2>Unsubscribed</h2>
<p>You have successfully unsubscribed from the SoloForge weekly brief.</p>
</div>"#;
            HttpResponse::Ok()
                .content_type("text/html; charset=utf-8")
                .body(html)
        }
        Err(e) => {
            if is_db_unavailable_error(&e) {
                let html = r#"<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;line-height:1.6;">
<h2>退订暂不可用</h2>
<p>数据库连接不可用，暂时无法完成退订写入，请稍后重试。</p>
<hr style="border:none;border-top:1px solid #eee;margin:18px 0;"/>
<h2>Unsubscribe unavailable</h2>
<p>The database is unavailable. Please try again later.</p>
</div>"#;
                return HttpResponse::Ok()
                    .content_type("text/html; charset=utf-8")
                    .body(html);
            }
            let _ = e;
            let html = r#"<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;line-height:1.6;">
<h2>退订失败</h2>
<p>服务器错误，请稍后重试。</p>
<hr style="border:none;border-top:1px solid #eee;margin:18px 0;"/>
<h2>Unsubscribe failed</h2>
<p>Server error. Please try again later.</p>
</div>"#;
            HttpResponse::InternalServerError()
                .content_type("text/html; charset=utf-8")
                .body(html)
        }
    }
}

pub async fn preview_newsletter() -> impl Responder {
    if !cfg!(debug_assertions) {
        return HttpResponse::NotFound().finish();
    }

    let now = chrono::Utc::now();
    let since = now - chrono::Duration::days(7);

    let frontend_base_url = env::var("FRONTEND_BASE_URL")
        .ok()
        .unwrap_or_else(|| "http://localhost:3000".to_string());

    let unsubscribe_url = "http://localhost:8080/api/newsletter/unsubscribe?email=preview%40example.com&token=preview"
        .to_string();

    let products = vec![
        crate::db::NewsletterTopProductRow {
            id: "preview-1".to_string(),
            name: "PromptDock".to_string(),
            slogan: "Manage prompts & snippets fast".to_string(),
            website: "https://example.com/promptdock".to_string(),
            maker_name: "Alex".to_string(),
            maker_email: "alex@example.com".to_string(),
            weekly_likes: 128,
            weekly_favorites: 64,
            score: 192,
        },
        crate::db::NewsletterTopProductRow {
            id: "preview-2".to_string(),
            name: "写作加速器".to_string(),
            slogan: "让内容产出更快".to_string(),
            website: "https://example.com/writing-booster".to_string(),
            maker_name: "小王".to_string(),
            maker_email: "xiaowang@example.com".to_string(),
            weekly_likes: 97,
            weekly_favorites: 52,
            score: 149,
        },
        crate::db::NewsletterTopProductRow {
            id: "preview-3".to_string(),
            name: "LaunchKit".to_string(),
            slogan: "Landing page + waitlist template".to_string(),
            website: "https://example.com/launchkit".to_string(),
            maker_name: "Chen".to_string(),
            maker_email: "chen@example.com".to_string(),
            weekly_likes: 66,
            weekly_favorites: 38,
            score: 104,
        },
        crate::db::NewsletterTopProductRow {
            id: "preview-4".to_string(),
            name: "API 体检".to_string(),
            slogan: "自动化检查接口健康".to_string(),
            website: "https://example.com/api-health".to_string(),
            maker_name: "阿杰".to_string(),
            maker_email: "ajie@example.com".to_string(),
            weekly_likes: 59,
            weekly_favorites: 31,
            score: 90,
        },
        crate::db::NewsletterTopProductRow {
            id: "preview-5".to_string(),
            name: "BudgetBee".to_string(),
            slogan: "Personal finance for creators".to_string(),
            website: "https://example.com/budgetbee".to_string(),
            maker_name: "Sana".to_string(),
            maker_email: "sana@example.com".to_string(),
            weekly_likes: 41,
            weekly_favorites: 22,
            score: 63,
        },
    ];

    let (subject, html, _text) = crate::db::build_weekly_newsletter_content(
        now,
        since,
        &products,
        &frontend_base_url,
        &unsubscribe_url,
    );

    HttpResponse::Ok()
        .insert_header(("Content-Type", "text/html; charset=utf-8"))
        .insert_header(("X-Newsletter-Subject", subject))
        .body(html)
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

pub async fn get_developer_center_stats(
    path: web::Path<DeveloperPath>,
    db: web::Data<Arc<Database>>,
) -> impl Responder {
    let email = path.into_inner().email.trim().to_ascii_lowercase();

    match db.get_developer_center_stats(&email).await {
        Ok(stats) => HttpResponse::Ok().json(ApiResponse::success(stats)),
        Err(e) => {
            if is_db_unavailable_error(&e) {
                return HttpResponse::Ok().json(make_db_degraded_response(
                    "GET /api/developers/{email}/center-stats",
                    DeveloperCenterStats {
                        followers: 0,
                        total_likes: 0,
                        total_favorites: 0,
                    },
                    "数据库连接不可用，已降级返回空统计。".to_string(),
                    &e,
                ));
            }
            HttpResponse::InternalServerError()
                .json(ApiResponse::<()>::error(format!("Database error: {:?}", e)))
        }
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
    pub maker_email: String,
    pub avatar_url: Option<String>,
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
        maker_email: None,
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
        *maker_counts
            .entry(product.maker_email.trim().to_ascii_lowercase())
            .or_insert(0) += 1;
    }

    let mut maker_names = std::collections::HashMap::<String, String>::new();
    for product in &top_products {
        let email = product.maker_email.trim().to_ascii_lowercase();
        if email.is_empty() {
            continue;
        }
        let name = product.maker_name.trim().to_string();
        if name.is_empty() {
            continue;
        }
        maker_names.entry(email).or_insert(name);
    }

    let mut maker_items = maker_counts.into_iter().collect::<Vec<_>>();
    maker_items.sort_by(|a, b| b.1.cmp(&a.1));
    maker_items.truncate(10);

    let mut top_makers = Vec::with_capacity(maker_items.len());
    for (maker_email, product_count) in maker_items {
        let maker_name = maker_names
            .get(&maker_email)
            .cloned()
            .unwrap_or_else(|| maker_email.clone());
        let avatar_url = match db.get_developer_by_email(&maker_email).await {
            Ok(Some(dev)) => dev.avatar_url,
            _ => None,
        };
        top_makers.push(MakerRank {
            maker_name,
            maker_email,
            avatar_url,
            product_count,
        });
    }

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

#[allow(dead_code)]
fn start_of_next_day_utc(now: chrono::DateTime<Utc>) -> chrono::DateTime<Utc> {
    let today = now.date_naive();
    let next = today
        .succ_opt()
        .unwrap_or_else(|| today + chrono::Duration::days(1));
    chrono::DateTime::<Utc>::from_naive_utc_and_offset(next.and_hms_opt(0, 0, 0).unwrap(), Utc)
}

fn start_of_next_window_utc(
    now: chrono::DateTime<Utc>,
    window_seconds: i64,
) -> chrono::DateTime<Utc> {
    let window_seconds = window_seconds.max(1);
    let current_start_ts = (now.timestamp() / window_seconds) * window_seconds;
    let next_start_ts = current_start_ts + window_seconds;
    chrono::DateTime::<Utc>::from_timestamp(next_start_ts, 0)
        .unwrap_or_else(|| now + chrono::Duration::seconds(window_seconds))
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
fn stable_sponsor_assign_to_top(product_id: &str, day_key: chrono::NaiveDate) -> bool {
    let seed = stable_seed_from_day_key(day_key, 0xC3A5C85C97CB3127);
    let mut hasher = DefaultHasher::new();
    seed.hash(&mut hasher);
    product_id.hash(&mut hasher);
    (hasher.finish() & 1) == 0
}

async fn get_or_refresh_free_sponsor_queue_ids(
    db: &Database,
    now: chrono::DateTime<Utc>,
    language: Option<&str>,
) -> anyhow::Result<(Vec<String>, chrono::DateTime<Utc>)> {
    let window_seconds: i64 = 48 * 60 * 60;
    let window_start_ts = (now.timestamp() / window_seconds) * window_seconds;
    let window_key = window_start_ts.to_string();
    let next_refresh = start_of_next_window_utc(now, window_seconds);

    let state_key = "home_sponsored_free_queue";
    if let Ok(Some(state)) = db.get_home_module_state(state_key).await {
        if state.mode.as_deref() == Some("manual") && state.today_ids.len() == 5 {
            return Ok((state.today_ids, next_refresh));
        }
        if state.mode.as_deref() == Some(window_key.as_str()) && state.today_ids.len() == 5 {
            return Ok((state.today_ids, next_refresh));
        }
    }

    let eligible = db
        .get_first_product_ids_by_created_at(100, language)
        .await?;
    if eligible.is_empty() {
        return Ok((Vec::new(), next_refresh));
    }

    let mut remaining: Vec<String> = Vec::new();
    if let Ok(Some(state)) = db.get_home_module_state(state_key).await {
        if state.mode.as_deref() != Some("manual") {
            let set: std::collections::HashSet<&String> = eligible.iter().collect();
            remaining = state
                .remaining_ids
                .into_iter()
                .filter(|id| set.contains(id))
                .collect();
        }
    }
    if remaining.is_empty() {
        remaining = eligible.clone();
    }

    let mut today_ids: Vec<String> = Vec::new();
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    while today_ids.len() < 5 && !remaining.is_empty() {
        let id = remaining.remove(0);
        if seen.insert(id.clone()) {
            today_ids.push(id);
        }
    }
    if today_ids.len() < 5 {
        for id in &eligible {
            if today_ids.len() >= 5 {
                break;
            }
            if seen.insert(id.clone()) {
                today_ids.push(id.clone());
            }
        }
    }

    let _ = db
        .upsert_home_module_state(crate::db::HomeModuleState {
            key: state_key.to_string(),
            mode: Some(window_key),
            day_key: None,
            remaining_ids: remaining,
            today_ids: today_ids.clone(),
        })
        .await;

    Ok((today_ids, next_refresh))
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
    let next_refresh = start_of_next_window_utc(now, 48 * 60 * 60);
    let day_key = now.date_naive();

    let key = "home_sponsored_top";
    let mut ids: Vec<String> = Vec::new();
    if let Ok(Some(state)) = db.get_home_module_state(key).await {
        if state.mode.as_deref() == Some("manual") && state.today_ids.len() == 2 {
            ids = state.today_ids;
        }
    }

    if ids.is_empty() {
        let mut selected: Vec<String> = Vec::new();
        let mut exclude: std::collections::HashSet<String> = std::collections::HashSet::new();

        let paid_grants = match db
            .get_active_sponsorship_grants("home_top", now, query.language.as_deref())
            .await
        {
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

        let paid_ids: Vec<String> = paid_grants.into_iter().map(|(_, id)| id).collect();
        let seed_paid = stable_seed_from_day_key(day_key, 0x9E3779B97F4A7C15);
        let paid_pick = stable_pick_ids(&paid_ids, 2, seed_paid ^ 0xA1B2C3D4E5F60718);
        for id in paid_pick {
            exclude.insert(id.clone());
            selected.push(id);
        }

        if selected.len() < 2 {
            let free_today = match get_or_refresh_free_sponsor_queue_ids(
                db.get_ref().as_ref(),
                now,
                query.language.as_deref(),
            )
            .await
            {
                Ok((ids, _)) => ids,
                Err(e) => {
                    if is_db_unavailable_error(&e) {
                        Vec::new()
                    } else {
                        return HttpResponse::InternalServerError()
                            .json(ApiResponse::<()>::error(format!("Database error: {:?}", e)));
                    }
                }
            };

            let free_top = free_today.into_iter().take(2).collect::<Vec<_>>();
            for id in free_top {
                if selected.len() >= 2 {
                    break;
                }
                if exclude.contains(&id) {
                    continue;
                }
                exclude.insert(id.clone());
                selected.push(id);
            }
        }

        if selected.len() < 2 {
            let params = QueryParams {
                category: None,
                tags: None,
                language: query.language.clone(),
                status: Some("approved".to_string()),
                search: None,
                maker_email: None,
                sort: Some("popularity".to_string()),
                dir: Some("desc".to_string()),
                limit: Some(50),
                offset: None,
            };
            let fallback = match db.get_products(params).await {
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

            for p in fallback {
                if selected.len() >= 2 {
                    break;
                }
                if exclude.contains(&p.id) {
                    continue;
                }
                exclude.insert(p.id.clone());
                selected.push(p.id);
            }
        }

        if selected.is_empty() {
            return HttpResponse::Ok().json(ApiResponse::success(HomeProductsPayload {
                products: Vec::new(),
                next_refresh_at: next_refresh.to_rfc3339(),
            }));
        }

        let products = match db.get_products_by_ids(&selected).await {
            Ok(list) => list,
            Err(e) => {
                return HttpResponse::InternalServerError()
                    .json(ApiResponse::<()>::error(format!("Database error: {:?}", e)));
            }
        };

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
    let next_refresh = start_of_next_window_utc(now, 48 * 60 * 60);
    let day_key = now.date_naive();
    let key = "home_sponsored_right";

    let mut today_ids: Vec<String> = Vec::new();

    if let Ok(Some(state)) = db.get_home_module_state(key).await {
        if state.mode.as_deref() == Some("manual") && state.today_ids.len() == 3 {
            today_ids = state.today_ids;
        }
    }

    if today_ids.is_empty() {
        let mut slots: [Option<String>; 3] = [None, None, None];
        let mut exclude: std::collections::HashSet<String> = std::collections::HashSet::new();

        let paid_grants = match db
            .get_active_sponsorship_grants("home_right", now, query.language.as_deref())
            .await
        {
            Ok(list) => list,
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

        let mut paid_pool: Vec<String> = Vec::new();
        for (slot_index, id) in paid_grants {
            if exclude.contains(&id) {
                continue;
            }
            match slot_index {
                Some(i) if (0..=2).contains(&i) => {
                    let idx = i as usize;
                    if slots[idx].is_none() {
                        exclude.insert(id.clone());
                        slots[idx] = Some(id);
                    } else {
                        paid_pool.push(id);
                    }
                }
                _ => paid_pool.push(id),
            }
        }

        let seed_paid = stable_seed_from_day_key(day_key, 0x9E3779B97F4A7C15) ^ 0xA7F0C3B2D1E4F5A6;
        let paid_pool_pick = stable_pick_ids(&paid_pool, 3, seed_paid);
        let mut paid_pool_iter = paid_pool_pick.into_iter();
        for slot in &mut slots {
            if slot.is_none() {
                if let Some(id) = paid_pool_iter.next() {
                    if !exclude.contains(&id) {
                        exclude.insert(id.clone());
                        *slot = Some(id);
                    }
                }
            }
        }

        let free_today = match get_or_refresh_free_sponsor_queue_ids(
            db.get_ref().as_ref(),
            now,
            query.language.as_deref(),
        )
        .await
        {
            Ok((ids, _)) => ids,
            Err(e) => {
                if is_db_unavailable_error(&e) {
                    Vec::new()
                } else {
                    return HttpResponse::InternalServerError()
                        .json(ApiResponse::<()>::error(format!("Database error: {:?}", e)));
                }
            }
        };

        let mut free_iter = free_today.into_iter().skip(2).take(3);
        for slot in &mut slots {
            if slot.is_none() {
                if let Some(id) = free_iter.next() {
                    exclude.insert(id.clone());
                    *slot = Some(id);
                }
            }
        }

        let mut chosen: Vec<String> = slots.into_iter().flatten().collect();
        if chosen.len() < 3 {
            let params = QueryParams {
                category: None,
                tags: None,
                language: query.language.clone(),
                status: Some("approved".to_string()),
                search: None,
                maker_email: None,
                sort: Some("created_at".to_string()),
                dir: Some("desc".to_string()),
                limit: Some(200),
                offset: None,
            };
            let fallback = match db.get_products(params).await {
                Ok(list) => list,
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

            for p in fallback {
                if chosen.len() >= 3 {
                    break;
                }
                if exclude.contains(&p.id) {
                    continue;
                }
                exclude.insert(p.id.clone());
                chosen.push(p.id);
            }
        }

        today_ids = chosen;
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
        if (state.mode.as_deref() == Some("manual")
            || state.mode.as_deref() == Some(window_key.as_str()))
            && state.today_ids.len() == 6
        {
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
            maker_email: None,
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

/**
 * validate_admin_token
 * 校验管理端 token，避免开放写接口被滥用。
 *
 * - 默认读取 ADMIN_API_TOKEN
 * - 若未配置，则回退使用 DEV_SEED_TOKEN（方便本地开发）
 * - 请求头使用 x-admin-token
 */
fn validate_admin_token(req: &HttpRequest) -> Result<(), HttpResponse> {
    let expected = env::var("ADMIN_API_TOKEN")
        .ok()
        .filter(|v| !v.trim().is_empty())
        .or_else(|| {
            env::var("DEV_SEED_TOKEN")
                .ok()
                .filter(|v| !v.trim().is_empty())
        });

    let expected = match expected {
        Some(v) => v,
        None => {
            return Err(
                HttpResponse::InternalServerError().json(ApiResponse::<()>::error(
                    "ADMIN_API_TOKEN 未配置，且 DEV_SEED_TOKEN 也未配置".to_string(),
                )),
            )
        }
    };

    let provided = req
        .headers()
        .get("x-admin-token")
        .and_then(|h| h.to_str().ok())
        .unwrap_or("");

    if provided != expected {
        return Err(HttpResponse::Forbidden()
            .json(ApiResponse::<()>::error("admin token 无效".to_string())));
    }

    Ok(())
}

#[derive(Debug, Deserialize)]
struct SupabaseAuthUser {
    email: Option<String>,
}

#[derive(Debug, Deserialize)]
struct SupabaseAuthUserFull {
    id: Option<String>,
    email: Option<String>,
}

/**
 * extract_bearer_token
 * 从请求头 Authorization: Bearer <token> 提取 access_token。
 */
fn extract_bearer_token(req: &HttpRequest) -> Option<String> {
    let header = req
        .headers()
        .get("authorization")
        .and_then(|h| h.to_str().ok())?
        .trim();
    if header.is_empty() {
        return None;
    }
    let mut parts = header.split_whitespace();
    let scheme = parts.next().unwrap_or("");
    let token = parts.next().unwrap_or("");
    if !scheme.eq_ignore_ascii_case("bearer") || token.trim().is_empty() {
        return None;
    }
    Some(token.trim().to_string())
}

/**
 * resolve_supabase_user_from_bearer
 * 通过 Supabase Auth 校验 access_token，并返回 (email, user_id)。
 */
async fn resolve_supabase_user_from_bearer(token: &str) -> Option<(String, Option<String>)> {
    let supabase_url = env::var("SUPABASE_URL").ok()?;
    let supabase_key = env::var("SUPABASE_KEY").ok()?;
    if supabase_url.trim().is_empty() || supabase_key.trim().is_empty() {
        return None;
    }

    let client = Client::builder()
        .timeout(StdDuration::from_secs(6))
        .connect_timeout(StdDuration::from_secs(3))
        .http1_only()
        .build()
        .ok()?;

    let url = format!("{}/auth/v1/user", supabase_url.trim_end_matches('/'));
    let resp = client
        .get(url)
        .header("apikey", supabase_key)
        .header("Authorization", format!("Bearer {}", token))
        .header("Accept", "application/json")
        .send()
        .await
        .ok()?;

    if !resp.status().is_success() {
        return None;
    }

    let user = resp.json::<SupabaseAuthUserFull>().await.ok()?;
    let email = user
        .email
        .as_deref()
        .map(|v| v.trim().to_ascii_lowercase())
        .filter(|v| !v.is_empty())?;
    let user_id = user
        .id
        .as_deref()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty());
    Some((email, user_id))
}

/**
 * resolve_supabase_email_from_bearer
 * 通过 Supabase Auth 校验 access_token，并返回 email。
 */
async fn resolve_supabase_email_from_bearer(token: &str) -> Option<String> {
    let supabase_url = env::var("SUPABASE_URL").ok()?;
    let supabase_key = env::var("SUPABASE_KEY").ok()?;
    if supabase_url.trim().is_empty() || supabase_key.trim().is_empty() {
        return None;
    }

    let client = Client::builder()
        .timeout(StdDuration::from_secs(6))
        .connect_timeout(StdDuration::from_secs(3))
        .http1_only()
        .build()
        .ok()?;

    let url = format!("{}/auth/v1/user", supabase_url.trim_end_matches('/'));
    let resp = client
        .get(url)
        .header("apikey", supabase_key)
        .header("Authorization", format!("Bearer {}", token))
        .header("Accept", "application/json")
        .send()
        .await
        .ok()?;

    if !resp.status().is_success() {
        return None;
    }

    let user = resp.json::<SupabaseAuthUser>().await.ok()?;
    user.email
        .as_deref()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct AdminSponsorshipRequestsQuery {
    pub status: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

pub async fn admin_list_sponsorship_requests(
    req: HttpRequest,
    query: web::Query<AdminSponsorshipRequestsQuery>,
    db: web::Data<Arc<Database>>,
) -> impl Responder {
    if let Err(resp) = validate_admin_token(&req) {
        return resp;
    }

    let status = query
        .status
        .as_deref()
        .map(|v| v.trim())
        .filter(|v| !v.is_empty());
    let limit = query.limit.unwrap_or(200);
    let offset = query.offset.unwrap_or(0);

    match db.list_sponsorship_requests(status, limit, offset).await {
        Ok(list) => HttpResponse::Ok().json(ApiResponse::success(list)),
        Err(e) => HttpResponse::InternalServerError()
            .json(ApiResponse::<()>::error(format!("Database error: {:?}", e))),
    }
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct AdminSponsorshipActionBody {
    pub action: String,
    pub request_id: i64,
    pub sponsor_role: Option<String>,
    pub sponsor_verified: Option<bool>,
    pub placement: Option<String>,
    pub slot_index: Option<i32>,
    pub duration_days: Option<i32>,
    pub product_id: Option<String>,
    pub amount_usd_cents: Option<i32>,
    pub note: Option<String>,
}

pub async fn admin_sponsorship_request_action(
    req: HttpRequest,
    body: web::Json<AdminSponsorshipActionBody>,
    db: web::Data<Arc<Database>>,
) -> impl Responder {
    if let Err(resp) = validate_admin_token(&req) {
        return resp;
    }

    let body = body.into_inner();
    let action = body.action.trim().to_ascii_lowercase();
    let lang = get_language_from_request(&req);

    if action != "process" && action != "reject" {
        return HttpResponse::BadRequest()
            .json(ApiResponse::<()>::error("Invalid action".to_string()));
    }

    if action == "reject" {
        let ok = match db
            .reject_sponsorship_request(body.request_id, body.note.as_deref())
            .await
        {
            Ok(v) => v,
            Err(e) => {
                return HttpResponse::InternalServerError()
                    .json(ApiResponse::<()>::error(format!("Database error: {:?}", e)))
            }
        };
        if !ok {
            return HttpResponse::BadRequest().json(ApiResponse::<()>::error(
                if lang.starts_with("zh") {
                    "请求不存在或已处理".to_string()
                } else {
                    "Request not found or already processed".to_string()
                },
            ));
        }
        return HttpResponse::Ok().json(ApiResponse::success(OkPayload { ok: true }));
    }

    let request = match db.get_sponsorship_request_by_id(body.request_id).await {
        Ok(Some(v)) => v,
        Ok(None) => {
            return HttpResponse::NotFound().json(ApiResponse::<()>::error(
                "Sponsorship request not found".to_string(),
            ))
        }
        Err(e) => {
            return HttpResponse::InternalServerError()
                .json(ApiResponse::<()>::error(format!("Database error: {:?}", e)))
        }
    };

    if request.status != "pending" {
        return HttpResponse::BadRequest().json(ApiResponse::<()>::error(
            "Sponsorship request is not pending".to_string(),
        ));
    }

    let placement = body
        .placement
        .as_deref()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| request.placement.clone());
    let slot_index = body.slot_index.or(request.slot_index);
    let duration_days = body
        .duration_days
        .unwrap_or(request.duration_days)
        .clamp(1, 365);

    if placement != "home_top" && placement != "home_right" {
        return HttpResponse::BadRequest()
            .json(ApiResponse::<()>::error("Invalid placement".to_string()));
    }
    if placement == "home_top" {
        match slot_index {
            Some(0 | 1) => {}
            _ => {
                return HttpResponse::BadRequest().json(ApiResponse::<()>::error(
                    if lang.starts_with("zh") {
                        "顶部赞助位必须指定 slot_index=0(左) 或 1(右)".to_string()
                    } else {
                        "home_top requires slot_index 0 (left) or 1 (right)".to_string()
                    },
                ))
            }
        }
    }
    if placement == "home_right" {
        match slot_index {
            Some(0..=2) => {}
            _ => {
                return HttpResponse::BadRequest().json(ApiResponse::<()>::error(
                    if lang.starts_with("zh") {
                        "右侧赞助位必须指定 slot_index=0/1/2".to_string()
                    } else {
                        "home_right requires slot_index 0/1/2".to_string()
                    },
                ))
            }
        }
    }

    let product_id = if let Some(v) = body
        .product_id
        .as_deref()
        .map(|v| v.trim())
        .filter(|v| !v.is_empty())
    {
        v.to_string()
    } else {
        match db.resolve_product_id_by_ref(&request.product_ref).await {
            Ok(Some(id)) => id,
            Ok(None) => {
                return HttpResponse::BadRequest().json(ApiResponse::<()>::error(
                    if lang.starts_with("zh") {
                        "无法根据 product_ref 自动匹配产品，请手动填写 product_id".to_string()
                    } else {
                        "Cannot resolve product from product_ref. Please set product_id."
                            .to_string()
                    },
                ))
            }
            Err(e) => {
                return HttpResponse::InternalServerError()
                    .json(ApiResponse::<()>::error(format!("Database error: {:?}", e)))
            }
        }
    };

    let sponsor_role = body
        .sponsor_role
        .as_deref()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| "sponsor".to_string());
    let sponsor_verified = body.sponsor_verified.unwrap_or(true);

    if let Err(e) = db
        .upsert_developer_sponsor(&request.email, Some(&sponsor_role), sponsor_verified)
        .await
    {
        return HttpResponse::InternalServerError()
            .json(ApiResponse::<()>::error(format!("Database error: {:?}", e)));
    }

    let input = CreateSponsorshipGrantFromRequest {
        request_id: request.id,
        product_id,
        placement,
        slot_index,
        duration_days,
        amount_usd_cents: body.amount_usd_cents,
        starts_at: None,
    };

    match db.create_sponsorship_grant_from_request(input).await {
        Ok(grant) => HttpResponse::Ok().json(ApiResponse::success(grant)),
        Err(e) => HttpResponse::InternalServerError()
            .json(ApiResponse::<()>::error(format!("Database error: {:?}", e))),
    }
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct AdminSponsorshipGrantsQuery {
    pub placement: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

pub async fn admin_list_sponsorship_grants(
    req: HttpRequest,
    query: web::Query<AdminSponsorshipGrantsQuery>,
    db: web::Data<Arc<Database>>,
) -> impl Responder {
    if let Err(resp) = validate_admin_token(&req) {
        return resp;
    }

    let placement = query
        .placement
        .as_deref()
        .map(|v| v.trim())
        .filter(|v| !v.is_empty());
    let limit = query.limit.unwrap_or(200);
    let offset = query.offset.unwrap_or(0);

    match db.list_sponsorship_grants(placement, limit, offset).await {
        Ok(list) => HttpResponse::Ok().json(ApiResponse::success(list)),
        Err(e) => HttpResponse::InternalServerError()
            .json(ApiResponse::<()>::error(format!("Database error: {:?}", e))),
    }
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct AdminDeleteSponsorshipGrantQuery {
    pub id: i64,
}

pub async fn admin_delete_sponsorship_grant(
    req: HttpRequest,
    query: web::Query<AdminDeleteSponsorshipGrantQuery>,
    db: web::Data<Arc<Database>>,
) -> impl Responder {
    if let Err(resp) = validate_admin_token(&req) {
        return resp;
    }

    match db.delete_sponsorship_grant(query.id).await {
        Ok(ok) => HttpResponse::Ok().json(ApiResponse::success(OkPayload { ok })),
        Err(e) => HttpResponse::InternalServerError()
            .json(ApiResponse::<()>::error(format!("Database error: {:?}", e))),
    }
}

/**
 * get_pricing_plans
 * 前台：读取可用的定价方案（仅 active）。
 */
pub async fn get_pricing_plans(db: web::Data<Arc<Database>>) -> impl Responder {
    match db.list_pricing_plans(false).await {
        Ok(list) => HttpResponse::Ok().json(ApiResponse::success(list)),
        Err(e) => HttpResponse::InternalServerError()
            .json(ApiResponse::<()>::error(format!("Database error: {:?}", e))),
    }
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct AdminPricingPlansQuery {
    pub include_inactive: Option<bool>,
}

/**
 * admin_list_pricing_plans
 * 管理端：读取定价方案列表（可选包含 inactive）。
 */
pub async fn admin_list_pricing_plans(
    req: HttpRequest,
    query: web::Query<AdminPricingPlansQuery>,
    db: web::Data<Arc<Database>>,
) -> impl Responder {
    if let Err(resp) = validate_admin_token(&req) {
        return resp;
    }

    let include_inactive = query.include_inactive.unwrap_or(true);
    match db.list_pricing_plans(include_inactive).await {
        Ok(list) => HttpResponse::Ok().json(ApiResponse::success(list)),
        Err(e) => HttpResponse::InternalServerError()
            .json(ApiResponse::<()>::error(format!("Database error: {:?}", e))),
    }
}

/**
 * admin_upsert_pricing_plan
 * 管理端：创建或更新定价方案。
 */
pub async fn admin_upsert_pricing_plan(
    req: HttpRequest,
    body: web::Json<UpsertPricingPlanRequest>,
    db: web::Data<Arc<Database>>,
) -> impl Responder {
    if let Err(resp) = validate_admin_token(&req) {
        return resp;
    }

    match db.upsert_pricing_plan(body.into_inner()).await {
        Ok(plan) => HttpResponse::Ok().json(ApiResponse::success(plan)),
        Err(e) => HttpResponse::BadRequest()
            .json(ApiResponse::<()>::error(format!("Invalid input: {:?}", e))),
    }
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct AdminPricingPlanPath {
    pub id: String,
}

/**
 * admin_delete_pricing_plan
 * 管理端：删除定价方案。
 */
pub async fn admin_delete_pricing_plan(
    req: HttpRequest,
    path: web::Path<AdminPricingPlanPath>,
    db: web::Data<Arc<Database>>,
) -> impl Responder {
    if let Err(resp) = validate_admin_token(&req) {
        return resp;
    }

    let id = path.into_inner().id;
    match db.delete_pricing_plan(&id).await {
        Ok(ok) => HttpResponse::Ok().json(ApiResponse::success(OkPayload { ok })),
        Err(e) => HttpResponse::InternalServerError()
            .json(ApiResponse::<()>::error(format!("Database error: {:?}", e))),
    }
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct AdminSponsorshipOrdersQuery {
    pub status: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

/**
 * admin_list_sponsorship_orders
 * 管理端：查询支付订单（sponsorship_orders）。
 */
pub async fn admin_list_sponsorship_orders(
    req: HttpRequest,
    query: web::Query<AdminSponsorshipOrdersQuery>,
    db: web::Data<Arc<Database>>,
) -> impl Responder {
    if let Err(resp) = validate_admin_token(&req) {
        return resp;
    }

    let status = query
        .status
        .as_deref()
        .map(|v| v.trim())
        .filter(|v| !v.is_empty());
    let limit = query.limit.unwrap_or(200);
    let offset = query.offset.unwrap_or(0);

    match db.list_sponsorship_orders(status, limit, offset).await {
        Ok(list) => HttpResponse::Ok().json(ApiResponse::success(list)),
        Err(e) => HttpResponse::InternalServerError()
            .json(ApiResponse::<()>::error(format!("Database error: {:?}", e))),
    }
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct AdminPaymentsSummaryQuery {
    pub days: Option<i64>,
}

/**
 * admin_get_payments_summary
 * 管理端：支付汇总统计（默认近 30 天）。
 */
pub async fn admin_get_payments_summary(
    req: HttpRequest,
    query: web::Query<AdminPaymentsSummaryQuery>,
    db: web::Data<Arc<Database>>,
) -> impl Responder {
    if let Err(resp) = validate_admin_token(&req) {
        return resp;
    }

    let days = query.days.unwrap_or(30);
    match db.get_payments_summary(days).await {
        Ok(summary) => HttpResponse::Ok().json(ApiResponse::success(summary)),
        Err(e) => HttpResponse::InternalServerError()
            .json(ApiResponse::<()>::error(format!("Database error: {:?}", e))),
    }
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct AdminUpsertCategoriesRequest {
    pub categories: Vec<Category>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct AdminUpsertCategoriesResult {
    pub upserted: usize,
}

pub async fn admin_get_categories(
    req: HttpRequest,
    db: web::Data<Arc<Database>>,
) -> impl Responder {
    if let Err(resp) = validate_admin_token(&req) {
        return resp;
    }

    match db.get_categories().await {
        Ok(categories) => HttpResponse::Ok().json(ApiResponse::success(categories)),
        Err(e) => HttpResponse::InternalServerError()
            .json(ApiResponse::<()>::error(format!("Database error: {:?}", e))),
    }
}

pub async fn admin_upsert_categories(
    req: HttpRequest,
    body: web::Json<AdminUpsertCategoriesRequest>,
    db: web::Data<Arc<Database>>,
) -> impl Responder {
    if let Err(resp) = validate_admin_token(&req) {
        return resp;
    }

    match db.upsert_categories(body.into_inner().categories).await {
        Ok(upserted) => {
            HttpResponse::Ok().json(ApiResponse::success(AdminUpsertCategoriesResult {
                upserted,
            }))
        }
        Err(e) => HttpResponse::InternalServerError()
            .json(ApiResponse::<()>::error(format!("Database error: {:?}", e))),
    }
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct AdminCategoryPath {
    pub id: String,
}

pub async fn admin_delete_category(
    req: HttpRequest,
    path: web::Path<AdminCategoryPath>,
    db: web::Data<Arc<Database>>,
) -> impl Responder {
    if let Err(resp) = validate_admin_token(&req) {
        return resp;
    }

    let id = path.into_inner().id;
    match db.delete_category(&id).await {
        Ok(ok) => HttpResponse::Ok().json(ApiResponse::success(OkPayload { ok })),
        Err(e) => HttpResponse::InternalServerError()
            .json(ApiResponse::<()>::error(format!("Database error: {:?}", e))),
    }
}

#[derive(Debug, Serialize, ToSchema)]
pub struct AdminHomeModuleStatePayload {
    pub key: String,
    pub mode: Option<String>,
    pub day_key: Option<String>,
    pub remaining_ids: Vec<String>,
    pub today_ids: Vec<String>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct AdminHomeModuleUpdateRequest {
    pub mode: Option<String>,
    pub today_ids: Vec<String>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct AdminHomeModulePath {
    pub key: String,
}

pub async fn admin_get_home_module_state(
    req: HttpRequest,
    path: web::Path<AdminHomeModulePath>,
    db: web::Data<Arc<Database>>,
) -> impl Responder {
    if let Err(resp) = validate_admin_token(&req) {
        return resp;
    }

    let key = path.into_inner().key;
    match db.get_home_module_state(&key).await {
        Ok(Some(state)) => {
            HttpResponse::Ok().json(ApiResponse::success(AdminHomeModuleStatePayload {
                key: state.key,
                mode: state.mode,
                day_key: state.day_key.map(|d| d.to_string()),
                remaining_ids: state.remaining_ids,
                today_ids: state.today_ids,
            }))
        }
        Ok(None) => HttpResponse::Ok().json(ApiResponse::success(AdminHomeModuleStatePayload {
            key,
            mode: None,
            day_key: None,
            remaining_ids: Vec::new(),
            today_ids: Vec::new(),
        })),
        Err(e) => HttpResponse::InternalServerError()
            .json(ApiResponse::<()>::error(format!("Database error: {:?}", e))),
    }
}

pub async fn admin_put_home_module_state(
    req: HttpRequest,
    path: web::Path<AdminHomeModulePath>,
    body: web::Json<AdminHomeModuleUpdateRequest>,
    db: web::Data<Arc<Database>>,
) -> impl Responder {
    if let Err(resp) = validate_admin_token(&req) {
        return resp;
    }

    let key = path.into_inner().key;
    let body = body.into_inner();
    let mode = body.mode.unwrap_or_else(|| "manual".to_string());

    let state = crate::db::HomeModuleState {
        key: key.clone(),
        mode: Some(mode),
        day_key: None,
        remaining_ids: Vec::new(),
        today_ids: body.today_ids,
    };

    match db.upsert_home_module_state(state).await {
        Ok(()) => HttpResponse::Ok().json(ApiResponse::success(OkPayload { ok: true })),
        Err(e) => HttpResponse::InternalServerError()
            .json(ApiResponse::<()>::error(format!("Database error: {:?}", e))),
    }
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
            description: "A lightweight prompt/snippet manager for solo developers. Organize your best prompts, reusable snippets, and templates in one place, with fast search and tags. Keep your workflow consistent across projects and reduce context-switching when you’re shipping features every day. Built for makers who value speed, clarity, and focus.".to_string(),
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
            description: "Generate invoices and track payments in minutes. Create branded invoice templates, set due dates, and send reminders without leaving your dashboard. Track paid/unpaid status, export reports for bookkeeping, and keep client details organized. Perfect for solo founders who want simple, reliable invoicing without complex accounting software.".to_string(),
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
            description: "面向独立创作者的写作与发布工作流工具。支持选题管理、素材收集、Markdown 写作、模板复用与一键发布。你可以把灵感、草稿、引用、链接都整理在一个空间里，减少来回切换工具的时间。适合长期输出内容、希望提升稳定产出的个人与小团队。".to_string(),
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
            description: "Create and export design tokens for your UI in seconds. Define colors, spacing, typography, and component scales, then export to CSS variables, Tailwind config, or JSON for design systems. Keep designers and developers aligned with a single source of truth, and ship consistent UI faster across web and mobile projects.".to_string(),
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
            description: "A starter kit for launching fast with SEO-ready pages. Includes a landing page, waitlist form, email capture, and analytics-friendly structure. Customize sections, add screenshots, and publish in minutes. Built with best-practice metadata and performance defaults, so your product looks great and ranks well from day one.".to_string(),
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
            description: "A minimal focus timer with sessions, stats, and shortcuts. Run Pomodoro or custom intervals, track streaks, and review weekly focus summaries. Keyboard-first controls keep you in flow, while gentle notifications help you break at the right time. Designed for deep work, not distraction—simple UI, clear metrics, and zero bloat.".to_string(),
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
            description: "面向团队的 API 健康度监控与告警工具。支持定时探测、响应时间统计、SLA 报表、错误率趋势与多渠道告警（邮件/钉钉/Slack）。你可以按环境与服务拆分监控项，设置阈值与静默规则，并在仪表盘中快速定位异常。适用于微服务与对外开放 API 的长期运维。".to_string(),
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
            description: "A writing tool with publishing pipelines and analytics. Draft posts in Markdown, manage an editorial calendar, and publish to multiple platforms with one workflow. Track views, conversions, and audience growth over time, then iterate with insights. Ideal for creators who want a clean writing experience plus practical distribution and performance tracking.".to_string(),
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
            description: "Curated icons, components, and templates to ship faster. Browse a growing library of consistent icon sets and ready-to-use UI building blocks for dashboards, landing pages, and SaaS apps. Download as SVG/React components, customize colors and stroke width, and keep your product UI polished without starting from scratch every time.".to_string(),
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
            description: "Track income, expenses, and subscriptions in one place. Connect accounts or import CSV, categorize transactions, and spot trends quickly. Set budgets, monitor recurring charges, and get alerts when spending spikes. Built for creators and freelancers who want clarity and control over cash flow, without complex spreadsheets or confusing dashboards.".to_string(),
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
                    rejection_reason: None,
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
