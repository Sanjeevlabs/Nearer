"use client";

import { AnimatePresence, m } from "framer-motion";
import { useCallback, useEffect, useState } from "react";
import { callName } from "@/lib/people";
import { postJson } from "@/lib/use-json";
import { cn } from "@/lib/utils";
import { Button, Icon, type IconName } from "./ui/kit";
import { useViewer } from "./viewer";

// "Send something to Maa": three things Muse picked from the curated
// partners' own catalogues → a preview from your partner account → Send.
// Sending is always a tap by you; payment stays in the partner's own flow.

type Kind = "groceries" | "food" | "dining" | "gifts" | "home-services";

interface SuggestionView {
  id: string;
  partnerId: string;
  via: string;
  kind: Kind;
  name: string;
  price: number;
  currency: string;
  image: string | null;
  why: string;
  sample: boolean;
}

interface Address {
  id: string;
  label: string;
  line: string;
}

interface PreviewView {
  id: string;
  via: string;
  item: { name: string; quantity: number; price: number; image?: string };
  total: number;
  currency: string;
  address: Address | null;
  addresses: Address[];
  eta: string | null;
  handoff: boolean;
  sample: boolean;
}

type Result =
  | { status: "placed"; eta: string | null; sample: boolean }
  | { status: "awaiting-payment"; paymentUrl: string | null; qr: string | null }
  | { status: "handoff"; url: string };

type Step =
  | { s: "loading" }
  | { s: "error" }
  | { s: "none" }
  | { s: "list"; items: SuggestionView[]; sample: boolean; refused?: string }
  | { s: "previewing"; items: SuggestionView[]; sample: boolean; picked: SuggestionView }
  | { s: "preview"; items: SuggestionView[]; sample: boolean; picked: SuggestionView; preview: PreviewView; busy?: boolean }
  | { s: "connect"; items: SuggestionView[]; sample: boolean; account: string; name: string }
  | { s: "done"; preview: PreviewView; result: Result };

const KIND_ICON: Record<Kind, IconName> = { groceries: "basket", food: "utensils", dining: "utensils", gifts: "gift", "home-services": "wrench" };

/** The home locale of the common currencies, so a pound reads as a pound and a rupee as a rupee. */
const CURRENCY_LOCALE: Record<string, string> = { INR: "en-IN", GBP: "en-GB", USD: "en-US", CAD: "en-CA", AUD: "en-AU", EUR: "de-DE", AED: "en-AE", SGD: "en-SG" };

/** Minor units (pence, paise) in the item's own currency and locale; never a fixed locale. */
export function money(minor: number, currency: string, locale?: string): string {
  const major = minor / 100;
  try {
    return new Intl.NumberFormat(locale ?? CURRENCY_LOCALE[currency] ?? "en", { style: "currency", currency, maximumFractionDigits: Number.isInteger(major) ? 0 : 2 }).format(major);
  } catch {
    return `${currency} ${major.toFixed(2)}`;
  }
}

function Thumb({ src, kind, size = 64 }: { src: string | null | undefined; kind: Kind; size?: number }) {
  const [broken, setBroken] = useState(false);
  return (
    <span className="relative grid shrink-0 place-items-center overflow-hidden rounded-[16px] bg-surface text-ink-soft" style={{ width: size, height: size }}>
      {src && !broken ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="h-full w-full object-cover" loading="lazy" onError={() => setBroken(true)} />
      ) : (
        <Icon name={KIND_ICON[kind]} size={Math.round(size * 0.4)} strokeWidth={1.7} />
      )}
    </span>
  );
}

function SampleTag() {
  return <span className="rounded-full border border-[var(--line)] px-2 py-0.5 text-caption font-semibold uppercase tracking-[0.06em] text-ink-faint">Sample</span>;
}

