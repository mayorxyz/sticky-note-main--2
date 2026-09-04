import { useEffect, useState, type PointerEvent, type RefObject } from "react";
import type { Note, NoteInk } from "../../domain/types";
import StickyNote from "./StickyNote";

interface RailProps {
  notes: Note[];
  snippetFor: (noteId: string) => string | undefined;
  onPatch: (id: string, patch: Partial<Note>) => void;
  onDelete: (id: string) => void;
  // ADD noteEl here too
  onLift?: (e: PointerEvent, noteId: string, noteEl: HTMLElement) => void;
  hideId?: string;
  emptyHint?: string;
}

/** The margin column on desktop; collapses to a horizontal-scroll strip below the doc on mobile. */
export function MarginRail({ notes, snippetFor, onPatch, onDelete, onLift, hideId, emptyHint }: RailProps) {
  return (
    <div
      data-margin-rail
      className="pa-notes flex w-full shrink-0 flex-row gap-4 overflow-x-auto pb-2
                 lg:w-60 lg:flex-col lg:gap-6 lg:overflow-visible lg:pt-1 xl:w-72"
      aria-label="Margin notes"
    >
      {notes.length === 0 && (
        <p className="w-full shrink-0 rounded-lg border border-dashed border-line px-3 py-4 text-center text-xs italic leading-relaxed text-ink-faint">
          {emptyHint ?? "Margin notes land here, tied to their passage with a thread of ink."}
        </p>
      )}
      {notes.map((n) => (
        <div
          key={n.id}
          className="w-64 shrink-0 lg:w-auto"
          style={{ visibility: n.id === hideId ? "hidden" : undefined }}
        >
          <StickyNote
            note={n}
            snippet={snippetFor(n.id)}
            onPatch={onPatch}
            onDelete={onDelete}
            onLiftPointerDown={onLift}
          />
        </div>
      ))}
    </div>
  );
}

const INK_STROKE: Record<NoteInk, string> = {
  blue: "var(--ink-blue-ui)",
  red: "var(--ink-red-ui)",
  pencil: "var(--ink-pencil-ui)",
};

interface ConnectorProps {
  containerRef: RefObject<HTMLDivElement | null>;
  scrollerRef: RefObject<HTMLElement | null>;
  notes: Note[];
  revision: number;
  /** connectors only make geometric sense in the side-by-side desktop layout */
  enabled?: boolean;
}

export function ConnectorLayer({ containerRef, scrollerRef, notes, revision, enabled = true }: ConnectorProps) {
  const [paths, setPaths] = useState<{ id: string; d: string; color: string }[]>([]);

  useEffect(() => {
    if (!enabled) {
      setPaths([]);
      return;
    }
    let raf = 0;
    const compute = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const root = containerRef.current;
        if (!root) {
          setPaths([]);
          return;
        }
        const rootRect = root.getBoundingClientRect();
        const next: { id: string; d: string; color: string }[] = [];
        for (const note of notes) {
          if (note.placement !== "margin" || !note.highlightId) continue;
          const noteEl = root.querySelector(`[data-note-anchor="${note.id}"]`);
          const markEl = root.querySelector(
            `[data-hlid="${note.highlightId}"], [data-lh="${note.highlightId}"]`
          );
          if (!noteEl || !markEl) continue;
          const a = markEl.getBoundingClientRect();
          const b = noteEl.getBoundingClientRect();
          // Skip drawing if the note isn't actually beside the mark (e.g. stacked mobile layout) —
          // guards against wildly wrong curves when the rail has wrapped below the content.
          if (b.top < a.top - 400 || Math.abs(b.left - a.right) > root.clientWidth) continue;
          const x1 = a.right - rootRect.left + 2;
          const y1 = a.top + a.height / 2 - rootRect.top;
          const x2 = b.left - rootRect.left - 4;
          const y2 = b.top - rootRect.top + 18;
          const cx = x1 + Math.max(26, (x2 - x1) * 0.55);
          const d =
            `M ${(x1 + 6).toFixed(1)} ${(y1 - 3.4).toFixed(1)} L ${x1.toFixed(1)} ${y1.toFixed(1)} L ${(x1 + 6).toFixed(1)} ${(y1 + 3.4).toFixed(1)}` +
            ` M ${x1.toFixed(1)} ${y1.toFixed(1)} C ${cx.toFixed(1)} ${y1.toFixed(1)}, ${cx.toFixed(1)} ${y2.toFixed(1)}, ${x2.toFixed(1)} ${y2.toFixed(1)}`;
          next.push({ id: note.id, color: INK_STROKE[note.ink], d });
        }
        setPaths(next);
      });
    };
    compute();
    const scroller = scrollerRef.current;
    scroller?.addEventListener("scroll", compute, { passive: true });
    window.addEventListener("resize", compute);
    const ro = new ResizeObserver(compute);
    if (containerRef.current) ro.observe(containerRef.current);
    return () => {
      cancelAnimationFrame(raf);
      scroller?.removeEventListener("scroll", compute);
      window.removeEventListener("resize", compute);
      ro.disconnect();
    };
  }, [notes, containerRef, scrollerRef, revision, enabled]);

  if (!enabled) return null;

  return (
    <svg
      className="pa-connectors pointer-events-none absolute inset-0 z-20 hidden h-full w-full overflow-visible lg:block"
      aria-hidden="true"
    >
      {paths.map((p) => (
        <path
          key={p.id}
          d={p.d}
          fill="none"
          stroke={p.color}
          strokeWidth="1.1"
          strokeDasharray="0.5 5"
          strokeLinecap="round"
          opacity="0.55"
        />
      ))}
    </svg>
  );
}