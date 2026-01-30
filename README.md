# SoloForge

English | [中文](README.zh-CN.md)

SoloForge is a bilingual platform that showcases products built by solo makers worldwide. It includes a public site, an admin dashboard, and a Rust backend API.

## Highlights

- Curated product discovery and search for indie makers
- Bilingual UI (English / 中文)
- Separate public site and admin console
- Unified backend API backed by Supabase (PostgreSQL)

## Tech Stack

- Frontend: Next.js 16 + TypeScript + Tailwind CSS + next-intl
- Admin: Next.js 16 + TypeScript + Tailwind CSS
- Backend: Rust + Actix Web + Supabase (PostgreSQL)

## Quick Start

Please follow the setup guide first:

- [SETUP.md](SETUP.md)

Then start the services:

- Frontend: `npm --prefix frontend run dev`
- Admin: `npm --prefix admin-frontend run dev -- -p 3002`
- Backend: `cargo run` (from the backend directory)

## Configuration

Key environment variables are described in each app’s `.env` template and deployment docs.

## Project Structure

- `frontend/` public site
- `admin-frontend/` admin console
- `backend/` Rust API service
- `docs/` project docs and assets

## License

MIT License. See [LICENSE](LICENSE).
