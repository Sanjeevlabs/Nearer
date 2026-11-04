"""The shot list of the scripted product demo: one source for the recorder, the captions and the voice-over.

dur is seconds of the trimmed clip. Consecutive clips are cross-faded (XFADE seconds), so the final
cut is sum(dur) - XFADE * (n - 1). Captions and voice-over lines are timed from that.
"""

XFADE = 0.3
CAPTION_IN = 0.35  # a caption appears this long after its clip starts ...
CAPTION_OUT = 0.35  # ... and goes this long before it ends

SHOTS = [
    {"id": 1, "key": "landing", "dur": 9, "caption": "Talk, don’t type.", "vo": "Arjun opens Nearer. There’s Maa and Papa’s window, with their sky and their time."},
    {"id": 2, "key": "lamp", "dur": 6, "caption": "I’m thinking of you.", "vo": "He lights their lamp. Just a small hello."},
    {"id": 3, "key": "voice", "dur": 9, "caption": "Maa’s voice, with words and translation.", "vo": "Maa leaves him a note. Muse writes down her words and translates them."},
    {"id": 4, "key": "photo", "dur": 11, "caption": "A little piece of today.", "vo": "Inside, he adds a photo from his day. Muse drafts a caption for the family."},
    {"id": 5, "key": "recipe", "dur": 7, "caption": "A recipe, in Maa’s own voice.", "vo": "In the kitchen, Maa teaches him her dal, just as she makes it."},
    {"id": 6, "key": "chef", "dur": 8, "caption": "Something to cook with what you have.", "vo": "When he needs an idea, Muse suggests a whole recipe from what he has."},
    {"id": 7, "key": "notification", "dur": 3.5, "caption": "Tea with Maa?", "vo": "Maa’s having tea."},
    {"id": 8, "key": "call", "dur": 9, "caption": "Pull up a chair.", "vo": "He taps to join. She sees him arrive, just in time for tea."},
    {"id": 9, "key": "habit", "dur": 7, "caption": "A morning walk, together.", "vo": "They take their morning walks apart, and keep the days together."},
    {"id": 10, "key": "story", "dur": 7, "caption": "A story only she can tell.", "vo": "And at bedtime, the children can hear a story in her voice."},
    {"id": 11, "key": "private", "dur": 10.1, "caption": "Just for Maa.", "vo": "Some words are only for Maa. He can send those just to her."},
]
END_CARD = {"id": 12, "key": "end", "dur": 3, "caption": "Nearer — far from home, never far from them.", "vo": "Nearer. Far from home, never far from them."}

ALL = SHOTS + [END_CARD]


def starts() -> list[float]:
    """Start time of each clip in the final cut (end card included)."""
    out, t = [], 0.0
    for s in ALL:
        out.append(t)
        t += s["dur"] - XFADE
    return out


def total() -> float:
    return sum(s["dur"] for s in ALL) - XFADE * (len(ALL) - 1)