export function SendSheet({
  forMemberId,
  context,
  open,
  onClose,
  inline = false,
}: {
  forMemberId: string;
  context?: { kind: "occasion" | "need"; title: string };
  open: boolean;
  onClose: () => void;
  /** On the Send something page: the same steps in the page, not a sheet. */
  inline?: boolean;
}) {
  const { members } = useViewer();
  const name = callName(members.find((x) => x.id === forMemberId));
  const [step, setStep] = useState<Step>({ s: "loading" });

  const load = useCallback(async () => {
    setStep({ s: "loading" });
    const body: Record<string, string> = { forMemberId };
    if (context?.title) body[context.kind] = context.title;
    const res = await postJson<{ eligible?: boolean; suggestions: SuggestionView[]; sample: boolean; refused?: string }>("/api/partners/suggest", body);
    if (!res) return setStep({ s: "error" });
    // No partner serves their country: the section is left out (the page keeps its app links).
    if (res.eligible === false) return setStep({ s: "none" });
    setStep({ s: "list", items: res.suggestions, sample: res.sample, refused: res.refused });
  }, [forMemberId, context?.kind, context?.title]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  useEffect(() => {
    if (!open || inline) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, inline]);

  const preview = async (items: SuggestionView[], sample: boolean, picked: SuggestionView, addressId?: string) => {
    // Changing the address keeps the preview on screen while it refreshes.
    setStep((cur) => (addressId && cur.s === "preview" ? { ...cur, busy: true } : { s: "previewing", items, sample, picked }));
    const res = await postJson<{ preview?: PreviewView; needsConnect?: string; name?: string }>("/api/partners/order", { action: "preview", suggestionId: picked.id, forMemberId, ...(addressId ? { addressId } : {}) });
    if (!res) return setStep({ s: "error" });
    if (res.needsConnect) return setStep({ s: "connect", items, sample, account: res.needsConnect, name: res.name ?? res.needsConnect });
    if (res.preview) setStep({ s: "preview", items, sample, picked, preview: res.preview });
    else setStep({ s: "error" });
  };

  const send = async (st: Extract<Step, { s: "preview" }>) => {
    setStep({ ...st, busy: true });
    const res = await postJson<{ result?: Result; needsConnect?: string; name?: string }>("/api/partners/order", { action: "confirm", previewId: st.preview.id, confirm: true });
    if (!res) return setStep({ s: "error" });
    if (res.needsConnect) return setStep({ s: "connect", items: st.items, sample: st.sample, account: res.needsConnect, name: res.name ?? res.needsConnect });
    if (!res.result) return setStep({ s: "error" });
    if (res.result.status === "handoff") window.open(res.result.url, "_blank", "noopener,noreferrer");
    setStep({ s: "done", preview: st.preview, result: res.result });
  };

  const back = step.s === "preview" || step.s === "connect" ? () => setStep({ s: "list", items: step.items, sample: step.sample }) : null;

  if (step.s === "none") return null;

  if (inline)
    return (
      <section aria-label={`Muse's ideas for ${name}`}>
        <div className="mb-1 flex items-center gap-1">
          {back && (
            <button type="button" onClick={back} aria-label="Back to the ideas" className="press -ml-2 grid h-11 w-11 place-items-center rounded-full text-ink-soft">
              <Icon name="back" />
            </button>
          )}
          <h2 className="m-0 min-w-0 flex-1 text-title">Muse&rsquo;s ideas for {name}</h2>
        </div>
        {context?.title && step.s !== "done" && <p className="voice m-0 mb-3 text-body text-ink-soft">For {context.title}</p>}
        <Body step={step} name={name} onPick={preview} onSend={send} onRetry={load} onClose={() => void load()} />
      </section>
    );

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center" role="dialog" aria-modal="true" aria-label={`Send something to ${name}`} data-ui="send-sheet">
          <m.button type="button" aria-label="Close" className="absolute inset-0 bg-black/25" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <m.div
            className="relative max-h-[92vh] w-full max-w-[480px] overflow-y-auto rounded-t-[32px] bg-white px-4 pt-3 shadow-frost"
            style={{ paddingBottom: "calc(20px + env(safe-area-inset-bottom))" }}
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", stiffness: 340, damping: 36 }}
          >
            <span className="mx-auto mb-2 block h-1.5 w-10 rounded-full bg-black/15" aria-hidden="true" />
            <div className="mb-1 flex items-center gap-1">
              {back && (
                <button type="button" onClick={back} aria-label="Back" className="press -ml-2 grid h-11 w-11 place-items-center rounded-full text-ink-soft">
                  <Icon name="back" />
                </button>
              )}
              <h2 className="m-0 min-w-0 flex-1 truncate text-title">Send something to {name}</h2>
              <button type="button" onClick={onClose} aria-label="Close" className="press -mr-2 grid h-11 w-11 place-items-center rounded-full text-ink-soft">
                <Icon name="close" />
              </button>
            </div>
            {context?.title && step.s !== "done" && <p className="voice m-0 mb-3 text-body text-ink-soft">For {context.title}</p>}
            <Body step={step} name={name} onPick={preview} onSend={send} onRetry={load} onClose={onClose} />
          </m.div>
        </div>
      )}
    </AnimatePresence>
  );
}

