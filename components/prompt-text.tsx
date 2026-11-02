"use client";

import { useState } from "react";
import { baseLang } from "@/lib/languages";
import { useDisplayText } from "@/lib/use-display-text";
import { Icon } from "./ui/kit";
import { useViewer } from "./viewer";

// A prompt someone is asked to answer or tell (today's question, a story
// idea, a question from the family), shown in the reader's own language.
// English shows at once; the Muse translation (cached, lib/llm.ts) swaps in
// when it arrives. Nothing waits on it: recording starts whenever they like.

/** The prompt in the viewer's display language, English until the translation lands. */
export function usePromptText(text: string, sourceLang = "en"): { text: string; lang: string } {
  const { displayLang } = useViewer();
  const { text: shown } = useDisplayText(text, sourceLang, displayLang);
  return shown ? { text: shown, lang: shown === text ? sourceLang : htmlLang(displayLang) } : { text, lang: sourceLang };
}

function htmlLang(code: string): string {
  if (code === "hi-latn") return "hi-Latn";
  return baseLang(code);
}

export function PromptText({ text, sourceLang = "en", className }: { text: string; sourceLang?: string; className?: string }) {
  const p = usePromptText(text, sourceLang);
  return (
    <span lang={p.lang} data-prompt-lang={p.lang} className={className}>
      {p.text}
    </span>
  );
}

/**
 * The prompt while someone records: always on screen, in their language. An
 * elder sees it large from the start ("Read it big"), like a teleprompter;
 * anyone can switch between large and normal with one tap.
 */
export function Teleprompter({ text, sourceLang = "en" }: { text: string; sourceLang?: string }) {
  const { viewer } = useViewer();
  const [big, setBig] = useState(viewer.role === "elder");
  const p = usePromptText(text, sourceLang);
  return (
    <div data-ui="teleprompter" data-big={big ? "1" : "0"} className="mb-1">
      {big ? (
        <p data-display lang={p.lang} className="voice m-0 max-h-[38vh] overflow-y-auto text-display leading-[1.25] text-ink">
          “{p.text}”
        </p>
      ) : (
        <p lang={p.lang} className="voice m-0 text-title leading-snug text-ink">
          “{p.text}”
        </p>
      )}
      <button type="button" onClick={() => setBig((b) => !b)} aria-pressed={big} className="press -ml-2 mt-1 flex h-11 items-center gap-1.5 rounded-full px-2 text-footnote font-semibold text-ink-soft">
        <Icon name="textSize" size={18} />
        {big ? "Smaller words" : "Read it big"}
      </button>
    </div>
  );
}
