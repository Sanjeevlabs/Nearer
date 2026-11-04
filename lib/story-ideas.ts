// Stories to tell (SPEC §29.14): well-known folk tales, in our own short
// outlines, for a parent or grandparent to retell in their own voice. The
// telling is theirs; the outline is only a memory jog. Data, not logic.

export interface StoryIdea {
  id: string;
  title: string;
  /** Who tells it best: anyone; the outline keeps it short. */
  ages: "under-5" | "5-8" | "9-12" | "all";
  /** Three beats to jog the memory, never a script. */
  beats: [string, string, string];
  /** What the child takes away. */
  lesson: string;
  /** "family-story" marks a "Do you know?" prompt about the family itself, not a folk tale. */
  tags?: string[];
  /**
   * Family stories only. The child's side of the same prompt, in first person,
   * finishing "Tell me a story about …" (the existing ask flow adds the front).
   */
  ask?: string;
}

export const STORY_IDEAS: StoryIdea[] = [
  { id: "monkey-crocodile", title: "The monkey and the crocodile", ages: "5-8", beats: ["A monkey shares sweet jamun fruit with a crocodile every day", "The crocodile's wife wants the monkey's heart, so he tricks the monkey onto his back", "Mid-river, the monkey says he left his heart up in the tree, and escapes"], lesson: "Keep a calm head when you are in trouble" },
  { id: "thirsty-crow", title: "The thirsty crow", ages: "under-5", beats: ["A crow, very thirsty on a hot day, finds a pot with a little water at the bottom", "His beak can't reach, so he drops in pebbles, one by one", "The water rises and he drinks"], lesson: "Patience and a little thinking solve big problems" },
  { id: "lion-mouse", title: "The lion and the mouse", ages: "under-5", beats: ["A lion catches a tiny mouse and lets it go when it begs", "Later the lion is caught in a hunter's net", "The mouse chews the ropes and frees him"], lesson: "No one is too small to help" },
  { id: "tortoise-geese", title: "The tortoise who talked too much", ages: "5-8", beats: ["Two geese carry their friend the tortoise across the sky on a stick", "He must hold the stick in his mouth and not speak", "People below laugh, he answers back, and lets go"], lesson: "Some moments call for staying quiet" },
  { id: "blue-jackal", title: "The blue jackal", ages: "5-8", beats: ["A jackal falls into a vat of blue dye", "The forest animals think he is a strange new king", "When the jackals howl, he howls too, and everyone knows him"], lesson: "Be who you are; pretending doesn't last" },
  { id: "clever-hare", title: "The hare and the lion in the well", ages: "5-8", beats: ["A greedy lion eats one animal every day", "A small hare, late on purpose, says another lion lives in the well", "The lion roars at his reflection, jumps in, and the forest is free"], lesson: "Wit beats strength" },
  { id: "golden-goose", title: "The goose with golden feathers", ages: "9-12", beats: ["A kind goose gives a poor family one golden feather at a time", "Someone gets greedy and plucks every feather at once", "The feathers turn ordinary and the goose never returns"], lesson: "Greed loses what patience would have kept" },
  { id: "elephant-rope", title: "The elephant and the thin rope", ages: "9-12", beats: ["A huge elephant stands tied with just a thin rope", "It was tied with that rope as a baby, when it couldn't break free", "It still believes it can't, so it never tries"], lesson: "Old limits aren't always real" },
  { id: "your-own", title: "A story only you know", ages: "all", beats: ["The house you grew up in, or the walk to school", "Something that went wrong, and what you did", "What you learnt that you still use"], lesson: "Where the family comes from" },
];

// ---------------------------------------------------------------------------
// "Do you know?" prompts. Children who know where their grandparents grew up,
// how their parents met and how the family came through hard times do better
// (Duke and Fivush). The tellings that matter most go up and down: a hard
// time, and how the family came through. Written for an elder to tell a
// grandchild. {child} (the elder's own son or daughter) and {grandchild} are
// filled in from the family when the page draws, never written into this file.
// ---------------------------------------------------------------------------
export const FAMILY_STORY_TAG = "family-story";

const fam = (id: string, title: string, beats: [string, string, string], lesson: string, ask: string): StoryIdea => ({ id, title, ages: "all", beats, lesson, tags: [FAMILY_STORY_TAG], ask });

