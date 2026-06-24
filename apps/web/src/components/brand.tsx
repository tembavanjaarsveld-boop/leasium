import { useId } from "react";

import { cn } from "@/lib/utils";

// Relby open-R mark. Geometry is the approved brand source of truth:
// open rounded R (no left vertical stem) with the teal dot fixed at lower-left.
// Do not move the dot or alter the path — see the Relby logo handoff.
export function LeasiumMark({ className }: { className?: string }) {
  const gradientId = useId();
  return (
    <svg
      aria-hidden="true"
      className={cn("h-10 w-10 shrink-0", className)}
      width="40"
      height="40"
      viewBox="0 0 256 256"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2B5BFF" />
          <stop offset="1" stopColor="#123FE0" />
        </linearGradient>
      </defs>
      <rect width="256" height="256" rx="56" fill={`url(#${gradientId})`} />
      <g fill="none" strokeLinecap="round" strokeLinejoin="round">
        <path
          d="M55 60 H126 C164 60 187 84 187 119 C187 154 164 177 126 177 H55 M108 177 L186 228"
          stroke="#FFFFFF"
          strokeWidth="28"
        />
        <circle cx="58" cy="216" r="16" fill="#1DCBC1" />
      </g>
    </svg>
  );
}
