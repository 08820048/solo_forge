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
use std::time::Duration;
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
    let db_for_newsletter = db.clone();
    tokio::spawn(async move {
        loop {
            let enabled = !matches!(
                env::var("NEWSLETTER_ENABLED").ok().as_deref(),
                Some("0") | Some("false") | Some("FALSE")
            );
            if enabled {
                match db_for_newsletter.send_weekly_newsletter_if_due().await {
                    Ok(sent) if sent > 0 => {
                        log::info!("Newsletter sent count={}", sent);
                    }
                    Ok(_) => {}
                    Err(e) => log::warn!("Newsletter task failed err={:?}", e),
                }
            }
            tokio::time::sleep(Duration::from_secs(60)).await;
        }
    });

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
                            .route(
                                "/popularity-last-week",
                                web::get().to(handlers::get_developer_popularity_last_week),
                            )
                            .route(
                                "/{email}/center-stats",
                                web::get().to(handlers::get_developer_center_stats),
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
                        web::scope("/newsletter")
                            .route("/subscribe", web::post().to(handlers::subscribe_newsletter))
                            .route("/preview", web::get().to(handlers::preview_newsletter))
                            .route(
                                "/unsubscribe",
                                web::get().to(handlers::unsubscribe_newsletter),
                            ),
                    )
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
                        web::scope("/pricing-plans")
                            .route("", web::get().to(handlers::get_pricing_plans)),
                    )
                    .service(
                        web::scope("/sponsorship")
                            .route(
                                "/requests",
                                web::post().to(handlers::create_sponsorship_request),
                            )
                            .route(
                                "/checkout",
                                web::post().to(handlers::create_creem_sponsorship_checkout),
                            ),
                    )
                    .service(
                        web::scope("/creem")
                            .route("/webhook", web::post().to(handlers::creem_webhook)),
                    )
                    .service(
                        web::scope("/dev")
                            .route("/bootstrap", web::post().to(handlers::dev_bootstrap))
                            .route("/seed", web::post().to(handlers::dev_seed)),
                    )
                    .service(
                        web::scope("/admin")
                            .route("/categories", web::get().to(handlers::admin_get_categories))
                            .route(
                                "/categories",
                                web::post().to(handlers::admin_upsert_categories),
                            )
                            .route(
                                "/review-product",
                                web::get().to(handlers::admin_review_product),
                            )
                            .route(
                                "/categories/{id}",
                                web::delete().to(handlers::admin_delete_category),
                            )
                            .route(
                                "/sponsorship/requests",
                                web::get().to(handlers::admin_list_sponsorship_requests),
                            )
                            .route(
                                "/sponsorship/requests/action",
                                web::post().to(handlers::admin_sponsorship_request_action),
                            )
                            .route(
                                "/sponsorship/grants",
                                web::get().to(handlers::admin_list_sponsorship_grants),
                            )
                            .route(
                                "/sponsorship/grants",
                                web::delete().to(handlers::admin_delete_sponsorship_grant),
                            )
                            .route(
                                "/pricing-plans",
                                web::get().to(handlers::admin_list_pricing_plans),
                            )
                            .route(
                                "/pricing-plans",
                                web::post().to(handlers::admin_upsert_pricing_plan),
                            )
                            .route(
                                "/pricing-plans/{id}",
                                web::delete().to(handlers::admin_delete_pricing_plan),
                            )
                            .route(
                                "/payments/orders",
                                web::get().to(handlers::admin_list_sponsorship_orders),
                            )
                            .route(
                                "/payments/orders/action",
                                web::post().to(handlers::admin_sponsorship_order_action),
                            )
                            .route(
                                "/payments/summary",
                                web::get().to(handlers::admin_get_payments_summary),
                            )
                            .route(
                                "/home-modules/{key}",
                                web::get().to(handlers::admin_get_home_module_state),
                            )
                            .route(
                                "/home-modules/{key}",
                                web::put().to(handlers::admin_put_home_module_state),
                            ),
                    ),
            )
    })
    .bind(&bind_address)?
    .run()
    .await
}
