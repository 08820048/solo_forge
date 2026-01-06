'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useRouter } from '@/i18n/routing';

type ApiResponse<T> = { success: boolean; data?: T; message?: string };

type Placement = 'top' | 'right';
type TopSide = 'left' | 'right';
type PlanPreset = 'top' | 'right' | null;

type SubmitResult =
  | { kind: 'success' }
  | { kind: 'error'; message: string }
  | null;

type BenefitEntry = { text?: unknown; available?: unknown };

function normalizePlacement(value: string): Placement {
  return value === 'right' ? 'right' : 'top';
}

function normalizeTopSide(value: string): TopSide {
  return value === 'right' ? 'right' : 'left';
}

function normalizeBenefit(value: unknown): { text: string; available: boolean } {
  if (typeof value === 'string') return { text: value, available: true };
  if (value && typeof value === 'object') {
    const entry = value as BenefitEntry;
    const text = typeof entry.text === 'string' ? entry.text : String((entry as Record<string, unknown>).text ?? '');
    const available = entry.available === false ? false : true;
    return { text, available };
  }
  return { text: String(value ?? ''), available: true };
}

function getAuthenticatedUserEmail(): string | null {
  try {
    const raw = localStorage.getItem('sf_user');
    if (raw) {
      const parsed = JSON.parse(raw) as { email?: string } | null;
      const email = (parsed?.email || '').trim();
      if (email) return email.toLowerCase();
    }
  } catch {}

  return null;
}

function requestAuth(redirectPath: string) {
  try {
    sessionStorage.setItem('sf_post_login_redirect', redirectPath);
  } catch {}
  try {
    window.dispatchEvent(new CustomEvent('sf_require_auth', { detail: { redirectPath } }));
  } catch {
    window.dispatchEvent(new Event('sf_require_auth'));
  }
}

