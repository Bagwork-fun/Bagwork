export function BagworkLogo({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 48 48"
      fill="none"
      aria-hidden
      className={className}
    >
      <path
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M31 20v-2.5c0-2.8-2.2-5-5-5s-5 2.2-5 5V20M24 12.5v2"
      />
      <path
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M16 27h18M22 14.5a2 2 0 0 1 4 0"
      />
      <path
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M33 22.5c2.5 1.2 4 3.5 4 6.5v9.5"
      />
    </svg>
  );
}
