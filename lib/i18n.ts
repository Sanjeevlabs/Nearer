// Demo display languages: English, Hinglish (Hindi in Latin script),
// Hindi in Devanagari. The viewer's display_lang drives greetings,
// kinship-driven lines, and card content. Add locales here, never branch
// logic on them.

import { LANG_CODES, language, toLangCode, type LangCode } from "./languages";

export const SUPPORTED_LANGS = LANG_CODES;
export type SupportedLang = LangCode;
// Legacy two-code alias (member.lang); hi maps to hi-deva.
export type DisplayLang = SupportedLang;

export function normalizeLang(lang: string | null | undefined): SupportedLang {
  return normalizeDisplayLang(lang);
}

export function normalizeDisplayLang(lang: string | null | undefined): SupportedLang {
  return toLangCode(lang);
}

export function displayLangLabel(code: SupportedLang): string {
  return language(code).native;
}

// Kinship name for the demo grandmother, per viewer display_lang.
// en -> Grandma, hi-latn -> Dadi, hi-deva -> दादी.
export function grandmaName(lang: string | null | undefined): string {
  const l = normalizeDisplayLang(lang);
  if (l === "hi-deva") return "दादी";
  if (l === "hi-latn") return "Dadi";
  return "Grandma";
}

export type DayPart = "morning" | "afternoon" | "evening";

export function greetingForHour(hour: number): DayPart {
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  return "evening";
}

interface Strings {
  tabs: { home: string; lane: string; add: string; rituals: string; gather: string };
  greeting: Record<DayPart, string>;
  welcomeTo: (name: string) => string;
  changeHome: string;
  stepInside: string;
  addHomeTitle: string;
  addHomeHint: string;
  shelves: {
    role: string;
    fromElder: (name: string) => string;
    voices: string;
    today: string;
    yearsAgo: string;
    comingUp: string;
    record: string;
    sendWish: string;
  };
  add: {
    title: string;
    photos: string;
    voice: string;
    video: string;
    ask: string;
    fromToday: string;
    fromGlasses: string;
    captionPlaceholder: string;
    share: string;
    processing: string;
    voiceSoon: string;
    askSoon: string;
  };
  card: { untitled: string; glassesBadge: string };
  coming: { inDays: (n: number) => string; today: string; birthday: (name: string) => string };
  empty: { laneSoon: string; ritualsSoon: string; gatherSoon: string; noToday: string };
  viewingAs: string;
  language: string;
  speakToYou: string;
  heard: { heardThis: string };
  reactions: { love: string; laugh: string; bless: string; replyVoice: string };
  player: {
    nowPlaying: string;
    play: string;
    pause: string;
    close: string;
    lyrics: string;
    transcriptLabel: string;
    translatedNote: string;
    noAudio: string;
  };
  voice: {
    record: string;
    stop: string;
    preview: string;
    consent: string;
    useRecording: string;
    recordAgain: string;
    suggested: string;
  };
  common: { cancel: string; close: string; retry: string };
}

