import { NextResponse, type NextRequest } from 'next/server';
import { requireAdmin } from '../_auth';

const BACKEND_API_URL = process.env.BACKEND_API_URL || 'http://localhost:8080/api';

type ApiResponse<T> = { success: boolean; data?: T; message?: string };

type ProductStatus = 'pending' | 'approved' | 'rejected';

type Product = {
  id: string;
  name: string;
  category: string;
  language: string;
  status: ProductStatus;
  likes?: number;
  favorites?: number;
};

type AdminStats = {
  totals: {
    products: number;
    pending: number;
    approved: number;
    rejected: number;
  };
  byLanguage: Array<{ language: string; count: number }>;
  byCategory: Array<{ category: string; count: number }>;
  topProductsByLikes: Array<{ id: string; name: string; likes: number }>;
  topProductsByFavorites: Array<{ id: string; name: string; favorites: number }>;
};

async function readJsonSafe<T>(response: Response): Promise<T | null> {
  const text = await response.text();
  if (!text.trim()) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function addCount(map: Map<string, number>, key: string) {
  const k = (key || 'unknown').trim() || 'unknown';
  map.set(k, (map.get(k) ?? 0) + 1);
}

function sortCountEntries(map: Map<string, number>) {
  return Array.from(map.entries())
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);

    const limit = 2000;
    const params = new URLSearchParams();
    params.set('limit', String(limit));
    params.set('offset', '0');

    const response = await fetch(`${BACKEND_API_URL}/products?${params.toString()}`, {
      headers: { 'Accept-Language': request.headers.get('Accept-Language') || 'zh' },
      cache: 'no-store',
    });
    const json = await readJsonSafe<ApiResponse<Product[]>>(response);
    if (!response.ok || !json?.success) {
      return NextResponse.json<ApiResponse<null>>(
        { success: false, message: json?.message || 'Failed to fetch products' },
        { status: response.status || 502 }
      );
    }

    const list = json.data ?? [];
    const totals = { products: list.length, pending: 0, approved: 0, rejected: 0 };
    const byLanguage = new Map<string, number>();
    const byCategory = new Map<string, number>();

    const likesTop: Array<{ id: string; name: string; likes: number }> = [];
    const favTop: Array<{ id: string; name: string; favorites: number }> = [];

    for (const p of list) {
      if (p.status === 'approved') totals.approved += 1;
      else if (p.status === 'rejected') totals.rejected += 1;
      else totals.pending += 1;

      addCount(byLanguage, p.language);
      addCount(byCategory, p.category);

      likesTop.push({ id: p.id, name: p.name, likes: Number(p.likes ?? 0) });
      favTop.push({ id: p.id, name: p.name, favorites: Number(p.favorites ?? 0) });
    }

    likesTop.sort((a, b) => b.likes - a.likes);
    favTop.sort((a, b) => b.favorites - a.favorites);

    const data: AdminStats = {
      totals,
      byLanguage: sortCountEntries(byLanguage).map((r) => ({ language: r.key, count: r.count })),
      byCategory: sortCountEntries(byCategory).map((r) => ({ category: r.key, count: r.count })),
      topProductsByLikes: likesTop.slice(0, 20),
      topProductsByFavorites: favTop.slice(0, 20),
    };

    return NextResponse.json<ApiResponse<AdminStats>>({ success: true, data });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unauthorized';
    const status = message === 'Forbidden' ? 403 : 401;
    return NextResponse.json<ApiResponse<null>>({ success: false, message }, { status });
  }
}

