"use client";

import Link from "next/link";
import { Icon, RoomHeader } from "@/components/ui/kit";
import { useViewer } from "@/components/viewer";

// The public privacy page (linked from the landing page, works signed out).
// Plain and short, and true to what the app does. Signed in, it points to
// Settings → Privacy, where the controls are.

const POINTS: { title: string; line: string }[] = [
  { title: "What we keep", line: "Your family's tree, the photos, voice notes, recipes, stories and care notes you share, and the settings you choose. Files sit in private storage." },
  { title: "Who sees it", line: "Only the people in your family. Every read and write is locked to your family. Nothing is public unless you make a share link, and you can take that link back." },
  { title: "Your voice stays in the family", line: "Voice notes are heard by your family, nobody else. Voices are never cloned, and there is no face recognition." },
  { title: "No ads, no tracking", line: "No advertising, no selling your data, no tracking across apps. Safe & sound shows only what each person chooses to share, and photos lose their location before upload." },
  { title: "Muse, the helper", line: "Meta's AI models write captions, transcripts and translations for your family. Muse never posts as a person." },
  { title: "Delete anytime", line: "A grown-up can download the family's data as one file. You can delete your reactions, wishes and listens, or leave the family: your profile and place in the tree are deleted. Memories you shared stay with the family." },
];

export default function PrivacyPage() {
  const { signedIn } = useViewer();
  return (
    <div>
      <RoomHeader title="Privacy" />
      <p className="m-0 text-headline leading-snug text-ink-soft">Nearer is a private place for one family. Here is what that means.</p>
      <ul className="m-0 mt-6 list-none space-y-3 p-0">
        {POINTS.map((p) => (
          <li key={p.title} className="rounded-card bg-card px-4 py-4 shadow-card">
            <h2 className="m-0 text-headline">{p.title}</h2>
            <p className="m-0 mt-1 text-body leading-snug text-ink-soft">{p.line}</p>
          </li>
        ))}
      </ul>
      {signedIn && (
        <Link href="/settings#privacy" className="press mt-6 flex min-h-12 items-center justify-between rounded-card bg-card px-4 text-body font-medium text-ink no-underline shadow-card">
          Your privacy settings
          <Icon name="chevron" size={17} className="text-ink-faint" />
        </Link>
      )}
    </div>
  );
}
