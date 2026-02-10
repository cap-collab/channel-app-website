'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useState } from 'react';
import { CuratorRec } from '@/types';

interface CuratorRecCardProps {
  rec: CuratorRec;
}

export function CuratorRecCard({ rec }: CuratorRecCardProps) {
  const [imageError, setImageError] = useState(false);

  const cleanUrl = rec.url ? rec.url.replace(/^https?:\/\//, '').replace(/\/$/, '') : '';
  const domain = rec.url ? rec.url.replace(/^https?:\/\//, '').split('/')[0].replace(/^www\./, '') : '';
  // Prefer DJ-uploaded image, fall back to OG image
  const imageUrl = rec.imageUrl || rec.ogImage;
  const hasPhoto = imageUrl && !imageError;
  // Prefer DJ-provided title, fall back to OG title
  const displayTitle = rec.title || rec.ogTitle;

  const typeBadge = () => {
    if (rec.type === 'irl') {
      return (
        <>
          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" />
          </svg>
          IRL
        </>
      );
    }
    if (rec.type === 'online') {
      return (
        <>
          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
            <path d="M21 6h-7.59l3.29-3.29L16 2l-4 4-4-4-.71.71L10.59 6H3c-1.1 0-2 .89-2 2v12c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V8c0-1.11-.9-2-2-2zm0 14H3V8h18v12z" />
          </svg>
          Online
        </>
      );
    }
    // Default: music
    return (
      <>
        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm0-12.5c-2.49 0-4.5 2.01-4.5 4.5s2.01 4.5 4.5 4.5 4.5-2.01 4.5-4.5-2.01-4.5-4.5-4.5zm0 5.5c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1z" />
        </svg>
        Music
      </>
    );
  };

  const cardContent = (
    <>
      {hasPhoto ? (
        <>
          <Image
            src={imageUrl}
            alt={displayTitle || rec.djName}
            fill
            className="object-cover"
            unoptimized
            onError={() => setImageError(true)}
          />
          <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-transparent to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-tr from-black/60 via-transparent to-transparent" />
        </>
      ) : (
        <div className="w-full h-full flex items-center justify-center bg-[#D94099]">
          <span className="text-2xl font-black uppercase tracking-tight text-white text-center px-4">
            {displayTitle || domain}
          </span>
        </div>
      )}
      <div className="absolute top-2 left-2 right-2 flex items-center justify-between">
        <span className="text-[10px] font-mono text-white uppercase tracking-tighter flex items-center gap-1 drop-shadow-lg">
          {typeBadge()}
        </span>
      </div>
      {displayTitle && hasPhoto && (
        <div className="absolute bottom-2 left-2 right-12">
          <span className="text-xs font-black uppercase tracking-wider text-white drop-shadow-lg line-clamp-2">
            {displayTitle}
          </span>
        </div>
      )}
    </>
  );

  return (
    <div className="w-full group flex flex-col h-full">
      <div className="flex items-center mb-1 h-4 px-0.5">
        <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-tighter">
          REC&apos;D BY {rec.djName.toUpperCase()}
        </span>
      </div>
      <div className="relative">
        {rec.url ? (
          <a
            href={rec.url}
            target="_blank"
            rel="noopener noreferrer"
            className="block relative w-full aspect-[16/9] overflow-hidden border border-white/10"
          >
            {cardContent}
          </a>
        ) : (
          <div className="block relative w-full aspect-[16/9] overflow-hidden border border-white/10">
            {cardContent}
          </div>
        )}
        {rec.djPhotoUrl && (
          <div className="absolute -bottom-4 right-3 w-8 h-8 rounded border border-white/30 overflow-hidden bg-black z-10">
            <Image
              src={rec.djPhotoUrl}
              alt={rec.djName}
              fill
              className="object-contain"
              unoptimized
            />
          </div>
        )}
      </div>

      <div className="flex flex-col justify-start py-2">
        <h3 className="text-sm font-bold leading-tight truncate">
          {rec.url ? (
            <a href={rec.url} target="_blank" rel="noopener noreferrer" className="hover:underline">
              {displayTitle || cleanUrl}
            </a>
          ) : (
            <span>{displayTitle}</span>
          )}
        </h3>
      </div>

      {/* Action Buttons */}
      <div className="space-y-2 mt-auto pt-2">
        <div className="flex gap-2">
          <Link
            href={`/dj/${rec.djUsername}#chat`}
            className="flex-1 py-2 px-4 rounded text-sm font-semibold transition-colors bg-white hover:bg-gray-100 text-gray-900 text-center whitespace-nowrap truncate"
          >
            Chat with {rec.djName}
          </Link>
          {rec.url && (
            <a
              href={rec.url}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 py-2 px-4 rounded text-sm font-semibold transition-colors bg-white/10 hover:bg-white/20 text-white flex items-center justify-center gap-2"
            >
              Visit Link
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
