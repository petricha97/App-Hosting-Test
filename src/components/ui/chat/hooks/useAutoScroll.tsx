/**
 * useAutoScroll
 *
 * Custom hook that manages auto-scroll behaviour in the chat message list.
 * Attaches to a scrollable container and:
 *   - Automatically scrolls to the bottom when new messages arrive
 *   - Pauses auto-scroll if the user manually scrolls up (so they can read)
 *   - Re-enables auto-scroll once the user scrolls back to the bottom
 *   - Shows a "scroll to bottom" button when the user is not at the bottom
 *
 * @param options.offset  - How many px from the bottom counts as "at bottom" (default 20)
 * @param options.smooth  - Whether to use smooth scroll animation (default false)
 * @param options.content - Pass `children` here so the hook reacts to new messages
 *
 * @returns scrollRef         - Attach this ref to the scrollable <div>
 * @returns isAtBottom        - True when the scroll position is near the bottom
 * @returns autoScrollEnabled - True when auto-scroll is active
 * @returns scrollToBottom    - Programmatically scroll to the bottom
 * @returns disableAutoScroll - Called on wheel/touch to pause auto-scroll
 */

import { useCallback, useEffect, useRef, useState } from "react";

interface ScrollState {
  isAtBottom: boolean;
  autoScrollEnabled: boolean;
}

interface UseAutoScrollOptions {
  offset?: number;
  smooth?: boolean;
  content?: React.ReactNode;
}

export function useAutoScroll(options: UseAutoScrollOptions = {}) {
  const { offset = 20, smooth = false, content } = options;

  /** Ref attached to the scrollable container element */
  const scrollRef = useRef<HTMLDivElement>(null);

  /** Tracks the last known scroll height to detect new content */
  const lastContentHeight = useRef(0);

  /** True when the user has manually scrolled up */
  const userHasScrolled = useRef(false);

  const [scrollState, setScrollState] = useState<ScrollState>({
    isAtBottom: true,
    autoScrollEnabled: true,
  });

  /** Returns true if the element is scrolled within `offset` px of the bottom */
  const checkIsAtBottom = useCallback(
    (element: HTMLElement) => {
      const { scrollTop, scrollHeight, clientHeight } = element;
      const distanceToBottom = Math.abs(
        scrollHeight - scrollTop - clientHeight,
      );
      return distanceToBottom <= offset;
    },
    [offset],
  );

  /** Scrolls the container to the very bottom.
   *  Pass instant=true to jump without animation (used on first load). */
  const scrollToBottom = useCallback(
    (instant?: boolean) => {
      if (!scrollRef.current) return;
      const targetScrollTop =
        scrollRef.current.scrollHeight - scrollRef.current.clientHeight;

      if (instant) {
        scrollRef.current.scrollTop = targetScrollTop;
      } else {
        scrollRef.current.scrollTo({
          top: targetScrollTop,
          behavior: smooth ? "smooth" : "auto",
        });
      }

      setScrollState({ isAtBottom: true, autoScrollEnabled: true });
      userHasScrolled.current = false;
    },
    [smooth],
  );

  /** Updates isAtBottom state and re-enables auto-scroll when user returns to bottom */
  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return;
    const atBottom = checkIsAtBottom(scrollRef.current);
    setScrollState((prev) => ({
      isAtBottom: atBottom,
      autoScrollEnabled: atBottom ? true : prev.autoScrollEnabled,
    }));
  }, [checkIsAtBottom]);

  // Attach the scroll listener
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    element.addEventListener("scroll", handleScroll, { passive: true });
    return () => element.removeEventListener("scroll", handleScroll);
  }, [handleScroll]);

  // Scroll to bottom whenever new content (messages) are added
  useEffect(() => {
    const scrollElement = scrollRef.current;
    if (!scrollElement) return;
    const currentHeight = scrollElement.scrollHeight;
    const hasNewContent = currentHeight !== lastContentHeight.current;
    if (hasNewContent) {
      if (scrollState.autoScrollEnabled) {
        requestAnimationFrame(() => {
          scrollToBottom(lastContentHeight.current === 0);
        });
      }
      lastContentHeight.current = currentHeight;
    }
  }, [content, scrollState.autoScrollEnabled, scrollToBottom]);

  // Also scroll to bottom if the container itself is resized (e.g. window resize)
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const resizeObserver = new ResizeObserver(() => {
      if (scrollState.autoScrollEnabled) scrollToBottom(true);
    });
    resizeObserver.observe(element);
    return () => resizeObserver.disconnect();
  }, [scrollState.autoScrollEnabled, scrollToBottom]);

  /** Called on wheel/touch — disables auto-scroll only if the user has scrolled up */
  const disableAutoScroll = useCallback(() => {
    const atBottom = scrollRef.current
      ? checkIsAtBottom(scrollRef.current)
      : false;
    if (!atBottom) {
      userHasScrolled.current = true;
      setScrollState((prev) => ({ ...prev, autoScrollEnabled: false }));
    }
  }, [checkIsAtBottom]);

  return {
    scrollRef,
    isAtBottom: scrollState.isAtBottom,
    autoScrollEnabled: scrollState.autoScrollEnabled,
    scrollToBottom: () => scrollToBottom(false),
    disableAutoScroll,
  };
}
