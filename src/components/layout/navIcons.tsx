/** Shared LeftNav / product-rail icons — reuse across product sidebars. */

export function IconSpeechBubble({
  active = false,
  size = 20,
}: {
  active?: boolean;
  size?: number;
}) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden>
      <path
        d="M3.5 5a1.5 1.5 0 0 1 1.5-1.5h10A1.5 1.5 0 0 1 16.5 5v5.5a1.5 1.5 0 0 1-1.5 1.5H8.5L5 16.5V12H5A1.5 1.5 0 0 1 3.5 10.5V5z"
        fill={active ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}
