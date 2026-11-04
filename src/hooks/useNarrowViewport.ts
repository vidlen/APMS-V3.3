import { useEffect, useState } from "react";

// Below this width, workspace/admin tabs switch to a short label and panels
// default to collapsed/full-width. Keep this in sync with Home.tsx's own
// copy of the constant - raised from 640 after measuring that the
// full-label tab bar alone needs 826px of viewport including its padding
// (five equal-column tabs in Plus Jakarta Sans, measured 4 Nov 2026).
const NARROW_BREAKPOINT = 940;

function isNarrow(): boolean {
  return typeof window !== "undefined" && window.innerWidth < NARROW_BREAKPOINT;
}

export function useNarrowViewport(): boolean {
  const [narrow, setNarrow] = useState(isNarrow);

  useEffect(() => {
    const onResize = () => setNarrow(isNarrow());
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return narrow;
}
