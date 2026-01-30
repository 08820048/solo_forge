# SoloForge

[English](README.md) | 中文

SoloForge 是一个面向全球独立开发者的双语产品收录与展示平台，包含前台站点、管理后台与 Rust 后端 API。

## 亮点

- 独立开发者产品展示与搜索
- 双语界面（English / 中文）
- 前台站点与管理后台分离
- 统一后端 API，基于 Supabase（PostgreSQL）

## 技术栈

- 前端：Next.js 16 + TypeScript + Tailwind CSS + next-intl
- 管理后台：Next.js 16 + TypeScript + Tailwind CSS
- 后端：Rust + Actix Web + Supabase (PostgreSQL)

## 快速开始

请先阅读并按顺序完成：

- [SETUP.md](SETUP.md)

完成后即可启动：

- 前台：`npm --prefix frontend run dev`
- 管理后台：`npm --prefix admin-frontend run dev -- -p 3002`
- 后端：`cargo run`（在 backend 目录中）

## 配置说明

前台与管理后台的关键环境变量详见各自 `.env` 模板与部署文档。

## 目录结构

- `frontend/` 前台站点
- `admin-frontend/` 管理后台
- `backend/` 后端服务
- `docs/` 项目文档与素材

## 许可证

MIT License，详见 [LICENSE](LICENSE)。
