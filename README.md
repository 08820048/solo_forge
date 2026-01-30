# SoloForge

SoloForge 是一个面向全球独立开发者的产品收录与展示平台，支持中英双语、多端（前台与管理后台）以及后端 API 服务。

## 主要特性

- 独立开发者产品展示与搜索
- 双语支持（中文 / 英文）
- 前台站点与管理后台分离
- 统一后端 API 与数据库（Supabase）

## 技术栈

- 前端：Next.js 16 + TypeScript + Tailwind CSS + next-intl
- 管理后台：Next.js 16 + TypeScript + Tailwind CSS
- 后端：Rust + Actix Web + Supabase (PostgreSQL)

## 快速开始

请先阅读并按顺序完成：

- [SETUP.md](file:///Users/xuyi/Desktop/SoloForges/SETUP.md)

完成后即可启动：

- 前台：`npm --prefix frontend run dev`
- 管理后台：`npm --prefix admin-frontend run dev -- -p 3002`
- 后端：`cargo run`（在 backend 目录中）

## 配置说明

前端与管理后台的关键环境变量详见各自的 `.env` 或部署文档。

## 目录结构

- `frontend/` 前台站点
- `admin-frontend/` 管理后台
- `backend/` 后端服务
- `docs/` 项目文档与素材

## 许可证

本项目采用 MIT 许可证，详见 [LICENSE](file:///Users/xuyi/Desktop/SoloForges/LICENSE)。
