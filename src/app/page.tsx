import WasmoApp from '@/components/WasmoApp';
import { getVideos } from '@/lib/supabase';
import { buildWebsiteJsonLd, jsonLdScript } from '@/lib/seo';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://gaa.gabeyre80.workers.dev';

export default async function Page() {
  const { videos, source } = await getVideos(24);

  // Home JSON-LD: WebSite (+ SearchAction) + ItemList of all videos so the
  // initial server-rendered HTML carries complete structured data for crawlers.
  const website = buildWebsiteJsonLd();
  const itemList = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'Wasmo videos',
    numberOfItems: videos.length,
    itemListElement: videos.map((v, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      url: `${SITE_URL}/watch/${v.slug}`,
      name: v.title,
    })),
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript([website, itemList])! }} />
      <WasmoApp initialVideos={videos} />
      {/* Data-source debug marker — remove once Supabase schema is applied */}
      <div className="sr-only" data-source={source} aria-hidden="true" />
    </>
  );
}
