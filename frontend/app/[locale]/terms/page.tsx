import { getTranslations } from 'next-intl/server';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'common' });

  return {
    title: `Terms of Service - ${t('appName')}`,
    description: t('slogan'),
  };
}

export default async function TermsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const isZh = locale.toLowerCase().startsWith('zh');

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <h1 className="text-4xl font-bold text-foreground mb-8">{isZh ? '服务条款' : 'Terms of Service'}</h1>

      <div className="space-y-6 text-muted-foreground leading-relaxed">
        <p>
          {isZh
            ? '欢迎使用 SoloForge。使用本服务即表示你同意遵守本服务条款。若你不同意，请勿使用本服务。'
            : 'Welcome to SoloForge. By using the service, you agree to these Terms. If you do not agree, please do not use the service.'}
        </p>

        <div className="sf-wash rounded-xl border border-border bg-card text-card-foreground p-8 space-y-3">
          <h2 className="text-2xl font-bold text-foreground">{isZh ? '1. 服务说明' : '1. Service'}</h2>
          <p>
            {isZh
              ? 'SoloForge 提供产品展示、浏览与提交等功能。我们可能会不定期更新或调整功能与页面。'
              : 'SoloForge provides product discovery, listing, and submission features. We may update or modify features from time to time.'}
          </p>
        </div>

        <div className="sf-wash rounded-xl border border-border bg-card text-card-foreground p-8 space-y-3">
          <h2 className="text-2xl font-bold text-foreground">{isZh ? '2. 账号与登录' : '2. Accounts'}</h2>
          <p>
            {isZh
              ? '你应对账号下发生的活动负责，并确保登录方式与凭据的安全。若你怀疑账号被盗用，请及时停止使用并与我们联系。'
              : 'You are responsible for activity under your account and for keeping your credentials secure. If you suspect unauthorized access, stop using the service and contact us.'}
          </p>
        </div>

        <div className="sf-wash rounded-xl border border-border bg-card text-card-foreground p-8 space-y-3">
          <h2 className="text-2xl font-bold text-foreground">{isZh ? '3. 用户内容与提交' : '3. User Content'}</h2>
          <p>
            {isZh
              ? '你提交的产品信息应真实、合法且不侵犯他人权利。你授予我们在本服务内展示、缓存与分发该内容的非独占许可，以便提供与推广服务。'
              : 'You must submit accurate and lawful content that does not infringe others’ rights. You grant us a non-exclusive license to display, cache, and distribute such content within the service to operate and promote it.'}
          </p>
        </div>

        <div className="sf-wash rounded-xl border border-border bg-card text-card-foreground p-8 space-y-3">
          <h2 className="text-2xl font-bold text-foreground">{isZh ? '4. 禁止行为' : '4. Prohibited Conduct'}</h2>
          <p>
            {isZh
              ? '禁止以任何方式干扰服务运行、尝试未授权访问、上传恶意内容、发布违法或侵权信息、或利用服务进行欺诈与滥用。'
              : 'Do not interfere with the service, attempt unauthorized access, upload malicious content, post unlawful or infringing material, or use the service for fraud or abuse.'}
          </p>
        </div>

        <div className="sf-wash rounded-xl border border-border bg-card text-card-foreground p-8 space-y-3">
          <h2 className="text-2xl font-bold text-foreground">{isZh ? '5. 免责声明' : '5. Disclaimer'}</h2>
          <p>
            {isZh
              ? '本服务按“现状”提供。我们不对内容的准确性、可用性或特定用途适用性作出保证。你理解并同意自行承担使用风险。'
              : 'The service is provided “as is”. We do not guarantee accuracy, availability, or fitness for a particular purpose. You use the service at your own risk.'}
          </p>
        </div>

        <div className="sf-wash rounded-xl border border-border bg-card text-card-foreground p-8 space-y-3">
          <h2 className="text-2xl font-bold text-foreground">{isZh ? '6. 条款变更' : '6. Changes'}</h2>
          <p>
            {isZh
              ? '我们可能会更新本条款。更新后继续使用本服务即视为接受更新内容。'
              : 'We may update these Terms. Continued use of the service after updates constitutes acceptance.'}
          </p>
        </div>

        <p className="text-sm">
          {isZh ? '联系邮箱：' : 'Contact: '}
          <a className="text-primary underline underline-offset-4" href="mailto:ilikexff@gmail.com">
            ilikexff@gmail.com
          </a>
        </p>
      </div>
    </div>
  );
}

