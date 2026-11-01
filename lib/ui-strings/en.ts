// The source of every UI key. Other locales are partial: a missing key falls
// back to English. Placeholders use {name}. Keep copy global: no words that
// only make sense in one country (placeholders are localised per catalogue).

export const en = {
  // Landing (signed out)
  "landing.tagline": "The window between two homes.",
  "landing.sub": "A window into your parents' day, and theirs into yours.",
  "landing.create": "Create",
  "landing.join": "Join with code",
  "landing.signin": "Sign in",
  "landing.demo": "Try the demo",
  "landing.opening": "Opening…",

  // Welcome (signed in, once per session)
  "welcome.morning": "Good morning",
  "welcome.afternoon": "Good afternoon",
  "welcome.evening": "Good evening",
  "welcome.title": "Welcome home, {name}",
  "welcome.enter": "Step inside",

  // Auth: titles
  "auth.back": "Back",
  "auth.skip": "Skip for now",
  "auth.titleOtherSide": "Whose window is this?",
  "auth.titleInvite": "Invite {names}",
  "auth.titleInviteThem": "Invite them",
  "auth.namesJoin": " & ",
  "auth.titleWelcomeBack": "Welcome back",
  "auth.titleEmail": "Your email",
  "auth.titleCheck": "Check your email",
  "auth.titleCreate": "Open your window",
  "auth.titleJoinHost": "Join {host}'s window",
  "auth.titleJoinFamily": "Join the {family} window",
  "auth.titleJoin": "Join your family",

  // Auth: details
  "auth.joinSub": "Use the code your family sent you.",
  "auth.familyName": "Family name",
  "auth.familyNamePh": "Rivera",
  "auth.inviteCode": "Invite code",
  "auth.whichYou": "Which one is you?",
  "auth.imName": "I'm {name}",
  "auth.someoneElse": "Someone else",
  "auth.firstName": "Your first name",
  "auth.firstNamePh": "Sam",
  "auth.callName": "What the family calls you",
  "auth.callNameHint": "Leave empty to use your name.",
  "auth.callNamePh": "Mum, Nana, Bro…",
  "auth.city": "Your city",
  "auth.cityHint": "The other home sees your sky and the time there.",
  "auth.cityPh": "Toronto",
  "auth.birthday": "Your birthday",
  "auth.birthdayHint": "We never ask for the year.",
  "auth.month": "Month",
  "auth.day": "Day",
  "auth.birthdayMonth": "Birthday month",
  "auth.birthdayDay": "Birthday day",
  "auth.continue": "Continue",

  // Auth: email + code
  "auth.emailSub": "We'll email you a 6-digit code. No password.",
  "auth.emailSubJoin": "Already in another family? Use the same email: you'll be in both.",
  "auth.email": "Email",
  "auth.google": "Continue with Google",
  "auth.or": "or",
  "auth.phone": "Mobile number",
  "auth.usePhone": "Use a mobile number instead",
  "auth.useEmail": "Use email instead",
  "auth.magicLink": "We'll email a link and a code. Tap the link, or type the code here.",
  "auth.emailPh": "you@example.com",
  "auth.sending": "Sending…",
  "auth.sendCode": "Send code",
  "auth.newHere": "New here?",
  "auth.codeSub": "Enter the code we sent to {email}.",
  "auth.codeMock": "Demo mode: no email is sent. Use 000000.",
  "auth.codeLabel": "6-digit code",
  "auth.resend": "Send a new code",
  "auth.checking": "Checking…",
  "auth.openOurs": "Open our window",
  "auth.joinCta": "Join",

  // Auth: errors
  "error.invalid-email": "That email doesn't look right.",
  "error.too-many-codes": "Too many codes requested. Wait a few minutes, then try again.",
  "error.code-not-sent": "We couldn't send the code. Try again in a moment.",
  "error.wrong-code": "That code didn't match. Check the latest email and try again.",
  "error.too-many-attempts": "Too many tries. Wait a few minutes, then request a new code.",
  "error.no-family": "No family uses this email yet. Start one, or join with an invite code.",
  "error.already-member": "This email already belongs to a family. Sign in instead.",
  "error.invalid-invite": "That invite code isn't valid or has expired. Ask for a new one.",
  "error.too-many-sides": "You're already in four families, the most Nearer allows.",
  "error.generic": "Something went wrong. Try again.",

  // Onboarding: the other side of the window
  "other.sub": "Who's in the home on the other side? Add them by the name you call them.",
  "other.theyAre": "They are",
  "other.parents": "My parents",
  "other.children": "My children",
  "other.other": "Other family",
  "other.calledFirst": "They're called",
  "other.calledMore": "And",
  "other.city": "City",
  "other.parentPh1": "Mum",
  "other.parentPh2": "Dad",
  "other.childPh": "Sam",
  "other.cityPh": "Lisbon",
  "other.sameCity": "Same city",
  "other.personName": "Person {n} name",
  "other.personCity": "Person {n} city",
  "other.remove": "Remove person {n}",
  "other.add": "Add someone",
  "other.adding": "Adding…",
  "other.later": "Later",
  "other.error": "Couldn't add them. Check the names and try again.",

  // Onboarding: invite
  "invite.failed": "We couldn't make an invite just now. You can send one later from the window.",
  "invite.openWindow": "Open the window",
  "invite.sub": "Send them the link. They tap it, pick their name, and their window opens onto yours.",
  "invite.valid": "Works for 7 days",
  "invite.whatsapp": "Send on WhatsApp",
  "invite.copied": "Link copied",
  "invite.copy": "Copy the link",
  "invite.openMine": "Open my window",
  "invite.done": "Done",

  // People picker
  "picker.everyone": "Everyone",
  "picker.close": "Close",

  // Shared: the window (lead)
  "window.callGood": "Good time to call",
  "window.asleep": "They're asleep",
  "window.lampLit": "You lit it just now",
  "window.lampHold": "Tap to light · hold for a heartbeat",
  "window.morningLetter": "Morning letter",
  "window.sendNow": "Send now",
  "window.whosAtWindow": "Who's at your window",

  // Shared: the family pages (lead)
  "family.everyoneToday": "Everyone today",
  "family.memories": "Memories",
  "family.kitchen": "Kitchen",
  "family.care": "Care",
  "family.family": "Family",
  "family.getTogether": "Celebrations",
  "occasions.chorus": "The Chorus",
  "occasions.ourTraditions": "Our traditions",

  // Settings → Language
  "settings.language": "Language",
  "settings.change": "Change",
  "settings.done": "Done",
  "settings.search": "Search languages",
  "settings.noMatch": "No match. Try the English name.",
  "settings.languageNote": "Nearer's own words on the main screens follow this language where marked below. Everything the family shares (voices, captions, recipes, notes) is translated for you. Names stay as the family says them.",
  "settings.languageUpdated": "Language updated",
  "settings.appSpeaks": "The app's own words are in this language too.",
} as const;

export type UiKey = keyof typeof en;
export type Catalogue = Partial<Record<UiKey, string>>;
