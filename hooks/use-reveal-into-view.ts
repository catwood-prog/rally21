import { useCallback, useRef } from 'react';
import { Dimensions, NativeScrollEvent, NativeSyntheticEvent, ScrollView, View } from 'react-native';

/**
 * OD1 job 4a — content revealed in place must be brought into view, above
 * the floating tab pill.
 *
 * THE CLASS, not the one card: Cat found the leave-circle confirm sitting
 * behind the pill with its Cancel and Leave buttons half-hidden. That was
 * never a clearance regression — circle.tsx pads correctly via
 * useTabBarClearance() — and it is not a modal. It is an INLINE expander
 * near the bottom of a long screen: tapping the trigger reveals new
 * content BELOW the current scroll position, so whether the pill covers
 * it is decided by wherever the person happened to be scrolled. Padding
 * cannot fix that; padding only protects the very bottom of the content,
 * and the revealed card may be nowhere near it. The revealed content has
 * to come to the reader.
 *
 * WHY MEASURED IN WINDOW COORDINATES: the expanders sit at different
 * depths (a direct child of the content container, a panel nested inside
 * the Who's Here section, a row inside the host-controls card), so an
 * onLayout `y` means something different for each one. measureInWindow is
 * the same question everywhere — "where is this on the glass?" — and the
 * pill floats against the window too, so the two are directly comparable.
 *
 * IDEMPOTENT BY DESIGN: it scrolls only when the card's bottom is
 * actually hidden, so wiring it to onLayout is safe. A card that already
 * fits is left alone, and a person who has scrolled it into view
 * themselves is never yanked.
 */

/** A little air between the revealed card and the top of the pill, so the
 * card reads as clear of it rather than touching it. */
const BREATHING_ROOM = 12;

export function useRevealIntoView(bottomInset: number) {
  const scrollRef = useRef<ScrollView | null>(null);
  const scrollOffset = useRef(0);
  const nodes = useRef(new Map<string, View>());

  /** Spread onto the ScrollView, alongside ref={scrollRef}. */
  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollOffset.current = event.nativeEvent.contentOffset.y;
  }, []);

  /** ref={captureReveal('leave-confirm')} on the revealed card. */
  const captureReveal = useCallback(
    (key: string) => (node: View | null) => {
      if (node) nodes.current.set(key, node);
      else nodes.current.delete(key);
    },
    []
  );

  /** onLayout={() => revealIntoView('leave-confirm')} on the same card. */
  const revealIntoView = useCallback(
    (key: string) => {
      const node = nodes.current.get(key);
      const scroller = scrollRef.current;
      if (!node || !scroller) return;
      node.measureInWindow((_x, top, _width, height) => {
        // A card mid-animation (or not yet laid out) measures as zero —
        // nothing useful to do, and onLayout will fire again when it is.
        if (!height) return;
        const visibleBottom = Dimensions.get('window').height - bottomInset;
        const hidden = top + height - visibleBottom;
        if (hidden <= 0) return;
        scroller.scrollTo({
          y: scrollOffset.current + hidden + BREATHING_ROOM,
          animated: true,
        });
      });
    },
    [bottomInset]
  );

  return { scrollRef, onScroll, captureReveal, revealIntoView };
}
