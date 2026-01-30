import { NextRequest } from 'next/server';

function normalizeApiBaseUrl(raw: string): string | null {
  const trimmed = (raw || '').trim();
  if (!trimmed) return null;
  const normalized = trimmed.replace(/\/+$/, '');
  if (!normalized) return null;
  if (normalized.endsWith('/api')) return normalized;
  return `${normalized}/api`;
}

export function getDirectBackendApiUrl(request: NextRequest): string | null {
  const host = (request.headers.get('host') || '').toLowerCase();
  if (!host) return null;
  if (host.includes('localhost') || host.includes('127.0.0.1')) return null;
  const raw = (process.env.DIRECT_BACKEND_API_URL || '').trim();
  return normalizeApiBaseUrl(raw);
}
