import { getTranslations } from 'next-intl/server';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'common' });

  return {
    title: `Privacy Policy - ${t('appName')}`,
    description: t('slogan'),
    alternates: {
      canonical: `/${locale}/privacy`,
      languages: {
        en: '/en/privacy',
        zh: '/zh/privacy',
      },
    },
    openGraph: {
      type: 'article',
      title: `Privacy Policy - ${t('appName')}`,
      description: t('slogan'),
      url: `/${locale}/privacy`,
      images: [{ url: '/docs/imgs/image.jpg' }],
    },
    twitter: {
      card: 'summary',
      title: `Privacy Policy - ${t('appName')}`,
      description: t('slogan'),
      images: ['/docs/imgs/image.jpg'],
    },
  };
}

export default async function PrivacyPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const isZh = locale.toLowerCase().startsWith('zh');

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <h1 className="text-4xl font-bold text-foreground mb-8">{isZh ? '隐私政策' : 'Privacy Policy'}</h1>

      <div className="space-y-6 text-muted-foreground leading-relaxed">
        <p>
          {isZh
            ? '本隐私政策说明 SoloForge 如何收集、使用与保护你的信息。'
            : 'This Privacy Policy explains how SoloForge collects, uses, and protects your information.'}
        </p>

        <div className="rounded-xl border border-border bg-card text-card-foreground p-8 space-y-3">
          <h2 className="text-2xl font-bold text-foreground">{isZh ? '1. 我们收集的信息' : '1. Information We Collect'}</h2>
          <p>
            {isZh
              ? '当你注册/登录、提交产品、订阅邮件或提交反馈时，我们可能会收集你的邮箱、昵称、头像等信息，以及你提供的产品内容。'
              : 'When you sign up/sign in, submit listings, subscribe to newsletters, or send feedback, we may collect your email, profile details (e.g., name, avatar), and the content you provide.'}
          </p>
          <p>
            {isZh
              ? '我们也可能收集基础的日志信息（例如访问时间、页面、浏览器信息）用于安全与性能优化。'
              : 'We may also collect basic logs (e.g., access time, pages, browser information) for security and performance.'}
          </p>
        </div>

        <div className="rounded-xl border border-border bg-card text-card-foreground p-8 space-y-3">
          <h2 className="text-2xl font-bold text-foreground">{isZh ? '2. 我们如何使用信息' : '2. How We Use Information'}</h2>
          <p>
            {isZh
              ? '我们使用信息来提供与维护服务、支持登录与账号管理、展示你提交的内容、发送你订阅的邮件，以及处理反馈与合规要求。'
              : 'We use information to operate and maintain the service, support authentication and account management, display submitted content, send subscribed emails, and handle feedback and compliance needs.'}
          </p>
        </div>

        <div className="rounded-xl border border-border bg-card text-card-foreground p-8 space-y-3">
          <h2 className="text-2xl font-bold text-foreground">{isZh ? '3. 信息共享' : '3. Sharing'}</h2>
          <p>
            {isZh
              ? '我们不会出售你的个人信息。为提供服务，我们可能会与基础设施与身份认证服务提供方共享必要信息（例如托管、分析、登录服务）。'
              : 'We do not sell your personal information. To provide the service, we may share necessary information with infrastructure and authentication providers (e.g., hosting, analytics, sign-in services).'}
          </p>
          <p>
            {isZh
              ? '在法律要求或为保护服务与用户安全时，我们可能会披露必要信息。'
              : 'We may disclose information when required by law or to protect the service and users.'}
          </p>
        </div>

        <div className="rounded-xl border border-border bg-card text-card-foreground p-8 space-y-3">
          <h2 className="text-2xl font-bold text-foreground">{isZh ? '4. 数据安全' : '4. Security'}</h2>
          <p>
            {isZh
              ? '我们采取合理的技术与管理措施保护数据安全，但无法保证绝对安全。'
              : 'We take reasonable technical and organizational measures to protect data, but no system can be guaranteed 100% secure.'}
          </p>
        </div>

        <div className="rounded-xl border border-border bg-card text-card-foreground p-8 space-y-3">
          <h2 className="text-2xl font-bold text-foreground">{isZh ? '5. 你的权利' : '5. Your Rights'}</h2>
          <p>
            {isZh
              ? '你可以请求访问、更正或删除与你相关的信息；也可以取消邮件订阅。'
              : 'You may request access, correction, or deletion of your information, and you may unsubscribe from emails.'}
          </p>
        </div>

        <div className="rounded-xl border border-border bg-card text-card-foreground p-8 space-y-3">
          <h2 className="text-2xl font-bold text-foreground">{isZh ? '6. 政策更新' : '6. Updates'}</h2>
          <p>
            {isZh
              ? '我们可能会更新本隐私政策。更新后继续使用本服务即视为接受更新内容。'
              : 'We may update this Privacy Policy. Continued use of the service after updates constitutes acceptance.'}
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
