use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
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
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    #[serde(default)]
    pub likes: i64,
    #[serde(default)]
    pub favorites: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "lowercase")]
pub enum ProductStatus {
    Pending,
    Approved,
    Rejected,
}

#[derive(Debug, Serialize, Deserialize)]
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

#[derive(Debug, Serialize, Deserialize)]
pub struct UpdateProductRequest {
    pub name: Option<String>,
    pub slogan: Option<String>,
    pub description: Option<String>,
    pub website: Option<String>,
    pub logo_url: Option<String>,
    pub category: Option<String>,
    pub tags: Option<Vec<String>>,
    pub status: Option<ProductStatus>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Category {
    pub id: String,
    pub name_en: String,
    pub name_zh: String,
    pub icon: String,
    pub color: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CategoryWithCount {
    pub id: String,
    pub name_en: String,
    pub name_zh: String,
    pub icon: String,
    pub color: String,
    pub product_count: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Developer {
    pub email: String,
    pub name: String,
    pub avatar_url: Option<String>,
    pub website: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DeveloperWithFollowers {
    pub email: String,
    pub name: String,
    pub avatar_url: Option<String>,
    pub website: Option<String>,
    pub followers: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DeveloperPopularity {
    pub email: String,
    pub name: String,
    pub avatar_url: Option<String>,
    pub website: Option<String>,
    pub likes: i64,
    pub favorites: i64,
    pub score: i64,
}

#[derive(Debug, Serialize)]
pub struct ApiResponse<T> {
    pub success: bool,
    pub data: Option<T>,
    pub message: Option<String>,
}

impl<T> ApiResponse<T> {
    pub fn success(data: T) -> Self {
        Self {
            success: true,
            data: Some(data),
            message: None,
        }
    }

    pub fn error(message: String) -> Self {
        Self {
            success: false,
            data: None,
            message: Some(message),
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct QueryParams {
    pub category: Option<String>,
    pub tags: Option<String>,
    pub language: Option<String>,
    pub status: Option<String>,
    pub search: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}
