import { Suspense } from 'react';
import { cookies } from 'next/headers';
import { makeOG } from '@/lib/og';
import { ChannelClient } from './ChannelClient';
import { getHeroArchives } from '@/lib/hero-archives';

export const metadata = makeOG();
export const revalidate = 60;

// Preview gate: /radio shows the "offline" state unless the visitor has the
// `channel-preview` cookie or a matching `?preview=<PREVIEW_TOKEN>` query param.
// Query param sets the cookie, so bookmarking `/radio?preview=<token>` once is enough.
// To launch: delete this gate + the `forceOffline` prop in ChannelClient.
export default async function ChannelPage({
  searchParams,
}: {
  searchParams: Promise<{ preview?: string }>;
}) {
  const [initialHeroArchives, cookieStore, params] = await Promise.all([
    getHeroArchives(),
    cookies(),
    searchParams,
  ]);
  const token = process.env.PREVIEW_TOKEN;
  const previewAllowed =
    !!token &&
    (params.preview === token || cookieStore.get('channel-preview')?.value === token);
  return (
    <Suspense fallback={<div className="min-h-screen bg-black" />}>
      <ChannelClient
        initialHeroArchives={initialHeroArchives}
        forceOffline={!previewAllowed}
        previewTokenFromQuery={params.preview}
      />
    </Suspense>
  );
}
