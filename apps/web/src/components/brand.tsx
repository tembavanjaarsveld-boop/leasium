import { cn } from "@/lib/utils";

export function LeasiumMark({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={cn("h-9 w-9", className)}
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect width="40" height="40" rx="8" fill="#0E5A78" />
      <path
        d="M12 11.5C12 10.672 12.672 10 13.5 10H25.2L30 14.8V28.5C30 29.328 29.328 30 28.5 30H13.5C12.672 30 12 29.328 12 28.5V11.5Z"
        fill="#F8FBFC"
      />
      <path d="M25 10.5V15H29.5" stroke="#A7F3D0" strokeWidth="1.6" />
      <path d="M17 17H24" stroke="#0E5A78" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M17 21H26" stroke="#0E5A78" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M17 25H22" stroke="#0E5A78" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M11 30H30" stroke="#A7F3D0" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
