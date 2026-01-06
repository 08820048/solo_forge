'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';

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

function findLabelValue(labels: string[], prefix: string) {
  const hit = labels.find((l) => l.toLowerCase().startsWith(prefix.toLowerCase()));
  if (!hit) return null;
  const idx = hit.indexOf(':');
  if (idx < 0) return null;
  const v = hit.slice(idx + 1).trim();
  return v || null;
}

function formatDateTime(iso: string) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  return new Date(t).toLocaleString();
}

function clampText(value: string, maxLen: number) {
  const s = value.trim();
  if (s.length <= maxLen) return s;
  return `${s.slice(0, maxLen).trim()}…`;
}

function stripMarkdown(value: string) {
  return (
    value
      .replace(/```[\s\S]*?```/g, '')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '$1')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/^>\s?/gm, '')
      .replace(/[*_~]+/g, '')
      .replace(/^\s*[-*+]\s+/gm, '')
      .replace(/^\s*\d+\.\s+/gm, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}

function isMissingRepoMessage(message: string) {
  return message.includes('Missing NEXT_PUBLIC_GITHUB_FEEDBACK_REPO') || message.includes('Missing GITHUB_FEEDBACK_REPO');
}

function getIssueStatus(issue: FeedbackIssue) {
  const status = findLabelValue(issue.labels, 'status:');
  if (issue.state === 'closed') return status || 'closed';
  return status || 'open';
}

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

function MarkdownView({ value, className }: { value: string; className?: string }) {
  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ ...props }) => (
            <a
              {...props}
              className="text-primary underline underline-offset-4"
              target="_blank"
              rel="noreferrer"
              onClick={(e) => {
                e.stopPropagation();
                props.onClick?.(e);
              }}
            />
          ),
          pre: ({ ...props }) => (
            <pre {...props} className="overflow-x-auto rounded-lg bg-muted px-3 py-2 text-xs text-foreground/90" />
          ),
          code: ({ className: codeClassName, children, ...props }) => {
            const inline = !String(codeClassName || '').includes('language-');
            if (inline) {
              return (
                <code
                  {...props}
                  className="rounded bg-muted px-1 py-0.5 text-[0.85em] text-foreground/90"
                >
                  {children}
                </code>
              );
            }
            return (
              <code {...props} className={codeClassName}>
                {children}
              </code>
            );
          },
          ul: ({ ...props }) => <ul {...props} className="ml-5 list-disc space-y-1" />,
          ol: ({ ...props }) => <ol {...props} className="ml-5 list-decimal space-y-1" />,
          h2: ({ ...props }) => <h2 {...props} className="mt-4 text-base font-semibold text-foreground" />,
          h3: ({ ...props }) => <h3 {...props} className="mt-3 text-sm font-semibold text-foreground" />,
          p: ({ ...props }) => <p {...props} className="mt-2 text-sm leading-6 text-foreground/90" />,
          blockquote: ({ ...props }) => (
            <blockquote {...props} className="mt-2 border-l-2 border-border pl-3 text-sm text-foreground/80" />
          ),
        }}
      >
        {value}
      </ReactMarkdown>
    </div>
  );
}

