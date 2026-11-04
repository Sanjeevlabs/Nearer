"use client";

import { AuthFlow } from "@/components/auth-flow";

// /join?code=XYZ (older links) opens that family's page; /join alone asks for the link.
export default function Page() {
  return <AuthFlow join />;
}