export default function PricingPage() {
  const locale = useLocale();
  const t = useTranslations('pricing');
  const router = useRouter();

  const [showForm, setShowForm] = useState(false);
  const [planPreset, setPlanPreset] = useState<PlanPreset>(null);
  const [placement, setPlacement] = useState<Placement>('top');
  const [email, setEmail] = useState('');
  const [product, setProduct] = useState('');
  const [note, setNote] = useState('');
  const [topSide, setTopSide] = useState<TopSide>('left');
  const [rightSlot, setRightSlot] = useState<'1' | '2' | '3'>('1');
  const [durationPreset, setDurationPreset] = useState<'30' | '90' | '180' | 'custom'>('30');
  const [customDays, setCustomDays] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<SubmitResult>(null);

  const kofiUrl = useMemo(() => 'https://ko-fi.com/U7U11RRKJV', []);

  const resolvedDays =
    durationPreset === 'custom' ? Number.parseInt(customDays.trim() || '0', 10) || 0 : Number.parseInt(durationPreset, 10);
  const canSubmit = email.trim() && product.trim() && resolvedDays > 0;

  const exampleText = t('instructions.example');

  function onFreeSubmitNow() {
    const redirectPath = '/developer?tab=submit';
    const authenticatedEmail = getAuthenticatedUserEmail();
    if (authenticatedEmail) {
      router.push({ pathname: '/developer', query: { tab: 'submit' } });
      return;
    }
    requestAuth(redirectPath);
  }

  async function submitListing() {
    const normalizedEmail = email.trim();
    const normalizedProduct = product.trim();
    const normalizedNote = note.trim();

    if (!normalizedEmail || !normalizedProduct) {
      setResult({ kind: 'error', message: t('form.missingRequired') });
      return;
    }
    if (!resolvedDays || resolvedDays <= 0) {
      setResult({ kind: 'error', message: t('form.submitFailed') });
      return;
    }

    setSubmitting(true);
    setResult(null);
    try {
      const payload: Record<string, unknown> = {
        email: normalizedEmail,
        product: normalizedProduct,
        placement: placement === 'top' ? 'home_top' : 'home_right',
        duration_days: resolvedDays,
        note: normalizedNote || null,
      };
      if (placement === 'top') {
        payload.top_side = topSide;
      } else {
        payload.slot_index = Number.parseInt(rightSlot, 10) - 1;
      }

      const response = await fetch('/api/sponsorship/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept-Language': locale },
        body: JSON.stringify(payload),
      });

      const json = (await response.json().catch(() => null)) as ApiResponse<unknown> | null;
      if (response.ok && json?.success) {
        setResult({ kind: 'success' });
        return;
      }
      setResult({ kind: 'error', message: json?.message || t('form.submitFailed') });
    } catch (e) {
      const message = e instanceof Error ? e.message : t('form.submitFailed');
      setResult({ kind: 'error', message });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl pt-24 pb-10">
      <div className="sf-wash rounded-2xl border border-border bg-card/50 overflow-hidden">
        <div className="px-6 py-5 border-b border-border">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className="text-2xl font-bold text-foreground tracking-tight">{t('title')}</h1>
              <p className="mt-2 text-sm text-muted-foreground">{t('subtitle')}</p>
            </div>
          </div>
        </div>

        <div className="p-6 space-y-8">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="relative rounded-2xl border border-border/80 bg-background/70 p-5 shadow-sm flex flex-col h-full overflow-hidden">
              <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-linear-to-b from-muted/40 to-transparent" />
              <div className="relative flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-base font-semibold text-foreground tracking-tight">{t('tiers.free.title')}</div>
                  <div className="mt-1 text-sm text-muted-foreground">{t('tiers.free.desc')}</div>
                </div>
                <Badge variant="secondary" className="shrink-0">
                  {t('tiers.free.badge')}
                </Badge>
              </div>
              <div className="relative mt-5 flex items-end gap-2">
                <div className="text-3xl font-bold text-foreground">{t('tiers.free.price')}</div>
              </div>
              <ul className="relative mt-4 space-y-2 text-sm text-muted-foreground">
                {(t.raw('tiers.free.benefits') as unknown[]).map((item, idx) => {
                  const b = normalizeBenefit(item);
                  return (
                    <li key={idx} className="flex items-start gap-2">
                      <i className="ri-check-line text-base text-primary" aria-hidden="true" />
                      <span>{b.text}</span>
                    </li>
                  );
                })}
              </ul>
              <div className="relative mt-5 grid grid-cols-1 gap-2">
                <Button type="button" className="h-12 rounded-xl bg-background/70" variant="outline" onClick={onFreeSubmitNow}>
                  {t('actions.submitNow')}
                </Button>
              </div>
            </div>

            <div className="relative rounded-2xl border border-primary/50 bg-linear-to-b from-primary/15 via-background to-background p-5 shadow-md flex flex-col h-full overflow-hidden">
              <div className="pointer-events-none absolute -top-24 -right-24 h-64 w-64 rounded-full bg-primary/15 blur-2xl" />
              <div className="relative flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-base font-semibold text-foreground tracking-tight">{t('tiers.top.title')}</div>
                  <div className="mt-1 text-sm text-muted-foreground">{t('tiers.top.desc')}</div>
                </div>
                <Badge className="shrink-0 bg-primary text-primary-foreground ring-2 ring-primary/25">
                  {t('tiers.top.badge')}
                </Badge>
              </div>
              <div className="relative mt-5 flex items-end gap-2">
                <div className="text-3xl font-bold text-foreground">{t('tiers.top.price')}</div>
              </div>
              <ul className="relative mt-4 space-y-2 text-sm text-muted-foreground">
                {(t.raw('tiers.top.benefits') as unknown[]).map((item, idx) => {
                  const b = normalizeBenefit(item);
                  return (
                    <li key={idx} className="flex items-start gap-2">
                      <i
                        className={[
                          b.available ? 'ri-check-line text-primary' : 'ri-close-line text-destructive',
                          'text-base',
                        ].join(' ')}
                        aria-hidden="true"
                      />
                      <span>{b.text}</span>
                    </li>
                  );
                })}
              </ul>
              <div className="relative mt-5 grid grid-cols-1 gap-2">
                <Button
                  asChild
                  className="h-12 rounded-xl bg-linear-to-t from-primary to-primary/80 text-primary-foreground shadow-lg shadow-primary/25 hover:opacity-95"
                >
                  <a href={kofiUrl} target="_blank" rel="noreferrer">
                    {t('actions.sponsor')}
                  </a>
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="h-12 rounded-xl bg-background/70"
                  onClick={() => {
                    setPlanPreset('top');
                    setPlacement('top');
                    setTopSide('left');
                    setShowForm(true);
                    setResult(null);
                  }}
                >
                  {t('actions.iPaid')}
                </Button>
              </div>
            </div>

            <div className="relative rounded-2xl border border-border/80 bg-background/70 p-5 shadow-sm flex flex-col h-full overflow-hidden">
              <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-linear-to-b from-muted/40 to-transparent" />
              <div className="relative flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-base font-semibold text-foreground tracking-tight">{t('tiers.right.title')}</div>
                  <div className="mt-1 text-sm text-muted-foreground">{t('tiers.right.desc')}</div>
                </div>
                <Badge variant="outline" className="shrink-0">
                  {t('tiers.right.badge')}
                </Badge>
              </div>
              <div className="relative mt-5 flex items-end gap-2">
                <div className="text-3xl font-bold text-foreground">{t('tiers.right.price')}</div>
              </div>
              <ul className="relative mt-4 space-y-2 text-sm text-muted-foreground">
                {(t.raw('tiers.right.benefits') as unknown[]).map((item, idx) => {
                  const b = normalizeBenefit(item);
                  return (
                    <li key={idx} className="flex items-start gap-2">
                      <i
                        className={[
                          b.available ? 'ri-check-line text-primary' : 'ri-close-line text-destructive',
                          'text-base',
                        ].join(' ')}
                        aria-hidden="true"
                      />
                      <span>{b.text}</span>
                    </li>
                  );
                })}
              </ul>
              <div className="relative mt-5 grid grid-cols-1 gap-2">
                <Button
                  asChild
                  className="h-12 rounded-xl bg-linear-to-t from-neutral-900 to-neutral-700 text-white shadow-lg shadow-black/10 hover:opacity-95"
                >
                  <a href={kofiUrl} target="_blank" rel="noreferrer">
                    {t('actions.sponsor')}
                  </a>
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="h-12 rounded-xl bg-background/70"
                  onClick={() => {
                    setPlanPreset('right');
                    setPlacement('right');
                    setRightSlot('1');
                    setShowForm(true);
                    setResult(null);
                  }}
                >
                  {t('actions.iPaid')}
                </Button>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-background/40 p-5">
            <div className="text-sm font-semibold text-foreground">FAQ</div>
            <div className="mt-3 space-y-3">
              <details className="rounded-lg border border-border bg-background/60 px-4 py-3">
                <summary className="cursor-pointer list-none text-sm font-medium text-foreground flex items-center justify-between">
                  <span>{t('instructions.title')}</span>
                  <i className="ri-add-line text-base text-muted-foreground" aria-hidden="true" />
                </summary>
                  <div className="mt-3 text-sm text-muted-foreground">
                  <p>{t('instructions.desc')}</p>
                  <div className="mt-3 space-y-1">
                    <div>• {t('instructions.fields.email')}</div>
                    <div>• {t('instructions.fields.product')}</div>
                    <div>• {t('instructions.fields.placement')}</div>
                    <div>• {t('instructions.fields.slot')}</div>
                    <div>• {t('instructions.fields.duration')}</div>
                  </div>
                </div>
              </details>

              <details className="rounded-lg border border-border bg-background/60 px-4 py-3">
                <summary className="cursor-pointer list-none text-sm font-medium text-foreground flex items-center justify-between">
                  <span>{t('instructions.exampleTitle')}</span>
                  <i className="ri-add-line text-base text-muted-foreground" aria-hidden="true" />
                </summary>
                <div className="mt-3">
                  <pre className="whitespace-pre-wrap rounded-md border border-border bg-background/60 px-3 py-2 text-xs text-foreground/90">
                    {exampleText}
                  </pre>
                </div>
              </details>
            </div>
          </div>

          {showForm ? (
            <div className="rounded-xl border border-border bg-background/40 p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-foreground">{t('form.title')}</div>
                  <div className="mt-1 text-sm text-muted-foreground">{t('form.desc')}</div>
                </div>
              </div>

              <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="email">{t('form.email')}</Label>
                  <Input
                    id="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder={t('form.emailPlaceholder')}
                    autoComplete="email"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="product">{t('form.product')}</Label>
                  <Input
                    id="product"
                    value={product}
                    onChange={(e) => setProduct(e.target.value)}
                    placeholder={t('form.productPlaceholder')}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="placement">{t('form.placement')}</Label>
                  {planPreset === 'right' ? (
                    <select
                      id="placement"
                      value="right"
                      disabled
                      className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground shadow-xs focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] outline-none"
                    >
                      <option value="right">{t('form.placementRight')}</option>
                    </select>
                  ) : (
                    <select
                      id="placement"
                      value={placement}
                      onChange={(e) => setPlacement(normalizePlacement(e.target.value))}
                      className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground shadow-xs focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] outline-none"
                    >
                      <option value="top">{t('form.placementTop')}</option>
                      <option value="right">{t('form.placementRight')}</option>
                    </select>
                  )}
                </div>

                {placement === 'top' ? (
                  <div className="space-y-2">
                    <Label htmlFor="topSide">{t('form.topSide')}</Label>
                    <select
                      id="topSide"
                      value={topSide}
                      onChange={(e) => setTopSide(normalizeTopSide(e.target.value))}
                      className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground shadow-xs focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] outline-none"
                    >
                      <option value="left">{t('form.topSideLeft')}</option>
                      <option value="right">{t('form.topSideRight')}</option>
                    </select>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Label htmlFor="rightSlot">{t('form.rightSlot')}</Label>
                    <select
                      id="rightSlot"
                      value={rightSlot}
                      onChange={(e) => setRightSlot((e.target.value === '2' ? '2' : e.target.value === '3' ? '3' : '1'))}
                      className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground shadow-xs focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] outline-none"
                    >
                      <option value="1">1</option>
                      <option value="2">2</option>
                      <option value="3">3</option>
                    </select>
                  </div>
                )}

                <div className="space-y-2">
                  <Label htmlFor="duration">{t('form.duration')}</Label>
                  <select
                    id="duration"
                    value={durationPreset}
                    onChange={(e) =>
                      setDurationPreset(e.target.value === '90' ? '90' : e.target.value === '180' ? '180' : e.target.value === 'custom' ? 'custom' : '30')
                    }
                    className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground shadow-xs focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] outline-none"
                  >
                    <option value="30">{t('form.duration30d')}</option>
                    <option value="90">{t('form.duration90d')}</option>
                    <option value="180">{t('form.duration180d')}</option>
                    <option value="custom">{t('form.durationCustom')}</option>
                  </select>
                </div>

                {durationPreset === 'custom' ? (
                  <div className="space-y-2">
                    <Label htmlFor="customDays">{t('form.customDays')}</Label>
                    <Input
                      id="customDays"
                      value={customDays}
                      onChange={(e) => setCustomDays(e.target.value)}
                      placeholder={t('form.customDaysPlaceholder')}
                      inputMode="numeric"
                    />
                  </div>
                ) : null}

                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="note">{t('form.note')}</Label>
                  <Textarea
                    id="note"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder={t('form.notePlaceholder')}
                    rows={4}
                  />
                </div>
              </div>

              <div className="mt-5 flex items-center gap-3">
                <Button type="button" onClick={submitListing} disabled={!canSubmit || submitting}>
                  {submitting ? t('actions.submitting') : t('actions.submit')}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setShowForm(false);
                    setResult(null);
                    setPlanPreset(null);
                  }}
                >
                  {t('actions.close')}
                </Button>
              </div>

              {result ? (
                <div className="mt-4">
                  {result.kind === 'success' ? (
                    <Alert>
                      <i className="ri-checkbox-circle-line" aria-hidden="true" />
                      <AlertTitle>{t('form.submitted')}</AlertTitle>
                      <AlertDescription>{t('form.submitted')}</AlertDescription>
                    </Alert>
                  ) : (
                    <Alert variant="destructive">
                      <i className="ri-error-warning-line" aria-hidden="true" />
                      <AlertTitle>{t('form.submitFailed')}</AlertTitle>
                      <AlertDescription>
                        <p>{result.message}</p>
                      </AlertDescription>
                    </Alert>
                  )}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
