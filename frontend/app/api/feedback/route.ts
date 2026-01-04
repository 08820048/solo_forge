import { NextResponse } from 'next/server';

type ApiResponse<T> = { success: boolean; data?: T; message?: string };

type FeedbackIssue = {
  id: number;
  number: number;
  title: string;
  body: string;
  state: 'open' | 'closed';
  labels: string[];
  createdAt: string;
  updatedAt: string;
  comments: number;
  url: string;
  author?: string | null;
};

type GitHubLabel = string | { name?: string };

/**
 * isRecord
 * 判断 unknown 是否为普通对象。
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * getFeedbackRepo
 * 获取用于承载反馈的 GitHub 仓库（形如 owner/repo）。
 */
function getFeedbackRepo() {
  const repo = (process.env.GITHUB_FEEDBACK_REPO || process.env.NEXT_PUBLIC_GITHUB_FEEDBACK_REPO || '').trim();
  return repo || null;
}

/**
 * githubRequest
 * 发起 GitHub API 请求，自动处理鉴权与常用头部。
 */
async function githubRequest(url: string, init?: RequestInit) {
  const token = (process.env.GITHUB_FEEDBACK_TOKEN || '').trim();
  const headers = new Headers(init?.headers);
  headers.set('Accept', 'application/vnd.github+json');
  headers.set('X-GitHub-Api-Version', '2022-11-28');
  if (token) headers.set('Authorization', `Bearer ${token}`);

  return fetch(url, { ...init, headers, cache: 'no-store' });
}

function uniq(values: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const s = v.trim();
    if (!s) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

type GitHubLabelItem = { name?: string };

async function listRepoLabels(owner: string, repo: string) {
  const all: string[] = [];
  for (let page = 1; page <= 5; page += 1) {
    const url = new URL(`https://api.github.com/repos/${owner}/${repo}/labels`);
    url.searchParams.set('per_page', '100');
    url.searchParams.set('page', String(page));
    const res = await githubRequest(url.toString());
    if (!res.ok) break;
    const json = (await res.json().catch(() => null)) as unknown;
    if (!Array.isArray(json)) break;
    const names = (json as GitHubLabelItem[]).map((l) => String(l?.name || '').trim()).filter(Boolean);
    all.push(...names);
    if (names.length < 100) break;
  }
  return uniq(all);
}

async function createRepoLabel(owner: string, repo: string, name: string, color: string) {
  const endpoint = `https://api.github.com/repos/${owner}/${repo}/labels`;
  return githubRequest(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, color }),
  });
}

function getLabelColor(name: string) {
  const n = name.toLowerCase();
  if (n === 'feedback') return '0ea5e9';
  if (n.startsWith('type:')) return 'a855f7';
  if (n.startsWith('status:')) return 'f59e0b';
  return '94a3b8';
}

async function ensureRepoLabels(owner: string, repo: string, labels: string[]) {
  const existing = new Set((await listRepoLabels(owner, repo)).map((l) => l.toLowerCase()));
  const missing = uniq(labels).filter((l) => !existing.has(l.toLowerCase()));
  for (const name of missing) {
    const res = await createRepoLabel(owner, repo, name, getLabelColor(name));
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const lowered = text.toLowerCase();
      const alreadyExists =
        res.status === 422 && (lowered.includes('already exists') || lowered.includes('name already exists'));
      if (!alreadyExists) {
        throw new Error(`Create label failed (${res.status}): ${text || res.statusText}`);
      }
    }
  }
}

/**
 * buildSearchQuery
 * 将筛选条件组装为 GitHub Search API 的查询字符串。
 */
