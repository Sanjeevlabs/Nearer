import Link from "next/link";
import { getAccount } from "@/lib/partners/registry";

// Where a partner connection lands: a calm confirmation, then back to Settings.
export const dynamic = "force-dynamic";

export default async function ConnectDone(
  props: { params: Promise<{ id: string }>; searchParams: Promise<{ status?: string }> }
) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  const name = getAccount(params.id)?.name ?? "The app";
  const status = searchParams.status === "ok" ? "ok" : searchParams.status === "denied" ? "denied" : "error";
  const title = status === "ok" ? `${name} is connected` : status === "denied" ? "Not connected" : "Couldn't connect";
  const line =
    status === "ok"
      ? "Orders are placed from your own account. Nearer never sees your payment details."
      : status === "denied"
        ? `You chose not to connect ${name}. You can try again any time.`
        : `Something went wrong talking to ${name}. Please try again.`;
  return (
    <main className="mx-auto flex min-h-[100dvh] max-w-[480px] flex-col items-center justify-center bg-paper px-6 text-center">
      <span className={`mb-5 grid h-16 w-16 place-items-center rounded-full ${status === "ok" ? "bg-ink text-white" : "bg-surface text-ink-soft"}`} aria-hidden="true">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          {status === "ok" ? <path d="M20 6 9 17l-5-5" /> : <path d="M18 6 6 18M6 6l12 12" />}
        </svg>
      </span>
      <h1 className="m-0 text-[26px]">{title}</h1>
      <p className="m-0 mt-3 max-w-[300px] text-[15px] text-ink-soft">{line}</p>
      <Link href="/settings#connected-apps" className="press mt-8 flex h-[52px] items-center justify-center rounded-full bg-black px-8 text-[16px] font-semibold text-white no-underline">
        Back to Nearer
      </Link>
    </main>
  );
}
