import type { MetadataRoute } from 'next';
import { site } from '@/data/site';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/api/', '/admin', '/admin/', '/go/'] }],
    sitemap: `${site.url}/sitemap.xml`,
    host: site.url,
  };
}