function buildSearchQuery({
  repo,
  q,
  status,
  type,
}: {
  repo: string;
  q: string | null;
  status: string | null;
  type: string | null;
}) {
  const parts: string[] = [`repo:${repo}`, 'is:issue'];
  if (q) parts.push(`${q} in:title,body`);
  if (status && status !== 'all') {
    if (status === 'open') parts.push('is:open');
    else if (status === 'closed') parts.push('is:closed');
    else parts.push(`label:"status:${status}"`);
  }
  if (type && type !== 'all') {
    parts.push(`label:"type:${type}"`);
  }
  return parts.join(' ');
}

/**
 * mapSearchItemToIssue
 * 将 GitHub Search API 的 item 映射为前端更好用的结构。
 */
function mapSearchItemToIssue(item: unknown): FeedbackIssue {
  const obj = isRecord(item) ? item : {};
  const user = isRecord(obj.user) ? obj.user : null;
  const labelsRaw = obj.labels;
  const labels = Array.isArray(labelsRaw)
    ? (labelsRaw as GitHubLabel[])
        .map((l) => (typeof l === 'string' ? l : (l.name || '').trim()))
        .filter((v) => typeof v === 'string' && v.trim())
    : [];
  return {
    id: Number(obj.id || 0),
    number: Number(obj.number || 0),
    title: String(obj.title || ''),
    body: String(obj.body || ''),
    state: obj.state === 'closed' ? 'closed' : 'open',
    labels,
    createdAt: String(obj.created_at || ''),
    updatedAt: String(obj.updated_at || ''),
    comments: Number(obj.comments || 0),
    url: String(obj.html_url || ''),
    author: user?.login ? String(user.login) : null,
  };
}

/**
 * buildIssueBody
 * 生成用于创建 Issue 的 Markdown 文本，便于后续处理和归档。
 */
function buildIssueBody(payload: {
  type: string;
  description: string;
  steps?: string | null;
  expected?: string | null;
  actual?: string | null;
  contact?: string | null;
  url?: string | null;
}) {
  const lines: string[] = [];
  lines.push(`**Type**: ${payload.type}`);
  lines.push('');
  lines.push('## 描述');
  lines.push(payload.description.trim());
  lines.push('');
  if (payload.steps && payload.steps.trim()) {
    lines.push('## 复现步骤');
    lines.push(payload.steps.trim());
    lines.push('');
  }
  if (payload.expected && payload.expected.trim()) {
    lines.push('## 期望结果');
    lines.push(payload.expected.trim());
    lines.push('');
  }
  if (payload.actual && payload.actual.trim()) {
    lines.push('## 实际结果');
    lines.push(payload.actual.trim());
    lines.push('');
  }
  if (payload.url && payload.url.trim()) {
    lines.push('## 页面');
    lines.push(payload.url.trim());
    lines.push('');
  }
  if (payload.contact && payload.contact.trim()) {
    lines.push('## 联系方式（可选）');
    lines.push(payload.contact.trim());
    lines.push('');
  }
  return lines.join('\n');
}

export async function GET(request: Request) {
  const repo = getFeedbackRepo();
  if (!repo) {
    return NextResponse.json<ApiResponse<null>>(
      { success: false, message: 'Missing NEXT_PUBLIC_GITHUB_FEEDBACK_REPO or GITHUB_FEEDBACK_REPO' },
      { status: 500 }
    );
  }

  const { searchParams } = new URL(request.url);
  const q = (searchParams.get('q') || '').trim() || null;
  const status = (searchParams.get('status') || '').trim() || null;
  const type = (searchParams.get('type') || '').trim() || null;
  const page = Number(searchParams.get('page') || '1') || 1;

  const query = buildSearchQuery({ repo, q, status, type });
  const url = new URL('https://api.github.com/search/issues');
  url.searchParams.set('q', query);
  url.searchParams.set('sort', 'updated');
  url.searchParams.set('order', 'desc');
  url.searchParams.set('per_page', '30');
  url.searchParams.set('page', String(Math.max(1, Math.min(10, page))));

  const response = await githubRequest(url.toString());
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    return NextResponse.json<ApiResponse<null>>(
      { success: false, message: `GitHub request failed (${response.status}): ${text || response.statusText}` },
      { status: 502 }
    );
  }

  const json = (await response.json().catch(() => null)) as unknown;
  const items = isRecord(json) && Array.isArray(json.items) ? (json.items as unknown[]) : [];
  const issues = items.map(mapSearchItemToIssue);
  return NextResponse.json<ApiResponse<FeedbackIssue[]>>({ success: true, data: issues });
}

