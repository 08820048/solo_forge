'use client';

import { useTranslations } from 'next-intl';
import { useLocale } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/routing';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';

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

export default function SubmitForm({
  showHeader = true,
  defaultMakerName,
  defaultMakerEmail,
  lockMakerIdentity = false,
  onSubmitted,
}: {
  showHeader?: boolean;
  defaultMakerName?: string;
  defaultMakerEmail?: string;
  lockMakerIdentity?: boolean;
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

  const categories = ['ai', 'productivity', 'developer', 'design', 'marketing', 'finance', 'education', 'health', 'entertainment', 'other'];

  const makerNameValue = lockMakerIdentity ? (defaultMakerName ?? readUserFromStorage()?.name ?? makerName) : makerName;
  const makerEmailValue = lockMakerIdentity ? (defaultMakerEmail ?? readUserFromStorage()?.email ?? makerEmail) : makerEmail;

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    const formData = new FormData(e.currentTarget);

    const productData = {
      name: formData.get('productName') as string,
      slogan: formData.get('slogan') as string,
      description: formData.get('description') as string,
      website: formData.get('website') as string,
      category: formData.get('category') as string,
      tags: formData.get('tags') ? (formData.get('tags') as string).split(',').map(tag => tag.trim()).filter(tag => tag) : [],
      maker_name: makerNameValue,
      maker_email: makerEmailValue,
      maker_website: formData.get('makerWebsite') as string || undefined,
      language: locale,
    };

    try {
      const response = await fetch('/api/products', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept-Language': locale,
        },
        body: JSON.stringify(productData),
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
        <Button asChild size="lg" variant="default">
          <Link href="/">{t('success.backToHome')}</Link>
        </Button>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12 animate-on-scroll">
        <Alert variant="destructive" className="max-w-md mx-auto mb-6">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
        <Button onClick={() => setError(null)} size="lg" variant="default">
          {t('error.tryAgain')}
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

      <form onSubmit={handleSubmit} className="bg-card/60 backdrop-blur-sm border border-border rounded-xl p-8 max-w-2xl mx-auto animate-on-scroll">
        <div className="mb-8">
          <h2 className="text-2xl font-bold text-foreground mb-6 font-sans">{t('form.productInfoTitle')}</h2>

          <div className="space-y-6">
            <div>
              <Label htmlFor="productName">{t('form.productName')} *</Label>
              <Input
                id="productName"
                name="productName"
                required
                placeholder={t('form.productNamePlaceholder')}
              />
            </div>

            <div>
              <Label htmlFor="slogan">{t('form.slogan')} *</Label>
              <Input
                id="slogan"
                name="slogan"
                required
                placeholder={t('form.sloganPlaceholder')}
              />
            </div>

            <div>
              <Label htmlFor="description">{t('form.description')} *</Label>
              <Textarea
                id="description"
                name="description"
                required
                rows={5}
                placeholder={t('form.descriptionPlaceholder')}
              />
            </div>

            <div>
              <Label htmlFor="website">{t('form.website')} *</Label>
              <Input
                id="website"
                name="website"
                required
                type="url"
                placeholder={t('form.websitePlaceholder')}
              />
            </div>

            <div>
              <Label htmlFor="category">{t('form.category')} *</Label>
              <Select name="category" required>
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

            <div>
              <Label htmlFor="tags">{t('form.tags')}</Label>
              <Input
                id="tags"
                name="tags"
                placeholder={t('form.tagsPlaceholder')}
              />
            </div>
          </div>
        </div>

        <div className="mb-8">
          <h2 className="text-2xl font-bold text-foreground mb-6 font-sans">{t('form.makerInfoTitle')}</h2>

          <div className="space-y-6">
            <div>
              <Label htmlFor="makerName">{t('form.makerName')} *</Label>
              <Input
                id="makerName"
                name="makerName"
                required
                placeholder={t('form.makerNamePlaceholder')}
                value={makerNameValue}
                onChange={(e) => setMakerName(e.target.value)}
                readOnly={lockMakerIdentity}
              />
            </div>

            <div>
              <Label htmlFor="makerEmail">{t('form.makerEmail')} *</Label>
              <Input
                id="makerEmail"
                name="makerEmail"
                required
                type="email"
                placeholder={t('form.makerEmailPlaceholder')}
                value={makerEmailValue}
                onChange={(e) => setMakerEmail(e.target.value)}
                readOnly={lockMakerIdentity}
              />
            </div>

            <div>
              <Label htmlFor="makerWebsite">{t('form.makerWebsite')}</Label>
              <Input
                id="makerWebsite"
                name="makerWebsite"
                type="url"
                placeholder={t('form.makerWebsitePlaceholder')}
              />
            </div>
          </div>
        </div>

        <div className="flex justify-end">
          <Button
            type="submit"
            disabled={isSubmitting}
            size="lg"
            variant="default"
            className="px-8 py-4 font-medium"
          >
            {isSubmitting ? t('form.submitting') : t('form.submitButton')}
          </Button>
        </div>
      </form>
    </div>
  );
}
