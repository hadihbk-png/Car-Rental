"use client";

import Image from "next/image";
import { useState } from "react";
import { cn } from "@/lib/ui/cn";
import { CarIcon } from "@/components/ui/icons";

export function PhotoGallery({ photos, name }: { photos: string[]; name: string }) {
  const [index, setIndex] = useState(0);
  if (photos.length === 0) {
    return (
      <div className="flex aspect-[16/10] items-center justify-center rounded-2xl bg-gradient-to-br from-brand-50 to-surface-muted text-brand-300" role="img" aria-label={`No photos of ${name} yet`}>
        <CarIcon size={96} strokeWidth={1.2} />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="relative aspect-[16/10] overflow-hidden rounded-2xl bg-surface-muted">
        <Image
          src={photos[index]}
          alt={`${name}, photo ${index + 1} of ${photos.length}`}
          fill
          preload={index === 0}
          sizes="(min-width: 1024px) 760px, 100vw"
          className="object-cover"
        />
      </div>
      {photos.length > 1 && (
        <ul className="flex gap-2 overflow-x-auto pb-1" aria-label="Photos">
          {photos.map((src, i) => (
            <li key={src} className="shrink-0">
              <button
                type="button"
                onClick={() => setIndex(i)}
                aria-label={`Show photo ${i + 1}`}
                aria-pressed={i === index}
                className={cn(
                  "relative block h-16 w-24 overflow-hidden rounded-lg ring-2 transition",
                  i === index ? "ring-brand-700" : "ring-transparent hover:ring-line-strong",
                )}
              >
                <Image src={src} alt="" fill sizes="96px" className="object-cover" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
