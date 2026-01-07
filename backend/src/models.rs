use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};

#[derive(Debug, Serialize, Deserialize, Clone, ToSchema)]
pub struct Product {
    pub id: String,
    pub name: String,
    pub slogan: String,
    pub description: String,
    pub website: String,
    pub logo_url: Option<String>,
    pub category: String,
    pub tags: Vec<String>,
    pub maker_name: String,
    pub maker_email: String,
    pub maker_website: Option<String>,
    pub language: String,
    pub status: ProductStatus,
    #[serde(default)]
    pub rejection_reason: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    #[serde(default)]
    pub likes: i64,
    #[serde(default)]
    pub favorites: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum ProductStatus {
    Pending,
    Approved,
    Rejected,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct CreateProductRequest {
    pub name: String,
    pub slogan: String,
    pub description: String,
    pub website: String,
    pub logo_url: Option<String>,
    pub category: String,
    pub tags: Vec<String>,
    pub maker_name: String,
    pub maker_email: String,
    pub maker_website: Option<String>,
    pub language: String,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct UpdateProductRequest {
    pub name: Option<String>,
    pub slogan: Option<String>,
    pub description: Option<String>,
    pub website: Option<String>,
    pub logo_url: Option<String>,
    pub category: Option<String>,
    pub tags: Option<Vec<String>>,
    pub status: Option<ProductStatus>,
    pub rejection_reason: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct NewsletterSubscribeRequest {
    pub email: String,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct Category {
    pub id: String,
    pub name_en: String,
    pub name_zh: String,
    pub icon: String,
    pub color: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, ToSchema)]
pub struct CategoryWithCount {
    pub id: String,
    pub name_en: String,
    pub name_zh: String,
    pub icon: String,
    pub color: String,
    pub product_count: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone, ToSchema)]
pub struct Developer {
    pub email: String,
    pub name: String,
    pub avatar_url: Option<String>,
    pub website: Option<String>,
    pub sponsor_role: Option<String>,
    pub sponsor_verified: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone, ToSchema)]
pub struct DeveloperWithFollowers {
    pub email: String,
    pub name: String,
    pub avatar_url: Option<String>,
    pub website: Option<String>,
    pub sponsor_role: Option<String>,
    pub sponsor_verified: bool,
    pub followers: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone, ToSchema)]
pub struct DeveloperPopularity {
    pub email: String,
    pub name: String,
    pub avatar_url: Option<String>,
    pub website: Option<String>,
    pub sponsor_role: Option<String>,
    pub sponsor_verified: bool,
    pub likes: i64,
    pub favorites: i64,
    pub score: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone, ToSchema)]
pub struct SponsorshipRequest {
    pub id: i64,
    pub email: String,
    pub product_ref: String,
    pub placement: String,
    pub slot_index: Option<i32>,
    pub duration_days: i32,
    pub note: Option<String>,
    pub status: String,
    pub processed_grant_id: Option<i64>,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Serialize, Deserialize, Clone, ToSchema)]
pub struct CreateSponsorshipRequest {
    pub email: String,
    pub product_ref: String,
    pub placement: String,
    pub slot_index: Option<i32>,
    pub duration_days: i32,
    pub note: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, ToSchema)]
pub struct SponsorshipGrant {
    pub id: i64,
    pub product_id: String,
    pub placement: String,
    pub slot_index: Option<i32>,
    pub starts_at: chrono::DateTime<chrono::Utc>,
    pub ends_at: chrono::DateTime<chrono::Utc>,
    pub source: String,
    pub amount_usd_cents: Option<i32>,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Serialize, Deserialize, Clone, ToSchema)]
pub struct CreateSponsorshipGrantFromRequest {
    pub request_id: i64,
    pub product_id: String,
    pub placement: String,
    pub slot_index: Option<i32>,
    pub duration_days: i32,
    pub amount_usd_cents: Option<i32>,
    pub starts_at: Option<chrono::DateTime<chrono::Utc>>,
}

#[derive(Debug, Serialize, Deserialize, Clone, ToSchema)]
pub struct DeveloperCenterStats {
    pub followers: i64,
    pub total_likes: i64,
    pub total_favorites: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone, ToSchema)]
pub struct ApiError {
    pub code: String,
    pub trace_id: String,
    pub degraded: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hint: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ApiResponse<T> {
    pub success: bool,
    pub data: Option<T>,
    pub message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<ApiError>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct EmptyApiResponse {
    pub success: bool,
    pub data: Option<()>,
    pub message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<ApiError>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ProductApiResponse {
    pub success: bool,
    pub data: Option<Product>,
    pub message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<ApiError>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ProductsApiResponse {
    pub success: bool,
    pub data: Option<Vec<Product>>,
    pub message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<ApiError>,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct SearchResult {
    pub products: Vec<Product>,
    pub developers: Vec<Developer>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct SearchApiResponse {
    pub success: bool,
    pub data: Option<SearchResult>,
    pub message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<ApiError>,
}

impl<T> ApiResponse<T> {
    pub fn success(data: T) -> Self {
        Self {
            success: true,
            data: Some(data),
            message: None,
            error: None,
        }
    }

    pub fn error(message: String) -> Self {
        Self {
            success: false,
            data: None,
            message: Some(message),
            error: None,
        }
    }
}

#[derive(Debug, Deserialize, IntoParams, ToSchema)]
pub struct QueryParams {
    pub category: Option<String>,
    pub tags: Option<String>,
    pub language: Option<String>,
    pub status: Option<String>,
    pub search: Option<String>,
    pub sort: Option<String>,
    pub dir: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}
