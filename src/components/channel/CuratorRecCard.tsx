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

  const cleanUrl = rec.url.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const imageUrl = rec.ogImage || rec.djPhotoUrl;
  const hasPhoto = imageUrl && !imageError;
  const hasOgTitle = !!rec.ogTitle;

  return (
    <div className="w-full group">
      <div className="flex items-center mb-1 h-4 px-0.5">
        <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-tighter">
          REC&apos;D BY {rec.djName.toUpperCase()}
        </span>
      </div>
      <a
        href={rec.url}
        target="_blank"
        rel="noopener noreferrer"
        className="block relative w-full aspect-[16/9] overflow-hidden border border-white/10"
      >
        {hasPhoto ? (
          <>
            <Image
              src={imageUrl}
              alt={rec.ogTitle || rec.djName}
              fill
              className="object-cover"
              unoptimized
              onError={() => setImageError(true)}
            />
            <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-transparent to-transparent" />
            <div className="absolute inset-0 bg-gradient-to-tr from-black/60 via-transparent to-transparent" />
          </>
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-purple-900 to-pink-900" />
        )}
        <div className="absolute top-2 left-2 right-2 flex items-center justify-between">
          <span className="text-[10px] font-mono text-white uppercase tracking-tighter flex items-center gap-1 drop-shadow-lg">
            {rec.type === 'event' ? (
              <>
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 2L8 8h2v3H8l-4 6h5v5h2v-5h5l-4-6h-2V8h2L12 2z" />
                </svg>
                IRL
              </>
            ) : (
              <>
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M1 9l2 2c4.97-4.97 13.03-4.97 18 0l2-2C16.93 2.93 7.08 2.93 1 9zm8 8l3 3 3-3c-1.65-1.66-4.34-1.66-6 0zm-4-4l2 2c2.76-2.76 7.24-2.76 10 0l2-2C15.14 9.14 8.87 9.14 5 13z" />
                </svg>
                Online
              </>
            )}
          </span>
        </div>
        <div className="absolute bottom-2 left-2 right-2 flex items-end gap-2">
          {rec.djPhotoUrl && (
            <Image
              src={rec.djPhotoUrl}
              alt={rec.djName}
              width={28}
              height={28}
              className="rounded-full border border-white/30 flex-shrink-0 object-cover"
              unoptimized
            />
          )}
          {hasOgTitle && (
            <span className="text-xs font-black uppercase tracking-wider text-white drop-shadow-lg line-clamp-2">
              {rec.ogTitle}
            </span>
          )}
        </div>
      </a>

      <div className="flex flex-col justify-start py-2">
        <h3 className="text-sm font-bold leading-tight truncate">
          <a href={rec.url} target="_blank" rel="noopener noreferrer" className="hover:underline">
            {cleanUrl}
          </a>
        </h3>
      </div>

      {/* Action Buttons */}
      <div className="space-y-2 mt-auto pt-2">
        <div className="flex gap-2">
          <Link
            href={`/dj/${rec.djUsername}#chat`}
            className="flex-1 py-2 px-4 rounded text-sm font-semibold transition-colors bg-white hover:bg-gray-100 text-gray-900 text-center"
          >
            Chat with {rec.djName}
          </Link>
          <a
            href={rec.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 py-2 px-4 rounded text-sm font-semibold transition-colors bg-white/10 hover:bg-white/20 text-white flex items-center justify-center gap-2"
          >
            Visit Link
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </a>
        </div>
      </div>
    </div>
  );
}
