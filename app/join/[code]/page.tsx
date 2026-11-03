"use client";

import { useParams } from "next/navigation";
import { AuthFlow } from "@/components/auth-flow";
import { codeFromInput } from "@/lib/invite-link";

// The family link: nearer.site/join/<CODE>. Who's inviting you, sign in right here, pick your name, in.
export default function Page() {
  const params = useParams<{ code: string }>();
  const code = codeFromInput(decodeURIComponent(params?.code ?? ""));
  return <AuthFlow join code={code} />;
}
