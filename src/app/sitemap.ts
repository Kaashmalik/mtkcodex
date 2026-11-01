import type { MetadataRoute } from 'next';
import { site } from '@/data/site';
import { products } from '@/data/products';
import { services } from '@/data/services';
import { industries } from '@/data/content';
import { getPosts } from '@/lib/blog';

export default function sitemap(): MetadataRoute.Sitemap {
  const pages = ['', '/platform', '/products', '/services', '/industries', '/customers', '/pricing', '/about', '/blog', '/careers', '/contact', '/privacy', '/terms', '/cookies', '/disclaimer', '/locations', '/locations/lahore'];
  const lastModified = new Date();
  const entry = (path: string, priority: number) => ({ url: `${site.url}${path}`, lastModified, changeFrequency: 'monthly' as const, priority });
  return [
    ...pages.map((p) => entry(p, p === '' ? 1 : 0.8)),
    ...products.map((p) => entry(`/products/${p.slug}`, 0.7)),
    ...services.map((s) => entry(`/services/${s.id}`, 0.7)),
    ...industries.map((i) => entry(`/industries/${i.id}`, 0.6)),
    ...getPosts().map((p) => entry(`/blog/${p.slug}`, 0.5)),
  ];
}
