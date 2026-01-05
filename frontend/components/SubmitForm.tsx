'use client';

import { useTranslations } from 'next-intl';
import { useLocale } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/routing';
import { cn } from '@/lib/utils';
import { getSupabaseAuthStoragePreference, getSupabaseBrowserClient } from '@/lib/supabase';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';

const LIMITS = {
  productName: 60,
  slogan: 120,
  description: 8000,
  website: 200,
  logoUrl: 500,
  tags: 200,
  makerName: 60,
  makerEmail: 254,
  makerWebsite: 200,
} as const;

const PRODUCT_LOGO_BUCKET = 'product-logos';
const MAX_LOGO_BYTES = 5 * 1024 * 1024;

/**
 * readUserFromStorage
 * 从 localStorage 读取登录态用户信息，用于表单默认填充。
 */
function readUserFromStorage(): { name?: string; email?: string } | null {
  try {
    const raw = localStorage.getItem('sf_user');
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { name?: string; email?: string };
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) return message;
  }
  return fallback;
}

export default function SubmitForm({
  showHeader = true,
  defaultMakerName,
  defaultMakerEmail,
  lockMakerIdentity = false,
  embedded = false,
  primaryButtonClassName,
  mode = 'create',
  productId,
  initialProduct,
  submitLabel,
  onSubmitted,
}: {
  showHeader?: boolean;
  defaultMakerName?: string;
  defaultMakerEmail?: string;
  lockMakerIdentity?: boolean;
  embedded?: boolean;
  primaryButtonClassName?: string;
  mode?: 'create' | 'update';
  productId?: string;
  initialProduct?: {
    name?: string;
    slogan?: string;
    description?: string;
    website?: string;
    logo_url?: string | null;
    category?: string;
    tags?: string[];
    maker_website?: string | null;
  };
  submitLabel?: string;
  onSubmitted?: () => void;
}) {
  const t = useTranslations('submit');
  const categoryT = useTranslations('categories');
  const locale = useLocale();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [makerName, setMakerName] = useState(() => defaultMakerName ?? readUserFromStorage()?.name ?? '');
  const [makerEmail, setMakerEmail] = useState(() => defaultMakerEmail ?? readUserFromStorage()?.email ?? '');
  const [logoUrl, setLogoUrl] = useState(() => String(initialProduct?.logo_url ?? '').trim());
  const [logoUploading, setLogoUploading] = useState(false);
  const [logoFileInputKey, setLogoFileInputKey] = useState(0);

  const categories = ['ai', 'productivity', 'developer', 'design', 'marketing', 'finance', 'education', 'health', 'entertainment', 'other'];

  const makerNameValue = lockMakerIdentity ? (defaultMakerName ?? readUserFromStorage()?.name ?? makerName) : makerName;
  const makerEmailValue = lockMakerIdentity ? (defaultMakerEmail ?? readUserFromStorage()?.email ?? makerEmail) : makerEmail;

  const validateMaxLength = (value: string, max: number, fieldLabel: string): string | null => {
    if (value.length <= max) return null;
    return t('error.fieldTooLong', { field: fieldLabel, max });
  };

  const validateLogoUrl = (value: string): string | null => {
    const normalized = value.trim();
    if (!normalized) return null;
    try {
      const url = new URL(normalized);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        return t('error.logoInvalidUrl');
      }
      return null;
    } catch {
      return t('error.logoInvalidUrl');
    }
  };

  const clearLogo = () => {
    setLogoUrl('');
    setLogoFileInputKey((k) => k + 1);
  };

  const onPickLogoFile = async (file: File | null) => {
    if (!file) return;
    setError(null);

    if (file.size > MAX_LOGO_BYTES) {
      setError(t('error.logoTooLarge'));
      setLogoFileInputKey((k) => k + 1);
      return;
    }
    if (!file.type.startsWith('image/')) {
      setError(t('error.logoInvalidType'));
      setLogoFileInputKey((k) => k + 1);
      return;
    }

    setLogoUploading(true);
    try {
      const storage = getSupabaseAuthStoragePreference();
      const supabase = getSupabaseBrowserClient({ storage });
      const { data } = await supabase.auth.getSession();
      const userId = data.session?.user?.id;
      if (!userId) {
        setError(t('error.logoLoginRequired'));
        setLogoFileInputKey((k) => k + 1);
        return;
      }

      const ext = (file.name.split('.').pop() || 'png').toLowerCase();
      const path = `${userId}/${Date.now()}.${ext}`;
      const { error: uploadError } = await supabase.storage.from(PRODUCT_LOGO_BUCKET).upload(path, file, {
        upsert: false,
        contentType: file.type,
        cacheControl: '3600',
      });
      if (uploadError) {
        setError(getErrorMessage(uploadError, t('error.logoUploadFailed')));
        setLogoFileInputKey((k) => k + 1);
        return;
      }

      const { data: urlData } = supabase.storage.from(PRODUCT_LOGO_BUCKET).getPublicUrl(path);
      const publicUrl = (urlData?.publicUrl || '').trim();
      if (!publicUrl) {
        setError(t('error.logoUploadFailed'));
        setLogoFileInputKey((k) => k + 1);
        return;
      }

      let publicAccessible = true;
      try {
        const checkResponse = await fetch(publicUrl, { method: 'HEAD', cache: 'no-store' });
        if (!checkResponse.ok) {
          await new Promise((r) => setTimeout(r, 300));
          const retryResponse = await fetch(publicUrl, { method: 'HEAD', cache: 'no-store' });
          publicAccessible = retryResponse.ok;
        }
      } catch {
        publicAccessible = true;
      }

      if (!publicAccessible) {
        setError(`${t('error.logoUploadFailed')}（Logo 已上传但无法通过公开链接访问，请检查 bucket 是否为 Public。）`);
        setLogoFileInputKey((k) => k + 1);
        return;
      }

      setLogoUrl(publicUrl);
      setLogoFileInputKey((k) => k + 1);
    } catch (e) {
      setError(getErrorMessage(e, t('error.logoUploadFailed')));
      setLogoFileInputKey((k) => k + 1);
    } finally {
      setLogoUploading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    const formData = new FormData(e.currentTarget);

    const name = String(formData.get('productName') ?? '');
    const slogan = String(formData.get('slogan') ?? '');
    const description = String(formData.get('description') ?? '');
    const website = String(formData.get('website') ?? '');
    const category = String(formData.get('category') ?? '');
    const logoUrlValue = String(formData.get('logoUrl') ?? logoUrl ?? '').trim();
    const tagsRaw = String(formData.get('tags') ?? '');
    const makerWebsite = String(formData.get('makerWebsite') ?? '');

    const checks: Array<string | null> = [
      validateMaxLength(name, LIMITS.productName, t('form.productName')),
      validateMaxLength(slogan, LIMITS.slogan, t('form.slogan')),
      validateMaxLength(description, LIMITS.description, t('form.description')),
      validateMaxLength(website, LIMITS.website, t('form.website')),
      logoUrlValue ? validateMaxLength(logoUrlValue, LIMITS.logoUrl, t('form.logoUrl')) : null,
      logoUrlValue ? validateLogoUrl(logoUrlValue) : null,
      validateMaxLength(tagsRaw, LIMITS.tags, t('form.tags')),
      validateMaxLength(makerNameValue, LIMITS.makerName, t('form.makerName')),
      validateMaxLength(makerEmailValue, LIMITS.makerEmail, t('form.makerEmail')),
      makerWebsite ? validateMaxLength(makerWebsite, LIMITS.makerWebsite, t('form.makerWebsite')) : null,
    ];

    const firstError = checks.find((v) => typeof v === 'string' && v.trim()) as string | undefined;
    if (firstError) {
      setIsSubmitting(false);
      setError(firstError);
      return;
    }

    const productData = {
      name,
      slogan,
      description,
      website,
      logo_url: logoUrlValue || undefined,
      category,
      tags: tagsRaw ? tagsRaw.split(',').map((tag) => tag.trim()).filter((tag) => tag) : [],
      maker_name: makerNameValue,
      maker_email: makerEmailValue,
      maker_website: makerWebsite || undefined,
      language: locale,
    };

    try {
      const endpoint =
        mode === 'update'
          ? `/api/products?id=${encodeURIComponent(String(productId || '').trim())}`
          : '/api/products';
      const method = mode === 'update' ? 'PUT' : 'POST';
      const payload =
        mode === 'update'
          ? {
              name,
              slogan,
              description,
              website,
              logo_url: logoUrlValue || undefined,
              category,
              tags: tagsRaw ? tagsRaw.split(',').map((tag) => tag.trim()).filter((tag) => tag) : [],
              status: 'pending',
            }
          : productData;

      const response = await fetch(endpoint, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Accept-Language': locale,
        },
        body: JSON.stringify(payload),
      });

      const result = await response.json();

      if (result.success) {
        setIsSubmitting(false);
        setSubmitted(true);
        onSubmitted?.();
      } else {
        setIsSubmitting(false);
        setError(result.message || 'Submission failed');
      }
    } catch {
      setIsSubmitting(false);
      setError('Network error. Please try again later.');
    }
  };

  if (submitted) {
    return (
      <div className="text-center py-12 animate-on-scroll">
        <Alert className="max-w-md mx-auto mb-6">
          <AlertDescription>
            <h2 className="text-xl font-bold text-green-600 dark:text-green-400 mb-2">{t('success.title')}</h2>
            <p className="text-muted-foreground">{t('success.message')}</p>
          </AlertDescription>
        </Alert>
        <Button asChild size="lg" variant="default" className={primaryButtonClassName}>
          <Link href="/">{t('success.backToHome')}</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto">
      {showHeader ? (
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-foreground mb-4 font-sans tracking-tight">{t('title')}</h1>
          <p className="text-lg text-muted-foreground font-sans">{t('subtitle')}</p>
        </div>
      ) : null}

      <form
        onSubmit={handleSubmit}
        className={cn(
          'animate-on-scroll',
          embedded ? 'bg-transparent border-0 rounded-none p-0' : 'bg-card/60 backdrop-blur-sm border border-border rounded-xl p-8'
        )}
      >
        {error ? (
          <Alert variant="destructive" className="mb-6">
            <div className="flex items-start justify-between gap-3">
              <AlertDescription className="flex-1">{error}</AlertDescription>
              <Button type="button" variant="outline" size="sm" onClick={() => setError(null)}>
                {t('error.tryAgain')}
              </Button>
            </div>
          </Alert>
        ) : null}

        <div className="mb-8">
          <h2 className="text-2xl font-bold text-foreground mb-6 font-sans">{t('form.productInfoTitle')}</h2>

          <div className="space-y-6">
            <div className="grid gap-2 sm:grid-cols-[140px_1fr] sm:items-center sm:gap-6">
              <Label htmlFor="productName" className="sm:text-right">
                {t('form.productName')} *
              </Label>
              <Input
                id="productName"
                name="productName"
                required
                maxLength={LIMITS.productName}
                placeholder={t('form.productNamePlaceholder')}
                defaultValue={initialProduct?.name ?? ''}
              />
            </div>

            <div className="grid gap-2 sm:grid-cols-[140px_1fr] sm:items-center sm:gap-6">
              <Label htmlFor="slogan" className="sm:text-right">
                {t('form.slogan')} *
              </Label>
              <Input
                id="slogan"
                name="slogan"
                required
                maxLength={LIMITS.slogan}
                placeholder={t('form.sloganPlaceholder')}
                defaultValue={initialProduct?.slogan ?? ''}
              />
            </div>

            <div className="grid gap-2 sm:grid-cols-[140px_1fr] sm:items-start sm:gap-6">
              <Label htmlFor="description" className="sm:pt-2 sm:text-right">
                {t('form.description')} *
              </Label>
              <div className="space-y-2">
                <Textarea
                  id="description"
                  name="description"
                  required
                  rows={8}
                  maxLength={LIMITS.description}
                  placeholder={t('form.descriptionPlaceholder')}
                  defaultValue={initialProduct?.description ?? ''}
                />
                <div className="text-xs text-muted-foreground">{t('form.descriptionMarkdownHint')}</div>
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-[140px_1fr] sm:items-center sm:gap-6">
              <Label htmlFor="website" className="sm:text-right">
                {t('form.website')} *
              </Label>
              <Input
                id="website"
                name="website"
                required
                type="url"
                maxLength={LIMITS.website}
                placeholder={t('form.websitePlaceholder')}
                defaultValue={initialProduct?.website ?? ''}
              />
            </div>

            <div className="grid gap-2 sm:grid-cols-[140px_1fr] sm:items-start sm:gap-6">
              <Label htmlFor="logoUrl" className="sm:pt-2 sm:text-right">
                {t('form.logo')}
              </Label>
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <Input
                    key={logoFileInputKey}
                    id="logoFile"
                    name="logoFile"
                    type="file"
                    accept="image/*"
                    disabled={logoUploading}
                    onChange={(e) => void onPickLogoFile(e.target.files?.[0] ?? null)}
                    aria-label={t('form.logoUpload')}
                  />
                  <Button type="button" variant="outline" disabled={logoUploading && !logoUrl} onClick={clearLogo}>
                    {t('form.clearLogo')}
                  </Button>
                </div>
                <div className="grid gap-3 sm:grid-cols-[96px_1fr] sm:items-center">
                  <div className="w-24 h-24 rounded-lg border border-border bg-muted overflow-hidden flex items-center justify-center">
                    {logoUrl ? (
                      <div className="w-full h-full bg-center bg-cover" style={{ backgroundImage: `url(${logoUrl})` }} aria-label="logo" />
                    ) : (
                      <span className="text-xs text-muted-foreground">{t('form.logoPreview')}</span>
                    )}
                  </div>
                  <Input
                    id="logoUrl"
                    name="logoUrl"
                    type="url"
                    maxLength={LIMITS.logoUrl}
                    placeholder={t('form.logoUrlPlaceholder')}
                    value={logoUrl}
                    onChange={(e) => setLogoUrl(e.target.value)}
                    disabled={logoUploading}
                    aria-label={t('form.logoUrl')}
                  />
                </div>
                <div className="text-xs text-muted-foreground">
                  {logoUploading ? t('form.logoUploading') : t('form.logoHelp')}
                </div>
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-[140px_1fr] sm:items-center sm:gap-6">
              <Label htmlFor="category" className="sm:text-right">
                {t('form.category')} *
              </Label>
              <div>
                <Select name="category" required defaultValue={initialProduct?.category ?? undefined}>
                  <SelectTrigger aria-controls="sf-category-select-content">
                    <SelectValue placeholder={t('form.categoryPlaceholder')} />
                  </SelectTrigger>
                  <SelectContent id="sf-category-select-content">
                    {categories.map((cat) => (
                      <SelectItem key={cat} value={cat}>
                        {categoryT(cat)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-[140px_1fr] sm:items-center sm:gap-6">
              <Label htmlFor="tags" className="sm:text-right">
                {t('form.tags')}
              </Label>
              <Input
                id="tags"
                name="tags"
                maxLength={LIMITS.tags}
                placeholder={t('form.tagsPlaceholder')}
                defaultValue={(initialProduct?.tags ?? []).join(', ')}
              />
            </div>
          </div>
        </div>

        <div className="mb-8">
          <h2 className="text-2xl font-bold text-foreground mb-6 font-sans">{t('form.makerInfoTitle')}</h2>

          <div className="space-y-6">
            <div className="grid gap-2 sm:grid-cols-[140px_1fr] sm:items-center sm:gap-6">
              <Label htmlFor="makerName" className="sm:text-right">
                {t('form.makerName')} *
              </Label>
              <Input
                id="makerName"
                name="makerName"
                required
                maxLength={LIMITS.makerName}
                placeholder={t('form.makerNamePlaceholder')}
                value={makerNameValue}
                onChange={(e) => setMakerName(e.target.value)}
                readOnly={lockMakerIdentity}
              />
            </div>

            <div className="grid gap-2 sm:grid-cols-[140px_1fr] sm:items-center sm:gap-6">
              <Label htmlFor="makerEmail" className="sm:text-right">
                {t('form.makerEmail')} *
              </Label>
              <Input
                id="makerEmail"
                name="makerEmail"
                required
                type="email"
                maxLength={LIMITS.makerEmail}
                placeholder={t('form.makerEmailPlaceholder')}
                value={makerEmailValue}
                onChange={(e) => setMakerEmail(e.target.value)}
                readOnly={lockMakerIdentity}
              />
            </div>

            <div className="grid gap-2 sm:grid-cols-[140px_1fr] sm:items-center sm:gap-6">
              <Label htmlFor="makerWebsite" className="sm:text-right">
                {t('form.makerWebsite')}
              </Label>
              <Input
                id="makerWebsite"
                name="makerWebsite"
                type="url"
                maxLength={LIMITS.makerWebsite}
                placeholder={t('form.makerWebsitePlaceholder')}
                defaultValue={String(initialProduct?.maker_website ?? '')}
              />
            </div>
          </div>
        </div>

        <div className="flex justify-end">
          <Button
            type="submit"
            disabled={isSubmitting || logoUploading}
            size="lg"
            variant="default"
            className={cn(primaryButtonClassName, 'px-8 py-4 font-medium')}
          >
            {isSubmitting ? t('form.submitting') : submitLabel || t('form.submitButton')}
          </Button>
        </div>
      </form>
    </div>
  );
}