function Body({
  step,
  name,
  onPick,
  onSend,
  onRetry,
  onClose,
}: {
  step: Step;
  name: string;
  onPick: (items: SuggestionView[], sample: boolean, picked: SuggestionView, addressId?: string) => void;
  onSend: (st: Extract<Step, { s: "preview" }>) => void;
  onRetry: () => void;
  onClose: () => void;
}) {
  if (step.s === "none") return null;
  if (step.s === "loading")
    return (
      <div className="mt-3 space-y-3" aria-busy="true" aria-label="Finding things to send">
        {[0, 1, 2].map((i) => (
          <div key={i} className="skeleton h-[88px] rounded-[22px]" />
        ))}
      </div>
    );

  if (step.s === "error")
    return (
      <div className="py-8 text-center">
        <p className="m-0 text-body text-ink-soft">Couldn&rsquo;t reach the shops just now.</p>
        <Button variant="secondary" className="mx-auto mt-4" onClick={onRetry}>
          Try again
        </Button>
      </div>
    );

  if (step.s === "list" || step.s === "previewing") {
    const { items, sample } = step;
    if (step.s === "list" && step.refused === "medical")
      return <p className="m-0 py-8 text-center text-body text-ink-soft">Nearer doesn&rsquo;t order medicines. Please use a licensed pharmacy with the prescription.</p>;
    if (items.length === 0) return <p className="m-0 py-8 text-center text-body text-ink-soft">Nothing from our partners fits this right now.</p>;
    return (
      <div className="mt-2">
        <ul className="m-0 list-none space-y-2.5 p-0">
          {items.map((it) => {
            const busy = step.s === "previewing" && step.picked.id === it.id;
            return (
              <li key={it.id}>
                <button
                  type="button"
                  disabled={step.s === "previewing"}
                  onClick={() => onPick(items, sample, it)}
                  aria-label={`${it.name}, ${money(it.price, it.currency)}, via ${it.via}`}
                  className={cn("press flex w-full items-center gap-3 rounded-[22px] bg-surface p-3 text-left", step.s === "previewing" && !busy && "opacity-50")}
                >
                  <Thumb src={it.image} kind={it.kind} />
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-2 block text-body font-semibold leading-snug">{it.name}</span>
                    {it.why && <span className="voice mt-0.5 block truncate text-callout text-ink-soft">{it.why}</span>}
                    <span className="mt-1 flex items-center gap-2 text-footnote text-ink-soft">
                      <span className="font-semibold text-ink">{money(it.price, it.currency)}</span>
                      <span aria-hidden="true">·</span>
                      <span className="truncate">via {it.via}</span>
                    </span>
                  </span>
                  {busy ? <span className="h-5 w-5 animate-spin rounded-full border-2 border-black/15 border-t-black" aria-label="Loading" /> : <Icon name="chevron" size={18} className="text-ink-faint" />}
                </button>
              </li>
            );
          })}
        </ul>
        <div className="mt-4 flex items-center justify-between gap-3">
          <p className="m-0 text-caption text-ink-faint">Picked from our partners&rsquo; shelves. No ads.</p>
          {sample && <SampleTag />}
        </div>
      </div>
    );
  }

  if (step.s === "connect")
    return (
      <div className="py-6 text-center">
        <span className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full bg-surface text-ink" aria-hidden="true">
          <Icon name="plug" />
        </span>
        <p className="m-0 text-body font-semibold">Connect your {step.name} account</p>
        <p className="m-0 mx-auto mt-1 max-w-[300px] text-callout text-ink-soft">Orders are placed from your own account. Nearer never sees your payment details.</p>
        <a href={`/api/partners/${encodeURIComponent(step.account)}/connect`} className="press mx-auto mt-5 flex h-12 w-fit items-center justify-center gap-2 rounded-full bg-black px-7 text-body font-semibold text-white no-underline">
          Connect {step.name}
        </a>
      </div>
    );

  if (step.s === "preview") {
    const { preview: p, picked } = step;
    return (
      <div className="mt-2">
        <div className="flex items-center gap-3 rounded-[22px] bg-surface p-3">
          <Thumb src={p.item.image} kind={picked.kind} size={56} />
          <span className="min-w-0 flex-1">
            <span className="line-clamp-2 block text-body font-semibold leading-snug">{p.item.name}</span>
            <span className="mt-0.5 block text-footnote text-ink-soft">
              {p.item.quantity} × {money(p.item.price, p.currency)} · via {p.via}
            </span>
          </span>
        </div>

        <p className="m-0 mb-2 mt-5 text-footnote font-medium text-ink-soft">Deliver to</p>
        {p.address ? (
          <div className="flex gap-2 overflow-x-auto pb-1" role="radiogroup" aria-label="Delivery address">
            {p.addresses.map((a) => (
              <button
                key={a.id}
                type="button"
                role="radio"
                aria-checked={p.address?.id === a.id}
                disabled={step.busy}
                onClick={() => a.id !== p.address?.id && onPick(step.items, step.sample, picked, a.id)}
                className={cn("press shrink-0 rounded-[18px] px-4 py-2.5 text-left", p.address?.id === a.id ? "bg-ink text-white" : "bg-surface text-ink")}
              >
                <span className="block text-callout font-semibold">{a.label}</span>
                <span className={cn("block max-w-[200px] truncate text-caption", p.address?.id === a.id ? "text-white/70" : "text-ink-soft")}>{a.line}</span>
              </button>
            ))}
          </div>
        ) : (
          <p className="m-0 text-callout text-ink-soft">You&rsquo;ll add {name}&rsquo;s address at {p.via}&rsquo;s checkout.</p>
        )}

        <div className="mt-5 flex items-baseline justify-between border-t border-[var(--line)] pt-4">
          <span className="text-body text-ink-soft">{p.handoff ? "Price" : "Total"}</span>
          <span className="text-title font-semibold">{money(p.total, p.currency)}</span>
        </div>
        {p.eta && <p className="m-0 mt-1 text-right text-footnote text-ink-soft">Arrives {p.eta}</p>}

        <Button className="mt-5 w-full" disabled={step.busy} onClick={() => onSend(step)}>
          <Icon name={p.handoff ? "external" : "send"} size={19} />
          {step.busy ? "Sending…" : p.handoff ? `Continue at ${p.via}` : "Send"}
        </Button>
        <div className="mt-3 flex items-center justify-between gap-3">
          <p className="m-0 text-caption text-ink-faint">{p.handoff ? "You pay on the store's own checkout." : "From your own account. You pay in the app."}</p>
          {p.sample && <SampleTag />}
        </div>
      </div>
    );
  }

  // done
  const r = step.result;
  const line =
    r.status === "placed"
      ? `On its way to ${name}${r.eta ? ` · arrives ${r.eta}` : ""}`
      : r.status === "handoff"
        ? `Finish at ${step.preview.via}'s checkout`
        : "Pay with UPI to finish";
  return (
    <div className="py-6 text-center">
      <m.span initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 300, damping: 20 }} className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-full bg-ink text-white" aria-hidden="true">
        <Icon name={r.status === "placed" ? "check" : r.status === "handoff" ? "external" : "send"} size={28} />
      </m.span>
      <p className="m-0 text-title font-semibold" role="status">
        {line}
      </p>
      <p className="m-0 mt-1 text-callout text-ink-soft">
        {step.preview.item.name} · via {step.preview.via}
      </p>
      {r.status === "awaiting-payment" && r.qr && (r.qr.startsWith("https://") || r.qr.startsWith("data:image/")) && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={r.qr} alt="UPI QR code to pay" className="mx-auto mt-4 h-48 w-48 rounded-[16px]" />
      )}
      {r.status === "awaiting-payment" && r.paymentUrl && (
        <a href={r.paymentUrl} className="press mx-auto mt-4 flex h-[48px] w-fit items-center rounded-full bg-black px-6 text-body font-semibold text-white no-underline">
          Open UPI app
        </a>
      )}
      {r.status === "handoff" && (
        <a href={r.url} target="_blank" rel="noopener noreferrer" className="press mx-auto mt-4 flex h-[48px] w-fit items-center gap-2 rounded-full bg-surface px-6 text-body font-semibold text-ink no-underline">
          <Icon name="external" size={17} /> Open {step.preview.via}
        </a>
      )}
      {step.preview.sample && (
        <div className="mt-3 flex justify-center">
          <SampleTag />
        </div>
      )}
      <Button variant="secondary" className="mx-auto mt-6" onClick={onClose}>
        Done
      </Button>
    </div>
  );
}
