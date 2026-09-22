const OVERFLOW_TOLERANCE_PX = 1;

export function hasHorizontalOverflow(scrollWidth: number, clientWidth: number): boolean {
  return scrollWidth > clientWidth + OVERFLOW_TOLERANCE_PX;
}

export function resolveHorizontalOverflow(
  scrollWidth: number,
  clientWidth: number,
  knownOverflow?: boolean,
): boolean {
  return knownOverflow ?? hasHorizontalOverflow(scrollWidth, clientWidth);
}
