mod db;
mod handlers;
mod i18n;
mod models;

use crate::db::Database;

use actix_cors::Cors;
use actix_web::{middleware::Logger, web, App, HttpServer};
use dotenv::dotenv;
use std::env;
use std::sync::Arc;
use utoipa::OpenApi;
use utoipa_swagger_ui::SwaggerUi;

#[derive(OpenApi)]
#[openapi(
    paths(
        handlers::health_check,
        handlers::get_products,
        handlers::search,
        handlers::get_product_by_id,
        handlers::create_product
    ),
    components(schemas(
        models::ApiError,
        models::EmptyApiResponse,
        models::Product,
        models::ProductApiResponse,
        models::ProductsApiResponse,
        models::ProductStatus,
        models::CreateProductRequest,
        models::UpdateProductRequest,
        models::QueryParams,
        models::SearchApiResponse,
        models::SearchResult,
        handlers::HealthCheckResponse,
        handlers::SearchQuery
    ))
)]
struct ApiDoc;

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    let manifest_dir = env!("CARGO_MANIFEST_DIR");
    dotenv::from_filename(format!("{}/.env.local", manifest_dir)).ok();
    dotenv::from_filename(format!("{}/.env", manifest_dir)).ok();
    dotenv::from_filename(".env.local").ok();
    dotenv().ok();
    env_logger::init_from_env(env_logger::Env::new().default_filter_or("info"));

    let host = env::var("HOST").unwrap_or_else(|_| "127.0.0.1".to_string());
    let port = env::var("PORT").unwrap_or_else(|_| "8080".to_string());
    let bind_address = format!("{}:{}", host, port);

    log::info!("Starting SoloForge API server at http://{}", bind_address);

    let db = Arc::new(Database::new());

    HttpServer::new(move || {
        let cors = Cors::default()
            .allow_any_origin()
            .allow_any_method()
            .allow_any_header()
            .max_age(3600);

        App::new()
            .app_data(web::Data::new(db.clone()))
            .wrap(Logger::default())
            .wrap(cors)
            .service(SwaggerUi::new("/api/docs/{_:.*}").url("/api/openapi.json", ApiDoc::openapi()))
            .service(
                web::scope("/api")
                    .service(handlers::health_check)
                    .service(
                        web::scope("/products")
                            .route("", web::get().to(handlers::get_products))
                            .route("", web::post().to(handlers::create_product))
                            .route("/favorites", web::get().to(handlers::get_favorite_products))
                            .route("/{id}", web::get().to(handlers::get_product_by_id))
                            .route("/{id}", web::put().to(handlers::update_product))
                            .route("/{id}", web::delete().to(handlers::delete_product))
                            .route("/{id}/like", web::post().to(handlers::like_product))
                            .route("/{id}/unlike", web::post().to(handlers::unlike_product))
                            .route("/{id}/favorite", web::post().to(handlers::favorite_product))
                            .route(
                                "/{id}/unfavorite",
                                web::post().to(handlers::unfavorite_product),
                            ),
                    )
                    .service(
                        web::scope("/developers")
                            .route("/top", web::get().to(handlers::get_top_developers))
                            .route("/recent", web::get().to(handlers::get_recent_developers))
                            .route(
                                "/popularity-last-month",
                                web::get().to(handlers::get_developer_popularity_last_month),
                            )
                            .route("/{email}", web::get().to(handlers::get_developer_by_email))
                            .route(
                                "/{email}",
                                web::put().to(handlers::update_developer_profile),
                            )
                            .route(
                                "/{email}/follow",
                                web::post().to(handlers::follow_developer),
                            )
                            .route(
                                "/{email}/unfollow",
                                web::post().to(handlers::unfollow_developer),
                            ),
                    )
                    .service(
                        web::scope("/categories")
                            .route("", web::get().to(handlers::get_categories))
                            .route("/top", web::get().to(handlers::get_top_categories)),
                    )
                    .service(
                        web::scope("/leaderboard")
                            .route("", web::get().to(handlers::get_leaderboard)),
                    )
                    .service(web::scope("/search").route("", web::get().to(handlers::search)))
                    .service(
                        web::scope("/home")
                            .route(
                                "/sponsored-top",
                                web::get().to(handlers::get_home_sponsored_top),
                            )
                            .route(
                                "/sponsored-right",
                                web::get().to(handlers::get_home_sponsored_right),
                            )
                            .route("/featured", web::get().to(handlers::get_home_featured)),
                    )
                    .service(
                        web::scope("/dev")
                            .route("/bootstrap", web::post().to(handlers::dev_bootstrap))
                            .route("/seed", web::post().to(handlers::dev_seed)),
                    ),
            )
    })
    .bind(&bind_address)?
    .run()
    .await
}
