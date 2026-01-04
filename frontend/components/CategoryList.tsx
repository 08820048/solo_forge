'use client';

import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';

const categories = [
  { id: 'ai', icon: 'AI' },
  { id: 'productivity', icon: '⏱️' },
  { id: 'developer', icon: 'Code' },
  { id: 'design', icon: 'Design' },
  { id: 'marketing', icon: '📊' },
  { id: 'finance', icon: '💵' },
  { id: 'education', icon: '📖' },
  { id: 'health', icon: '💪' },
];

export default function CategoryList() {
  const t = useTranslations('categories');
  const homeT = useTranslations('home.categories');

  return (
    <div>
      <div className="text-center mb-12">
        <h2 className="text-3xl font-bold text-foreground mb-4">{homeT('title')}</h2>
        <p className="text-lg text-muted-foreground">{homeT('subtitle')}</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {categories.map((category) => (
          <Link
            key={category.id}
            href={{ pathname: '/products', query: { category: category.id } }}
            className="group"
          >
            <div className="bg-card/60 backdrop-blur rounded-lg border border-border hover:bg-card transition-all p-6 text-center">
              <div className="w-16 h-16 mx-auto mb-4 bg-secondary rounded-lg flex items-center justify-center text-secondary-foreground font-semibold text-sm transform group-hover:scale-110 transition-transform">
                {category.icon}
              </div>
              <h3 className="text-lg font-semibold text-foreground group-hover:text-foreground/80 transition-colors">
                {t(category.id)}
              </h3>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
