import { cn } from "@/lib/utils";

export function LeasiumMark({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={cn("h-10 w-10 shrink-0", className)}
      viewBox="0 0 128 128"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect width="128" height="128" rx="32" fill="#245BFF" />
      <rect x="36" y="36" width="16" height="64" rx="8" fill="#FFFFFF" />
      <rect x="36" y="84" width="56" height="16" rx="8" fill="#FFFFFF" />
      <circle cx="94" cy="38" r="12" fill="#27D8C2" />
    </svg>
  );
}