export const FAMILY_STORY_IDEAS: StoryIdea[] = [
  fam("fs-street", "Where you grew up, and what the street sounded like", ["The house, the lane, the smells at different hours", "Who lived next door, and who you played with", "One sound you can still hear in your head"], "Where the family comes from", "where you grew up and what the street sounded like"),
  fam("fs-met", "How the two of you met", ["The first time you saw each other", "Who was nervous, and who pretended not to be", "What both families said"], "Every family starts with two people", "how the two of you met"),
  fam("fs-hard-year", "A hard year, and how the family came through", ["What went wrong that year", "Who helped, and what each person gave up", "The day things started to turn"], "Hard times pass, and the family is what carries you", "a hard year and how the family came through"),
  fam("fs-born", "The day {child} was born", ["Where you were and who was with you", "The moment you first saw the baby's face", "What you whispered, or promised"], "You were awaited and loved from the first day", "the day I was born"),
  fam("fs-grandparents", "Where your own grandparents lived", ["The way to their house and what you saw on the way", "What they cooked, and where everyone sat", "What they said when you left"], "You come from people who loved their children's children too", "where your grandparents lived"),
  fam("fs-first-job", "Your first job, and your first pay", ["How you found it and how nervous you were", "What you did with the first money", "Who you told first"], "Everyone starts small", "your first job and your first pay"),
  fam("fs-scared", "A time you were really scared, and what got you through", ["Where it happened and what you feared", "Who or what you held on to", "How it felt when it was over"], "Being frightened is normal; you can still get through", "a time you were really scared"),
  fam("fs-wedding", "Your wedding day, including what went wrong", ["The morning, and the thing nobody planned for", "How the family fixed it together", "What you remember most now"], "Things go wrong, and the day is still beautiful", "your wedding day and what went wrong"),
  fam("fs-name", "How {grandchild} got their name", ["Who suggested it and who disagreed", "What the name means in the family", "The name you nearly chose instead"], "Your name was chosen with love", "how I got my name"),
  fam("fs-moved", "The day the family moved, or you left home for the first time", ["What you packed and what you left behind", "The last look at the old place", "The first night somewhere new"], "You can leave a place and still carry it with you", "the day you left home"),
  fam("fs-lost", "Something precious you lost, and what came after", ["What it was and why it mattered so much", "How you felt that week", "What you found in its place"], "Losing something is sad, and good things can follow", "something precious you lost"),
  fam("fs-festival", "A festival from your childhood, and what made it special", ["The days of getting ready", "The food, the clothes, the noise", "The small thing you did every year"], "Traditions are how a family remembers itself", "a festival from when you were small"),
  fam("fs-dish", "A dish your mother made, and what it tasted like", ["The smell from the kitchen", "Who helped and who waited", "The way you make it now, or wish you could"], "Love can be tasted", "a dish your mother made"),
  fam("fs-school", "A teacher you never forgot", ["What the school looked like and how you got there", "What this teacher said or did", "How it changed you"], "One kind person can change a path", "a teacher you never forgot"),
  fam("fs-proud", "A time you were proud of {child}", ["What was happening in their life then", "What you saw them do", "What you wanted to tell them"], "Being proud of each other is part of loving each other", "a time you were proud of your own child"),
  fam("fs-mistake", "A mistake you made, and what you learned", ["What you did and why it seemed right", "What happened, and who found out", "What you do differently now"], "Everybody makes mistakes, and they can teach us", "a mistake you made and what you learned"),
  fam("fs-helped", "Someone who helped the family when it needed help", ["What the family was going through", "Who showed up, and what they did", "How you thanked them, or still wish to"], "People remember kindness, and so does a family", "someone who helped your family"),
  fam("fs-held", "The first time you held {grandchild}", ["Where it was and what you were wearing", "What you thought, looking at the tiny hands", "What you hoped for them"], "A new child makes the whole family start again", "the first time you held me"),
  fam("fs-letters", "How you kept in touch with family before phones", ["Letters, a neighbour's telephone, a message passed along", "How long the waiting felt", "The news you will never forget getting"], "Staying close takes effort, and it is worth it", "how you kept in touch before phones"),
  fam("fs-laughed", "A time the whole family laughed until they cried", ["Who was there and where", "What set it off", "Whether anyone can say it now without laughing"], "Laughing together is how a family holds on", "a time the whole family laughed until they cried"),
  fam("fs-grandparents-work", "What your grandparents did each day", ["One thing you watched them do", "What they used to do it", "What you tried yourself"], "A little of what everyday life was like", "what your grandparents did each day"),
  fam("fs-parents-met", "How your parents first met", ["Where they met, if you remember", "Who told you the story", "The detail that stayed with you"], "A story passed down through the family", "how your parents first met"),
  fam("fs-grandmother-recipe", "A recipe your grandmother taught you", ["The first thing she showed you", "How she knew it was ready", "The part you still do her way"], "A recipe keeps a little of the person who taught it", "a recipe your grandmother taught you"),
  fam("fs-family-saying", "A saying you heard often at home", ["Who used to say it", "When you would hear it", "Whether you still say it"], "Small phrases carry a family's voice", "a saying you heard often at home"),
];

/** Fill {child} and {grandchild} from the family, rotating through the names so prompts differ. */
export function resolveIdea(idea: StoryIdea, names: { children: string[]; grandchildren: string[] }, n = 0): StoryIdea {
  const pick = (list: string[], fallback: string) => (list.length ? list[n % list.length] : fallback);
  const fill = (t: string) => t.replace(/\{child\}/g, pick(names.children, "your child")).replace(/\{grandchild\}/g, pick(names.grandchildren, "your grandchild"));
  return { ...idea, title: fill(idea.title), beats: idea.beats.map(fill) as StoryIdea["beats"], lesson: fill(idea.lesson) };
}

/** N prompts for today, a window that moves by day through the family stories. */
export function familyStoriesFor(date: string, count: number, skip: (i: StoryIdea) => boolean = () => false): StoryIdea[] {
  const day = Math.floor(Date.parse(`${date}T00:00:00Z`) / 86_400_000);
  const pool = FAMILY_STORY_IDEAS.filter((i) => !skip(i));
  const start = day % Math.max(1, pool.length);
  return Array.from({ length: Math.min(count, pool.length) }, (_, k) => pool[(start + k) % pool.length]);
}

/** Today's suggestion: rotates by day, skipping titles this family already has. */
export function ideaFor(date: string, told: string[]): StoryIdea {
  const day = Math.floor(Date.parse(`${date}T00:00:00Z`) / 86_400_000);
  const fresh = STORY_IDEAS.filter((s) => !told.some((t) => t.toLowerCase().includes(s.title.toLowerCase().replace(/^the /, ""))));
  const pool = fresh.length ? fresh : STORY_IDEAS;
  return pool[day % pool.length];
}
