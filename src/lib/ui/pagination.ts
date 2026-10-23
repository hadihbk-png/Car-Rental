export type PageItem = number | "ellipsis-start" | "ellipsis-end";

/**
 * Page numbers to show, e.g. (6, 20) -> [1, "ellipsis-start", 5, 6, 7, "ellipsis-end", 20].
 * Always returns the same number of slots once pageCount is large enough (no layout jump).
 */
export function paginationRange(page: number, pageCount: number, siblings = 1): PageItem[] {
  if (pageCount <= 0) return [];
  const current = Math.min(Math.max(1, Math.trunc(page)), pageCount);
  const totalSlots = siblings * 2 + 5; // first, last, current, 2 ellipses
  if (pageCount <= totalSlots) {
    return Array.from({ length: pageCount }, (_, i) => i + 1);
  }
  const leftSibling = Math.max(current - siblings, 1);
  const rightSibling = Math.min(current + siblings, pageCount);
  const showLeftDots = leftSibling > 3;
  const showRightDots = rightSibling < pageCount - 2;
  const edgeCount = 3 + 2 * siblings;

  if (!showLeftDots && showRightDots) {
    return [...Array.from({ length: edgeCount }, (_, i) => i + 1), "ellipsis-end", pageCount];
  }
  if (showLeftDots && !showRightDots) {
    return [
      1,
      "ellipsis-start",
      ...Array.from({ length: edgeCount }, (_, i) => pageCount - edgeCount + 1 + i),
    ];
  }
  const middle = Array.from({ length: rightSibling - leftSibling + 1 }, (_, i) => leftSibling + i);
  return [1, "ellipsis-start", ...middle, "ellipsis-end", pageCount];
}