export default function FeedbackPage() {
  const t = useTranslations('feedback');

  const [formMode, setFormMode] = useState<'edit' | 'preview'>('edit');
  const [type, setType] = useState('bug');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [steps, setSteps] = useState('');
  const [expected, setExpected] = useState('');
  const [actual, setActual] = useState('');
  const [contact, setContact] = useState('');
  const [pageUrl, setPageUrl] = useState('');
  const [showMore, setShowMore] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState<{ url?: string; number?: number; createUrl?: string } | null>(null);

  const typeOptions = useMemo(
    () => [
      { value: 'bug', label: t('types.bug') },
      { value: 'feature', label: t('types.feature') },
      { value: 'ui', label: t('types.ui') },
      { value: 'performance', label: t('types.performance') },
      { value: 'data', label: t('types.data') },
      { value: 'other', label: t('types.other') },
    ],
    [t]
  );

  const statusOptions = useMemo(
    () => [
      { value: 'all', label: t('status.all') },
      { value: 'open', label: t('status.open') },
      { value: 'closed', label: t('status.closed') },
      { value: 'triage', label: t('status.triage') },
      { value: 'in-progress', label: t('status.inProgress') },
      { value: 'planned', label: t('status.planned') },
      { value: 'resolved', label: t('status.resolved') },
      { value: 'wontfix', label: t('status.wontFix') },
    ],
    [t]
  );

  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [page, setPage] = useState(1);

  const [issues, setIssues] = useState<FeedbackIssue[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    try {
      setPageUrl(window.location.href);
    } catch {}
  }, []);

  useEffect(() => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setListLoading(true);
    setListError(null);

    const url = new URL('/api/feedback', window.location.origin);
    if (search.trim()) url.searchParams.set('q', search.trim());
    if (filterStatus !== 'all') url.searchParams.set('status', filterStatus);
    if (filterType !== 'all') url.searchParams.set('type', filterType);
    url.searchParams.set('page', String(page));

    fetch(url.toString(), { signal: controller.signal })
      .then(async (res) => {
        const json = (await res.json().catch(() => null)) as ApiResponse<FeedbackIssue[]> | null;
        if (!json || !json.success || !Array.isArray(json.data)) {
          throw new Error(json?.message || `Request failed (${res.status})`);
        }
        setIssues(json.data);
        if (selected && !json.data.some((i) => i.number === selected)) setSelected(null);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        const message =
          err && typeof err === 'object' && 'message' in err
            ? String((err as { message?: unknown }).message)
            : t('list.loadFailed');
        if (message && isMissingRepoMessage(message)) {
          setListError(t('list.missingRepo'));
          return;
        }
        setListError(message || t('list.loadFailed'));
      })
      .finally(() => {
        if (controller.signal.aborted) return;
        setListLoading(false);
      });

    return () => controller.abort();
  }, [filterStatus, filterType, page, search, selected, t]);

  const selectedIssue = useMemo(() => issues.find((i) => i.number === selected) || null, [issues, selected]);

  const previewBody = useMemo(() => {
    const trimmedTitle = title.trim() || t('form.issueTitlePlaceholder');
    const trimmedDescription = description.trim() || t('form.descriptionPlaceholder');
    const body = buildIssueBody({
      type: type.trim() || 'other',
      description: trimmedDescription,
      steps: steps.trim() || null,
      expected: expected.trim() || null,
      actual: actual.trim() || null,
      contact: contact.trim() || null,
      url: pageUrl.trim() || null,
    });
    return `# ${trimmedTitle}\n\n${body}`;
  }, [actual, contact, description, expected, pageUrl, steps, t, title, type]);

  async function onSubmit() {
    setSubmitError(null);
    setSubmitSuccess(null);
    const trimmedTitle = title.trim();
    const trimmedDescription = description.trim();
    if (!trimmedTitle || !trimmedDescription) {
      setSubmitError(t('form.missingRequired'));
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          title: trimmedTitle,
          description: trimmedDescription,
          steps: steps.trim() || undefined,
          expected: expected.trim() || undefined,
          actual: actual.trim() || undefined,
          contact: contact.trim() || undefined,
          url: pageUrl.trim() || undefined,
        }),
      });
      const json = (await res.json().catch(() => null)) as ApiResponse<{ url?: string; number?: number; createUrl?: string }> | null;
      if (!json) throw new Error(t('form.submitFailed'));

      if (json.success && json.data?.url) {
        setSubmitSuccess({ url: json.data.url, number: json.data.number });
        setTitle('');
        setDescription('');
        setSteps('');
        setExpected('');
        setActual('');
        setContact('');
        setShowMore(false);
        setPage(1);
        setSearch('');
        setFilterStatus('all');
        setFilterType('all');
        return;
      }

      const createUrl = json.data?.createUrl;
      if (createUrl) {
        setSubmitSuccess({ createUrl });
        return;
      }

      throw new Error(json.message || t('form.submitFailed'));
    } catch (err: unknown) {
      const message = err && typeof err === "object" && "message" in err ? String((err as { message?: unknown }).message) : t('form.submitFailed');
      setSubmitError(message || t('form.submitFailed'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-foreground tracking-tight">{t('title')}</h1>
          <p className="mt-2 text-muted-foreground">{t('subtitle')}</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
          <div className="rounded-2xl border border-border bg-background/40 p-5">
            <Tabs value={formMode} onValueChange={(v) => setFormMode(v as 'edit' | 'preview')}>
              <div className="flex items-center justify-between">
                <div className="text-base font-semibold text-foreground">{t('form.title')}</div>
                <TabsList className="h-8">
                  <TabsTrigger className="h-7 text-xs px-2" value="edit">
                    {t('form.edit')}
                  </TabsTrigger>
                  <TabsTrigger className="h-7 text-xs px-2" value="preview">
                    {t('form.preview')}
                  </TabsTrigger>
                </TabsList>
              </div>
              <Separator className="my-4" />

              <TabsContent value="edit">
                <div className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label>{t('form.type')}</Label>
                      <Select value={type} onValueChange={setType}>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder={t('form.typePlaceholder')} />
                        </SelectTrigger>
                        <SelectContent>
                          {typeOptions.map((o) => (
                            <SelectItem key={o.value} value={o.value}>
                              {o.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="feedback-title">{t('form.issueTitle')}</Label>
                      <Input
                        id="feedback-title"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        placeholder={t('form.issueTitlePlaceholder')}
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="feedback-desc">{t('form.description')}</Label>
                    <Textarea
                      id="feedback-desc"
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder={t('form.descriptionPlaceholder')}
                      className="min-h-28"
                    />
                    <div className="text-xs text-muted-foreground">{t('form.markdownHint')}</div>
                  </div>

                  <div className="flex items-center justify-between gap-3">
                    <Button type="button" variant="outline" onClick={() => setShowMore((v) => !v)}>
                      {showMore ? t('form.hideMore') : t('form.showMore')}
                    </Button>
                    <Button
                      type="button"
                      onClick={onSubmit}
                      disabled={submitting}
                      className="bg-primary text-primary-foreground hover:bg-primary/90"
                    >
                      {submitting ? t('form.submitting') : t('form.submit')}
                    </Button>
                  </div>

                  {showMore ? (
                    <div className="space-y-4">
                      <div className="space-y-1.5">
                        <Label htmlFor="feedback-steps">{t('form.steps')}</Label>
                        <Textarea
                          id="feedback-steps"
                          value={steps}
                          onChange={(e) => setSteps(e.target.value)}
                          placeholder={t('form.stepsPlaceholder')}
                          className="min-h-20"
                        />
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                          <Label htmlFor="feedback-expected">{t('form.expected')}</Label>
                          <Textarea
                            id="feedback-expected"
                            value={expected}
                            onChange={(e) => setExpected(e.target.value)}
                            placeholder={t('form.expectedPlaceholder')}
                            className="min-h-20"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor="feedback-actual">{t('form.actual')}</Label>
                          <Textarea
                            id="feedback-actual"
                            value={actual}
                            onChange={(e) => setActual(e.target.value)}
                            placeholder={t('form.actualPlaceholder')}
                            className="min-h-20"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                          <Label htmlFor="feedback-contact">{t('form.contact')}</Label>
                          <Input
                            id="feedback-contact"
                            value={contact}
                            onChange={(e) => setContact(e.target.value)}
                            placeholder={t('form.contactPlaceholder')}
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor="feedback-url">{t('form.pageUrl')}</Label>
                          <Input
                            id="feedback-url"
                            value={pageUrl}
                            onChange={(e) => setPageUrl(e.target.value)}
                            placeholder="https://"
                          />
                        </div>
                      </div>
                    </div>
                  ) : null}

                  {submitError ? (
                    <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-foreground">
                      {submitError}
                    </div>
                  ) : null}

                  {submitSuccess?.url ? (
                    <div className="rounded-lg border border-border bg-background/60 px-3 py-2 text-sm">
                      <div className="text-foreground">{t('form.submitted')}</div>
                      <a className="text-primary underline underline-offset-4" href={submitSuccess.url} target="_blank" rel="noreferrer">
                        {t('form.viewOnGitHub', { number: submitSuccess.number ?? 0 })}
                      </a>
                    </div>
                  ) : null}

                  {submitSuccess?.createUrl ? (
                    <div className="rounded-lg border border-border bg-background/60 px-3 py-2 text-sm">
                      <div className="text-foreground">{t('form.tokenMissing')}</div>
                      <div className="mt-2 flex items-center gap-2">
                        <Button type="button" onClick={() => window.open(submitSuccess.createUrl, '_blank', 'noopener,noreferrer')}>
                          {t('form.openIssuePage')}
                        </Button>
                        <Button type="button" variant="outline" onClick={() => setSubmitSuccess(null)}>
                          {t('form.dismiss')}
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </div>
              </TabsContent>

              <TabsContent value="preview">
                <div className="space-y-4">
                  <div className="rounded-xl border border-border bg-background/50 p-4">
                    <MarkdownView value={previewBody} />
                  </div>
                  <div className="flex items-center justify-end gap-3">
                    <Button type="button" variant="outline" onClick={() => setFormMode('edit')}>
                      {t('form.backToEdit')}
                    </Button>
                    <Button
                      type="button"
                      onClick={onSubmit}
                      disabled={submitting}
                      className="bg-primary text-primary-foreground hover:bg-primary/90"
                    >
                      {submitting ? t('form.submitting') : t('form.submit')}
                    </Button>
                  </div>

                  {submitError ? (
                    <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-foreground">
                      {submitError}
                    </div>
                  ) : null}

                  {submitSuccess?.url ? (
                    <div className="rounded-lg border border-border bg-background/60 px-3 py-2 text-sm">
                      <div className="text-foreground">{t('form.submitted')}</div>
                      <a className="text-primary underline underline-offset-4" href={submitSuccess.url} target="_blank" rel="noreferrer">
                        {t('form.viewOnGitHub', { number: submitSuccess.number ?? 0 })}
                      </a>
                    </div>
                  ) : null}

                  {submitSuccess?.createUrl ? (
                    <div className="rounded-lg border border-border bg-background/60 px-3 py-2 text-sm">
                      <div className="text-foreground">{t('form.tokenMissing')}</div>
                      <div className="mt-2 flex items-center gap-2">
                        <Button type="button" onClick={() => window.open(submitSuccess.createUrl, '_blank', 'noopener,noreferrer')}>
                          {t('form.openIssuePage')}
                        </Button>
                        <Button type="button" variant="outline" onClick={() => setSubmitSuccess(null)}>
                          {t('form.dismiss')}
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </div>
              </TabsContent>
            </Tabs>
          </div>

          <div className="rounded-2xl border border-border bg-background/40 p-5">
            <div className="flex items-center justify-between">
              <div className="text-base font-semibold text-foreground">{t('list.title')}</div>
              <div className="text-xs text-muted-foreground">{t('list.sortedByUpdated')}</div>
            </div>
            <Separator className="my-4" />

            <div className="flex flex-col gap-3">
              <div className="flex flex-col sm:flex-row gap-3">
                <Input
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setPage(1);
                  }}
                  placeholder={t('list.searchPlaceholder')}
                  className="w-full"
                />

                <Select
                  value={filterStatus}
                  onValueChange={(v) => {
                    setFilterStatus(v);
                    setPage(1);
                  }}
                >
                  <SelectTrigger className="w-full sm:w-40">
                    <SelectValue placeholder={t('list.statusPlaceholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    {statusOptions.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select
                  value={filterType}
                  onValueChange={(v) => {
                    setFilterType(v);
                    setPage(1);
                  }}
                >
                  <SelectTrigger className="w-full sm:w-40">
                    <SelectValue placeholder={t('list.typePlaceholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t('types.all')}</SelectItem>
                    {typeOptions.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {listError ? (
                <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-foreground">
                  {listError}
                </div>
              ) : null}

              <div className="grid grid-cols-1 gap-3">
                {listLoading ? (
                  <div className="text-sm text-muted-foreground">{t('list.loading')}</div>
                ) : issues.length === 0 ? (
                  <div className="text-sm text-muted-foreground">{t('list.empty')}</div>
                ) : (
                  issues.map((issue) => {
                    const typeLabel = findLabelValue(issue.labels, 'type:') || 'other';
                    const status = getIssueStatus(issue);
                    const typeText = typeOptions.find((o) => o.value === typeLabel)?.label || typeLabel;
                    const statusText =
                      status === 'open'
                        ? t('status.open')
                        : status === 'closed'
                          ? t('status.closed')
                          : status === 'triage'
                            ? t('status.triage')
                            : status === 'in-progress'
                              ? t('status.inProgress')
                              : status === 'planned'
                                ? t('status.planned')
                                : status === 'resolved'
                                  ? t('status.resolved')
                                  : status === 'wontfix'
                                    ? t('status.wontFix')
                                    : status;
                    const badgeVariant =
                      issue.state === 'closed'
                        ? 'secondary'
                        : status === 'triage'
                          ? 'outline'
                          : status === 'in-progress'
                            ? 'default'
                            : 'outline';
                    const isSelected = selected === issue.number;

                    return (
                      <button
                        key={issue.id}
                        type="button"
                        onClick={() => setSelected((prev) => (prev === issue.number ? null : issue.number))}
                        className="text-left rounded-xl border border-border bg-background/50 hover:bg-accent/20 transition-colors p-4"
                      >
                        <div className="flex items-start gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge variant="outline">{typeText}</Badge>
                              <Badge variant={badgeVariant as 'default' | 'secondary' | 'outline'}>{statusText}</Badge>
                              <span className="text-xs text-muted-foreground">#{issue.number}</span>
                              <span className="ml-auto text-xs text-muted-foreground">
                                {issue.comments ? t('list.comments', { count: issue.comments }) : t('list.noComments')}
                              </span>
                            </div>
                            <div className="mt-2 font-medium text-foreground truncate">{issue.title}</div>
                            <div className="mt-1 text-xs text-muted-foreground">
                              {t('list.updatedAt', { time: formatDateTime(issue.updatedAt) })}
                            </div>
                            <div className="mt-2 text-sm text-muted-foreground line-clamp-2">
                              {clampText(stripMarkdown(issue.body || ''), 160)}
                            </div>
                          </div>
                        </div>

                        {isSelected && selectedIssue ? (
                          <div className="mt-4 rounded-lg border border-border bg-background/40 p-3">
                            <div className="flex flex-wrap items-center gap-2">
                              {selectedIssue.author ? (
                                <span className="text-xs text-muted-foreground">{t('list.author', { author: selectedIssue.author })}</span>
                              ) : null}
                              <span className="text-xs text-muted-foreground">{t('list.createdAt', { time: formatDateTime(selectedIssue.createdAt) })}</span>
                              <a
                                className="ml-auto text-xs text-primary underline underline-offset-4"
                                href={selectedIssue.url}
                                target="_blank"
                                rel="noreferrer"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {t('list.openOnGitHub')}
                              </a>
                            </div>
                            <Separator className="my-2" />
                            <MarkdownView value={selectedIssue.body || t('list.noBody')} />
                          </div>
                        ) : null}
                      </button>
                    );
                  })
                )}
              </div>

              <div className="flex items-center justify-between pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1 || listLoading}
                >
                  {t('list.prev')}
                </Button>
                <div className="text-xs text-muted-foreground">
                  {t('list.page', { page })}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setPage((p) => p + 1)}
                  disabled={listLoading || issues.length === 0}
                >
                  {t('list.next')}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
