# Privacy and Safety

Nearer is a private place for one family. Here is what that means in the app as built.

## What we keep

Your family's tree, the photos, voice notes, recipes, stories and care notes you share, and the settings you choose. Files sit in private storage.

Storage is Postgres plus private Storage, with row access by `family_id`. Signed in, you can review controls at Settings → Privacy.

## Who can see it

- Only the people in your family. Every read and write is locked to your family.
- Two homes stay separate. Nothing crosses between homes unless someone shares it.
- Switching sides only goes to a home where the same person already has a place. Other members' emails never leave the server.
- Nothing is public unless you make a share link. Sharing is opt-in, a frozen copy behind a 144-bit token, marked `noindex`, and you can take it back.
- No advertising, no selling your data, no tracking across apps.
- Photos lose their location before upload.
- Your voice stays in the family. Voice notes are heard by your family, nobody else. Voices are never cloned, and there is no face recognition.

Server routes use a server-only key that never reaches the browser. Cached lists on your device are dropped after a write, on sign-in, sign-out, or when you switch family or person, so the next family never sees the last family's content.

## Sessions and limits

- Sign-in is an email code. Sessions use httpOnly, SameSite=Lax, HMAC-signed cookies.
- Email codes are rate-limited.
- Invite codes expire in 7 days and can never open an admin or someone with their own account. The persona switcher only works in the synthetic demo families.
- Rate limits are best-effort per worker. The real limit is looser than the number in the code when traffic spreads across workers. Sign-in codes are also limited by the auth provider.

## Safe & sound and check-ins

Safe & sound shows only what each person chooses to share.

- The state — Active, Quiet, Asleep — is worked out from the newest sign of life, such as a moment, a card, or a check-in a person closed, plus your quiet-after setting. Closing a check-in by timeout is not a sign of life.
- Presence is only recorded if the person shares visits, at most once every 30 minutes. A heartbeat counts for at most 6 hours, then the line reads “quiet since”. Presence rows are deleted after 15 days.
- The quiet-day note is opt-in and owned by the parent, goes to the one person they chose, and is judged against their own usual rhythm. Nothing is tracked.

Safety check-ins:

- Types are “Heading home”, “Travelling”, and “I need help”.
- The person closes a check-in, or starts a new one.
- Open for 48 hours, then it is closed as “no reply” and the location is dropped.
- Location from “I need help” is hidden after 24 hours on read.
- Closed check-ins are deleted after 30 days.

## What Muse does and does not do

Muse is the family's helper, never a family member. It shows as one quiet offer in context.

Muse may:

- Write a caption from what is visible in a photo or video
- Write down voice notes, wishes, blessings, stories and requests, with timings
- Bring a card to each person in their own language
- Label a story, suggest a question, draft a plan, or sort photos into event albums for a person to check

Muse may not:

- Never posts as a person, never chats in place of your children, and never gives medical advice
- Nothing is posted automatically. Drafts open in the normal editor. Images show a preview with Keep or Try again
- Never invents people or events. Captions describe the pixels. Recipes hold only what was said or written. Portraits paint only the people chosen, from their own photos
- Anything Muse painted or restored says so in the image itself and in every viewer: “Painted by Muse” or “Restored by Muse”
- Voices are never cloned. There is no face recognition
- Portraits are always a painted style. At most 10 people, all in this family, with photos resolved on the server from the family's own media only
- Teens and children never start a portrait. A grown-up may include a child only if they are the child's parent or share a home with them
- 5 portraits and 10 restores per family per day

Every call is logged to *What Muse did*. Muse call logs are deleted after 90 days.

## Delete and take your data

- A grown-up can download the family's data as one file. Export is JSON, and it strips emails, Muse logs and safety locations.
- You can delete your reactions, wishes and listens, or leave the family: your profile and place in the tree are deleted. Memories you shared stay with the family.
- Expired rows are hidden on read and removed by a daily clean-up, so a missed run never shows a stale thing.

| Thing | How long it is kept |
|---|---|
| Muse call log | Deleted after 90 days |
| Presence and heartbeats | Deleted after 15 days |
| Open safety check-in | Closed as “no reply” after 48 hours |
| Check-in location | Hidden after 24 hours |
| Closed safety check-in | Deleted after 30 days |
| Public share link | Until you revoke it |

---

Written by Muse Spark (Meta) from the build log on 2026-11-02.