const STRINGS: Partial<Record<SupportedLang, Strings>> & { en: Strings } = {
  en: {
    tabs: { home: "Home", lane: "Lane", add: "Add", rituals: "Rituals", gather: "Gather" },
    greeting: { morning: "Good morning", afternoon: "Good afternoon", evening: "Good evening" },
    welcomeTo: (name) => `Welcome home, ${name}`,
    changeHome: "Change home",
    stepInside: "Step inside",
    addHomeTitle: "Add a photo of the home you miss",
    addHomeHint: "A courtyard, a window, a doorway — avoid house numbers or street signs.",
    shelves: {
      role: "Today's role",
      fromElder: (name) => `From ${name}`,
      voices: "Voices",
      today: "Today · add from your day",
      yearsAgo: "This day, years ago",
      comingUp: "Coming up",
      record: "Record for them",
      sendWish: "Send a wish",
    },
    add: {
      title: "Add to Nearer",
      photos: "Photos",
      voice: "Voice",
      video: "Video",
      ask: "Ask",
      fromToday: "From today",
      fromGlasses: "From my glasses",
      captionPlaceholder: "Say something about this moment…",
      share: "Add memory",
      processing: "Preparing…",
      voiceSoon: "Voice recording arrives in M2 — the Heard loop needs it first.",
      askSoon: "Suggested questions arrive with voice in M2. These starters work today:",
    },
    card: { untitled: "A family memory", glassesBadge: "Captured hands-free" },
    coming: {
      inDays: (n) => (n === 1 ? "tomorrow" : `in ${n} days`),
      today: "Today!",
      birthday: (name) => `${name}'s birthday`,
    },
    empty: {
      laneSoon: "Memory Lane arrives in M3.",
      ritualsSoon: "The Rituals calendar arrives in M4.",
      gatherSoon: "Gather arrives in M5.",
      noToday: "Nothing from today yet — add the first moment.",
    },
    viewingAs: "Demo · Viewing as",
    language: "Language",
    speakToYou: "How should Nearer speak to you?",
    heard: { heardThis: "heard this" },
    reactions: { love: "Love", laugh: "Smile", bless: "Blessing", replyVoice: "Reply with voice" },
    player: {
      nowPlaying: "Now playing",
      play: "Play",
      pause: "Pause",
      close: "Close player",
      lyrics: "Lyrics",
      transcriptLabel: "Transcript",
      translatedNote: "Translated for you",
      noAudio: "Preview plays from saved waves in this demo.",
    },
    voice: {
      record: "Record",
      stop: "Stop",
      preview: "Preview",
      consent: "Demo mode: AI providers may process content. Record only with everyone's okay.",
      useRecording: "Use this recording",
      recordAgain: "Record again",
      suggested: "Suggested for them",
    },
    common: { cancel: "Cancel", close: "Close", retry: "Try again" },
  },
  "hi-latn": {
    tabs: { home: "Home", lane: "Lane", add: "Jodein", rituals: "Rasmein", gather: "Milan" },
    greeting: { morning: "Suprabhat", afternoon: "Namaste", evening: "Shubh sandhya" },
    welcomeTo: (name) => `${name}, ghar mein swagat hai`,
    changeHome: "Ghar badlein",
    stepInside: "Andar chalein",
    addHomeTitle: "Us ghar ki photo jodein jiski yaad aati hai",
    addHomeHint: "Nearer, khidki, darwaza — makan number ya gali ka naam na dikhe.",
    shelves: {
      role: "Aaj ki bhoomika",
      fromElder: (name) => `${name} ki ore se`,
      voices: "Awaazein",
      today: "Aaj · apne din se jodein",
      yearsAgo: "Aaj hi ke din, saalon pehle",
      comingUp: "Aane wala",
      record: "Unke liye record karein",
      sendWish: "Shubhkaamna bhejein",
    },
    add: {
      title: "Nearer mein jodein",
      photos: "Photo",
      voice: "Awaaz",
      video: "Video",
      ask: "Poochein",
      fromToday: "Aaj ki",
      fromGlasses: "Mere chashme se",
      captionPlaceholder: "Is pal ke baare mein kuch kahein…",
      share: "Yaad jodein",
      processing: "Taiyaar ho raha hai…",
      voiceSoon: "Awaaz recording M2 mein aayegi — pehle Heard loop zaroori hai.",
      askSoon: "Sujhae gaye sawal M2 mein awaaz ke saath aayenge. Ye shuruaat aaj kaam karegi:",
    },
    card: { untitled: "Parivaar ki ek yaad", glassesBadge: "Hands-free capture" },
    coming: {
      inDays: (n) => (n === 1 ? "kal" : `${n} din mein`),
      today: "Aaj!",
      birthday: (name) => `${name} ka janmadin`,
    },
    empty: {
      laneSoon: "Memory Lane M3 mein aayegi.",
      ritualsSoon: "Rasmon ka calendar M4 mein aayega.",
      gatherSoon: "Milan M5 mein aayega.",
      noToday: "Aaj ki koi yaad nahin — pehla pal jodein.",
    },
    viewingAs: "Demo · Is roop mein dekhein",
    language: "Bhasha",
    speakToYou: "Nearer aapse kaise baat kare?",
    heard: { heardThis: "ne ye suna" },
    reactions: { love: "Pyaar", laugh: "Hansi", bless: "Aashirvaad", replyVoice: "Awaaz mein jawab dein" },
    player: {
      nowPlaying: "Ab baj raha hai",
      play: "Chalayein",
      pause: "Rokein",
      close: "Player band karein",
      lyrics: "Bol",
      transcriptLabel: "Transcript",
      translatedNote: "Aapke liye anuvaadit",
      noAudio: "Is demo mein preview saved waves se bajta hai.",
    },
    voice: {
      record: "Record karein",
      stop: "Rokein",
      preview: "Sunein",
      consent: "Demo mode: AI providers content process kar sakte hain. Sabki razamandi se hi record karein.",
      useRecording: "Is recording ka istemal karein",
      recordAgain: "Dobara record karein",
      suggested: "Unke liye sujhaav",
    },
    common: { cancel: "Radd karein", close: "Band karein", retry: "Phir koshish karein" },
  },
  "hi-deva": {
    tabs: { home: "होम", lane: "लेन", add: "जोड़ें", rituals: "रस्में", gather: "मिलन" },
    greeting: { morning: "सुप्रभात", afternoon: "नमस्ते", evening: "शुभ संध्या" },
    welcomeTo: (name) => `${name}, घर में स्वागत है`,
    changeHome: "घर बदलें",
    stepInside: "अंदर चलें",
    addHomeTitle: "उस घर की फ़ोटो जोड़ें जिसकी याद आती है",
    addHomeHint: "आँगन, खिड़की, दरवाज़ा — मकान नंबर या गली का नाम न दिखे।",
    shelves: {
      role: "आज की भूमिका",
      fromElder: (name) => `${name} की ओर से`,
      voices: "आवाज़ें",
      today: "आज · अपने दिन से जोड़ें",
      yearsAgo: "आज ही के दिन, सालों पहले",
      comingUp: "आने वाला",
      record: "उनके लिए रिकॉर्ड करें",
      sendWish: "शुभकामना भेजें",
    },
    add: {
      title: "Nearer में जोड़ें",
      photos: "फ़ोटो",
      voice: "आवाज़",
      video: "वीडियो",
      ask: "पूछें",
      fromToday: "आज की",
      fromGlasses: "मेरे चश्मे से",
      captionPlaceholder: "इस पल के बारे में कुछ कहें…",
      share: "याद जोड़ें",
      processing: "तैयार हो रहा है…",
      voiceSoon: "आवाज़ रिकॉर्डिंग M2 में आएगी — पहले हर्ड लूप ज़रूरी है।",
      askSoon: "सुझाए गए सवाल M2 में आवाज़ के साथ आएँगे। ये शुरुआत आज काम करेगी:",
    },
    card: { untitled: "परिवार की एक याद", glassesBadge: "हैंड्स-फ़्री कैप्चर" },
    coming: {
      inDays: (n) => (n === 1 ? "कल" : `${n} दिन में`),
      today: "आज!",
      birthday: (name) => `${name} का जन्मदिन`,
    },
    empty: {
      laneSoon: "मेमोरी लेन M3 में आएगी।",
      ritualsSoon: "रस्मों का कैलेंडर M4 में आएगा।",
      gatherSoon: "मिलन M5 में आएगा।",
      noToday: "आज की कोई याद नहीं — पहला पल जोड़ें।",
    },
    viewingAs: "Demo · इस रूप में देखें",
    language: "भाषा",
    speakToYou: "Nearer आपसे कैसे बात करे?",
    heard: { heardThis: "ने यह सुना" },
    reactions: { love: "प्यार", laugh: "हँसी", bless: "आशीर्वाद", replyVoice: "आवाज़ में जवाब दें" },
    player: {
      nowPlaying: "अभी बज रहा है",
      play: "चलाएँ",
      pause: "रोकें",
      close: "प्लेयर बंद करें",
      lyrics: "बोल",
      transcriptLabel: "प्रतिलेख",
      translatedNote: "आपके लिए अनुवादित",
      noAudio: "इस डेमो में प्रीव्यू सहेजी तरंगों से बजता है।",
    },
    voice: {
      record: "रिकॉर्ड करें",
      stop: "रोकें",
      preview: "सुनें",
      consent: "डेमो मोड: AI प्रदाता सामग्री संसाधित कर सकते हैं। सभी की सहमति से ही रिकॉर्ड करें।",
      useRecording: "इस रिकॉर्डिंग का उपयोग करें",
      recordAgain: "फिर से रिकॉर्ड करें",
      suggested: "उनके लिए सुझाव",
    },
    common: { cancel: "रद्द करें", close: "बंद करें", retry: "फिर कोशिश करें" },
  },
};

export function strings(lang: string | null | undefined): Strings {
  // Interface chrome ships in English (+ Hindi variants); content is translated by Muse.
  return STRINGS[normalizeDisplayLang(lang)] ?? STRINGS.en;
}

// Static starter questions (data, not model output). Model-suggested prompts
// arrive in M2 with the voice stack.
export const ASK_STARTERS: Partial<Record<SupportedLang, string[]>> & { en: string[] } = {
  en: [
    "What did your courtyard look like as a child?",
    "Teach me one word I should never forget.",
    "What song did your mother sing to you?",
  ],
  "hi-latn": [
    "Bachpan mein aapka aangan kaisa dikhta tha?",
    "Mujhe ek aisa shabd sikhaiye jo main kabhi na bhoolun.",
    "Aapki maa aapko kaun-sa geet sunati thin?",
  ],
  "hi-deva": [
    "बचपन में आपका आँगन कैसा दिखता था?",
    "मुझे एक ऐसा शब्द सिखाइए जो मैं कभी न भूलूँ।",
    "आपकी माँ आपको कौन-सा गीत सुनाती थीं?",
  ],
};
