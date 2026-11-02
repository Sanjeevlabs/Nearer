// The words of a push, in the recipient's language where we have them, else English.
// Short, calm, and about a person: no counts of inactivity, no "you haven't opened...".
import { toLangCode } from "../languages";

export type Thing = "voice memory" | "photo" | "video";

interface Words {
  voice: (name: string, thing: Thing) => string;
  beat: (name: string) => string;
  thinking: (name: string) => string;
  quiet: (name: string) => string;
  ask: (name: string) => string;
  story: (name: string) => string;
  help: (name: string) => string;
  overdue: (name: string) => string;
  digest: (n: number) => string;
  digestOne: string;
  test: string;
}

const EN: Words = {
  voice: (n, t) => `${n} sent you a ${t}`,
  beat: (n) => `${n} lit the lamp for you`,
  thinking: (n) => `${n} is thinking of you`,
  quiet: (n) => `${n}'s been quiet this morning. Send a voice memory?`,
  ask: (n) => `${n} asked you something`,
  story: (n) => `${n} would like a story`,
  help: (n) => `${n} asked for help`,
  overdue: (n) => `${n} hasn't checked in yet`,
  digest: (n) => `${n} things from your family`,
  digestOne: "Something from your family",
  test: "This is how a note from your family will look.",
};

const HI_LATN: Words = {
  voice: (n, t) => `${n} ne aapko ${t === "voice memory" ? "voice note bheja" : t === "photo" ? "photo bheji" : "video bheja"}`,
  beat: (n) => `${n} ne aapke liye diya jalaya`,
  thinking: (n) => `${n} aapke baare mein soch rahe hain`,
  quiet: (n) => `${n} aaj subah se shaant hain. Ek voice note bhejein?`,
  ask: (n) => `${n} ne aapse kuch poocha`,
  story: (n) => `${n} ko ek kahani chahiye`,
  help: (n) => `${n} ne madad maangi`,
  overdue: (n) => `${n} ne abhi tak check in nahi kiya`,
  digest: (n) => `Parivar se ${n} baatein`,
  digestOne: "Parivar se kuch aaya hai",
  test: "Parivar ka sandesh aise dikhega.",
};

const HI_DEVA: Words = {
  voice: (n, t) => `${n} ने आपको ${t === "voice memory" ? "वॉइस नोट भेजा" : t === "photo" ? "फ़ोटो भेजी" : "वीडियो भेजा"}`,
  beat: (n) => `${n} ने आपके लिए दिया जलाया`,
  thinking: (n) => `${n} आपके बारे में सोच रहे हैं`,
  quiet: (n) => `${n} आज सुबह से शांत हैं। एक वॉइस नोट भेजें?`,
  ask: (n) => `${n} ने आपसे कुछ पूछा`,
  story: (n) => `${n} को एक कहानी चाहिए`,
  help: (n) => `${n} ने मदद माँगी`,
  overdue: (n) => `${n} ने अभी तक चेक इन नहीं किया`,
  digest: (n) => `परिवार की ओर से ${n} बातें`,
  digestOne: "परिवार की ओर से कुछ आया है",
  test: "परिवार का संदेश ऐसा दिखेगा।",
};

/** English unless the recipient's display language has a catalogue here. */
export function wordsFor(lang: string | null | undefined): Words {
  const code = toLangCode(lang);
  return code === "hi-latn" ? HI_LATN : code === "hi-deva" ? HI_DEVA : EN;
}

/** The notification title is always the app's name. */
export const PUSH_TITLE = "Nearer";

export function thingOf(type: string): Thing {
  return type === "audio" ? "voice memory" : type === "video" ? "video" : "photo";
}