export async function POST(request: Request) {
  const repo = getFeedbackRepo();
  if (!repo) {
    return NextResponse.json<ApiResponse<null>>(
      { success: false, message: 'Missing NEXT_PUBLIC_GITHUB_FEEDBACK_REPO or GITHUB_FEEDBACK_REPO' },
      { status: 500 }
    );
  }

  const token = (process.env.GITHUB_FEEDBACK_TOKEN || '').trim();

  const payload = (await request.json().catch(() => null)) as
    | {
        title?: string;
        type?: string;
        description?: string;
        steps?: string;
        expected?: string;
        actual?: string;
        contact?: string;
        url?: string;
      }
    | null;

  const title = (payload?.title || '').trim();
  const type = (payload?.type || '').trim() || 'other';
  const description = (payload?.description || '').trim();

  if (!title || !description) {
    return NextResponse.json<ApiResponse<null>>(
      { success: false, message: 'Missing title or description' },
      { status: 400 }
    );
  }

  const body = buildIssueBody({
    type,
    description,
    steps: payload?.steps ?? null,
    expected: payload?.expected ?? null,
    actual: payload?.actual ?? null,
    contact: payload?.contact ?? null,
    url: payload?.url ?? null,
  });

  const labels = ['feedback', `type:${type}`, 'status:triage'];

  if (!token) {
    const createUrl = new URL(`https://github.com/${repo}/issues/new`);
    createUrl.searchParams.set('title', title);
    createUrl.searchParams.set('body', body);
    return NextResponse.json<ApiResponse<{ createUrl: string }>>(
      { success: false, data: { createUrl: createUrl.toString() }, message: 'GitHub token not configured' },
      { status: 501 }
    );
  }

  const [owner, name] = repo.split('/');
  try {
    await ensureRepoLabels(owner, name, labels);
  } catch {}
  const createEndpoint = `https://api.github.com/repos/${owner}/${name}/issues`;
  const response = await githubRequest(createEndpoint, {
    method: 'POST',
    body: JSON.stringify({ title, body, labels }),
    headers: { 'Content-Type': 'application/json' },
  });

  if (!response.ok) {
    const retryWithoutLabels = await githubRequest(createEndpoint, {
      method: 'POST',
      body: JSON.stringify({ title, body }),
      headers: { 'Content-Type': 'application/json' },
    });
    if (!retryWithoutLabels.ok) {
      const text = await response.text().catch(() => '');
      const retryText = await retryWithoutLabels.text().catch(() => '');
      return NextResponse.json<ApiResponse<null>>(
        {
          success: false,
          message: `Create issue failed (${response.status}): ${text || response.statusText}. Retry failed (${retryWithoutLabels.status}): ${retryText || retryWithoutLabels.statusText}`,
        },
        { status: 502 }
      );
    }
    const created = (await retryWithoutLabels.json().catch(() => null)) as unknown;
    const createdObj = isRecord(created) ? created : {};
    return NextResponse.json<ApiResponse<{ url: string; number: number }>>({
      success: true,
      data: { url: String(createdObj.html_url || ''), number: Number(createdObj.number || 0) },
    });
  }

  const created = (await response.json().catch(() => null)) as unknown;
  const createdObj = isRecord(created) ? created : {};
  return NextResponse.json<ApiResponse<{ url: string; number: number }>>({
    success: true,
    data: { url: String(createdObj.html_url || ''), number: Number(createdObj.number || 0) },
  });
}
