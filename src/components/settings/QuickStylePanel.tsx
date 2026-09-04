import type { NoteFont, PaperStyle, Settings } from "../../domain/types";
import { NOTE_FONTS, PAPER_STYLES, READING_FONTS } from "../../domain/types";
import { IconX } from "../ui/icons";

interface Props {
  open: boolean;
  onClose: () => void;
  settings: Settings;
  onPatch: (patch: Partial<Settings>) => void;
}

const READING_SIZES = [15, 16, 17, 18, 20, 22];
const NOTE_SIZES = [15, 17, 19, 21, 24];
const THEMES = [
  { key: "light", label: "Light", bg: "#f4ecd8", sheet: "#faf4e3" },
  { key: "dark", label: "Dark", bg: "#3a3226", sheet: "#453b2b" },
  { key: "black", label: "Black", bg: "#000000", sheet: "#000000" },
  { key: "system", label: "System", bg: "#f4ecd8", sheet: "#3a3226" },
] as const;

/**
 * Quick-access style sidebar: paper, hands and type sizes without leaving the
 * document. Reads/writes the exact same settings state as the full Settings page.
 */
export default function QuickStylePanel({ open, onClose, settings, onPatch }: Props) {
  return (
    <>
      {/* 
        TIP: If the dark backdrop is obscuring your view of the document while the panel is open, 
        you can make it transparent by adding `!bg-transparent` to the className below, 
        or remove this div entirely to see the live preview clearly.
      */}
      {open && <div className="slideover-backdrop no-print" onClick={onClose} aria-hidden="true" />}
      
      <div className={`slideover no-print ${open ? "open" : ""}`} role="dialog" aria-label="Quick style">
        <div className="flex items-center justify-between px-5 pt-5">
          <h2 className="font-display text-xl font-bold text-ink">Quick style</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close quick style">
            <IconX size={16} />
          </button>
        </div>
        <p className="px-5 pt-1 text-[0.7rem] leading-relaxed text-ink-faint">
          Applied to the reading surface only — the full desk lives in Settings.
        </p>

        <div className="space-y-6 px-5 py-5">
          <section>
            <p className="mb-2 text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-ink-faint">Theme</p>
            <div className="grid grid-cols-2 gap-2">
              {THEMES.map((theme) => {
                const on = settings.theme === theme.key;
                return (
                  <button
                    key={theme.key}
                    onClick={() => onPatch({ theme: theme.key })}
                    aria-pressed={on}
                    className={`rounded-md border p-1.5 text-left transition-all hover:-translate-y-0.5 ${
                      on ? "border-accent shadow" : "border-line hover:border-ink-faint"
                    }`}
                  >
                    <span
                      className="relative block h-9 overflow-hidden rounded-sm border border-[rgba(var(--shadow-ink),0.15)]"
                      style={{ background: theme.bg }}
                    >
                      <span className="absolute left-1 top-1 h-7 w-[70%] rounded-sm" style={{ background: theme.sheet }} />
                      {theme.key === "system" && (
                        <span className="absolute inset-y-0 right-0 w-1/2" style={{ background: "#3a3226" }} />
                      )}
                    </span>
                    <span className="mt-0.5 block text-center text-[0.58rem] font-semibold text-ink-soft">{theme.label}</span>
                  </button>
                );
              })}
            </div>
          </section>

          <section>
            <p className="mb-2 text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-ink-faint">
              Paper
            </p>

            <div className="grid grid-cols-4 gap-2">
              {PAPER_STYLES.map((p) => {
                const on = settings.paperStyle === p.key;

                return (
                  <button
                    key={p.key}
                    onClick={() => onPatch({ paperStyle: p.key as PaperStyle })}
                    aria-pressed={on}
                    className={`rounded-md border p-1 transition-all hover:-translate-y-0.5 ${
                      on ? "border-accent shadow" : "border-line hover:border-ink-faint"
                    }`}
                  >
                    <span
                      className={`relative block h-9 w-full overflow-hidden rounded-sm border border-[rgba(var(--shadow-ink),0.15)] paper-swatch ${
                        p.key === "plain" ? "" : `paper-${p.key}`
                      }`}
                    >
                      {/* Tiny fake text lines */}
                      <span className="absolute left-1.5 top-2 h-[2px] w-6 rounded bg-[rgba(var(--shadow-ink),0.22)]" />
                      <span className="absolute left-1.5 top-[13px] h-[2px] w-4 rounded bg-[rgba(var(--shadow-ink),0.16)]" />
                    </span>

                    <span className="mt-0.5 block text-center text-[0.58rem] font-semibold text-ink-soft">
                      {p.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          <section>
            <p className="mb-2 text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-ink-faint">Reading font</p>
            <div className="grid grid-cols-2 gap-2">
              {READING_FONTS.map((font) => {
                const on = settings.readingFont === font.key;
                return (
                  <button
                    key={font.key}
                    onClick={() => onPatch({ readingFont: font.key })}
                    aria-pressed={on}
                    className={`rounded-md border px-2 py-1.5 text-left transition-all hover:-translate-y-0.5 ${
                      on ? "border-accent bg-[rgba(var(--shadow-ink),0.05)]" : "border-line hover:border-ink-faint"
                    }`}
                  >
                    <span className="block text-lg leading-none text-ink" style={{ fontFamily: font.css }}>Aa</span>
                    <span className="mt-0.5 block truncate text-[0.56rem] font-semibold text-ink-faint">{font.label}</span>
                  </button>
                );
              })}
            </div>
          </section>

          <section>
            <p className="mb-2 text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-ink-faint">Note hand</p>
            <div className="grid grid-cols-3 gap-2">
              {NOTE_FONTS.map((f) => {
                const on = settings.defaultNoteFont === (f.key as NoteFont);
                return (
                  <button
                    key={f.key}
                    onClick={() => onPatch({ defaultNoteFont: f.key as NoteFont })}
                    aria-pressed={on}
                    className={`rounded-md border px-2 py-1.5 transition-all hover:-translate-y-0.5 ${
                      on ? "border-accent bg-[rgba(var(--shadow-ink),0.05)]" : "border-line hover:border-ink-faint"
                    }`}
                  >
                    <span className="block text-lg leading-none text-ink" style={{ fontFamily: f.css }}>
                      Aa
                    </span>
                    <span className="mt-0.5 block truncate text-[0.56rem] font-semibold text-ink-faint">{f.label}</span>
                  </button>
                );
              })}
            </div>
          </section>

          <section>
            <p className="mb-2 text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-ink-faint">Reading size</p>
            <div className="flex flex-wrap gap-1.5">
              {READING_SIZES.map((px) => (
                <button
                  key={px}
                  onClick={() => onPatch({ readingFontSize: px })}
                  aria-pressed={settings.readingFontSize === px}
                  className={`rounded-md border px-2.5 py-1 text-xs font-semibold transition-colors ${
                    settings.readingFontSize === px
                      ? "border-accent bg-accent text-[var(--paper)]"
                      : "border-line text-ink-soft hover:border-ink-faint"
                  }`}
                >
                  {px}
                </button>
              ))}
            </div>
          </section>

          <section>
            <p className="mb-2 text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-ink-faint">Note size</p>
            <div className="flex flex-wrap gap-1.5">
              {NOTE_SIZES.map((px) => (
                <button
                  key={px}
                  onClick={() => onPatch({ noteFontSize: px })}
                  aria-pressed={settings.noteFontSize === px}
                  className={`rounded-md border px-2.5 py-1 text-xs font-semibold transition-colors ${
                    settings.noteFontSize === px
                      ? "border-accent bg-accent text-[var(--paper)]"
                      : "border-line text-ink-soft hover:border-ink-faint"
                  }`}
                >
                  {px}
                </button>
              ))}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}