# Push notifications

Nearer sends the same short notification to a person's registered devices. The alert contains a display name, an event type and a link into Nearer. Private notes, captions, transcripts, habit names and custom door notes stay in the app.

| Event | Recipient | Preference | Opens |
| --- | --- | --- | --- |
| Lamp lit | Adults in the other homes at the window, at most once per pair every two hours | Lamp | Window |
| Heartbeat | The selected person in another home | Lamp | Window |
| Shared habit tick | The other active participants, once per actor, habit and local day. Undo sends nothing | Lamp | Shared habit in the courtyard |
| Open door, including an invitation for tea | Explicit invitees | Questions and requests | That call |
| Planned invitation to sit together | Explicit invitees | Questions and requests | That call |
| Guest joins a call | Host, once per guest and room | Questions and requests | That call |
| Addressed voice memory, photo or video | Active addressees | Voice memories, photos and videos | That card |
| Reply or reaction | Original card author, with one alert per card in any rolling hour across both actions | Voice memories, photos and videos | The reply or original card |
| Join by family link | Active owners and admins | Questions and requests | New member's profile |
| Question, story or recipe request, child's ask | Selected recipients or designated guardians | Questions and requests | Inbox |
| Opted-in quiet morning | Elder’s chosen contact or their grown children in other homes, once a day and during daytime | Lamp | Window |
| Help request or overdue check-in | Chosen Safe & sound watchers | Safe & sound | Safe & sound |
| Morning summary | Members with delivered nudges or held alerts | Morning summary | Inbox |
| Settings test | The signed-in person who requested it | Explicit request | Window |

Ordinary alerts honor recipient preferences, local quiet hours from 22:00 until 07:00, and a daily cap of six immediate alerts. The 15-minute sweep checks for held alerts at 08:00 local time. The daily scan can also deliver the summary after 08:00. Together they send at most one summary per local day. Safe & sound alerts honor their own preference and remain eligible at any hour. The Settings test sends only on request. Live delivery and device registration are blocked for the demo seed and its copies. Mock mode records messages in memory without contacting a provider.

## Owner setup

1. In the Supabase SQL editor, run the current `supabase/schema.sql`. This includes `push_subscriptions` and the `push_claim` document kind used for duplicate prevention. Make sure the scheduled daily scan and the 15-minute push sweep have `CRON_SECRET` configured.
2. For Web Push, run `node scripts/vapid-keys.mjs` once. Store the two outputs securely and set `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` with `npx wrangler secret put <NAME>`. Set `VAPID_SUBJECT` to a monitored contact URI. Retain the key pair across releases because rotating it requires new subscriptions.
3. For native push, create a Firebase project and enable Firebase Cloud Messaging API (V1). In Google Cloud IAM, grant the sending service account Firebase Cloud Messaging API Admin for that project. In Firebase Project settings → Service accounts, create the server JSON credential and store it as `FCM_SERVICE_ACCOUNT` with `npx wrangler secret put FCM_SERVICE_ACCOUNT`. Keep the JSON out of Git.
4. In Firebase Project settings → General, register the Android app as `site.nearer.app`. Download `google-services.json` into `android/app/`. Set `CAP_SERVER_URL` to the HTTPS Nearer origin and run `npx cap sync android`. Build and install using Android Studio or `cd android && ./gradlew assembleDebug`. Android uses the Family channel and a small Nearer status icon.
5. In Apple Developer, enable Push Notifications for the explicit app ID `site.nearer.app` and create an APNs authentication key under Keys. Keep the `.p8`, key ID and team ID in secure storage. In Firebase Project settings → General, add an Apple app with the same bundle ID. Add `GoogleService-Info.plist` to the App target in Xcode. In Project settings → Cloud Messaging, upload the APNs key with the key ID and team ID under the Apple app. In Xcode add the Firebase Apple SDK package (`https://github.com/firebase/firebase-ios-sdk`) and link FirebaseCore and FirebaseMessaging to the App target. Enable Push Notifications and verify that the signed provisioning profile grants the matching `aps-environment` entitlement. Sync with `CAP_SERVER_URL` set and build on a signed physical device. The shell hands Firebase's FCM registration token to Nearer.
6. Sign in to a real test family on two devices. In Settings → You → Notifications, tap Turn on, then Send me a test. On Android Chrome use the HTTPS site. On iOS/iPadOS 16.4 or newer, use Safari's Add to Home Screen and open Nearer from the new icon before granting permission. Confirm the first successful lamp or door action offers the same opt-in. Verify foreground, background and cold-launch taps and a private addressed card between the two devices.

The test button calls authenticated `POST /api/push/test` without a body. Its response reports `devices`, `sent` and `configured`. In mock mode the push appears in the test outbox. A live `sent` count means the provider accepted the message. Check the device to confirm receipt.

References: [Firebase Android setup](https://firebase.google.com/docs/android/setup), [Firebase Apple messaging setup](https://firebase.google.com/docs/cloud-messaging/ios/get-started), [WebKit Home Screen Web Push](https://webkit.org/blog/13878/).
