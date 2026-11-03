"""The shot list of the scripted product demo: one source for the recorder, the captions and the voice-over.

dur is seconds of the trimmed clip. Consecutive clips are cross-faded (XFADE seconds), so the final
cut is sum(dur) - XFADE * (n - 1). Captions and voice-over lines are timed from that.
"""

XFADE = 0.3
CAPTION_IN = 0.35  # a caption appears this long after its clip starts ...
CAPTION_OUT = 0.35  # ... and goes this long before it ends

SHOTS = [
    {"id": 1, "key": "landing", "dur": 8, "caption": "No sign-up. A family opens.", "vo": "This is Arjun. His parents live more than two thousand kilometres away. He opens one screen."},
    {"id": 2, "key": "window", "dur": 8, "caption": "Their sky. Their time. Right now.", "vo": "Their sky, their weather, their time, right now."},
    {"id": 3, "key": "safe", "dur": 10, "caption": "He knows they’re okay — without tracking them.", "vo": "He knows they’re okay. Nobody is tracked; it’s only their time in Nearer."},
    {"id": 4, "key": "lamp", "dur": 10, "caption": "One tap: I’m thinking of you.", "vo": "One tap says “I’m thinking of you.”"},
    {"id": 5, "key": "maa", "dur": 6, "caption": "It glows in her home for three days.", "vo": "It glows in their home for three days."},
    {"id": 6, "key": "voice", "dur": 10, "caption": "She speaks her way. Muse writes and translates it.", "vo": "Maa talks the way she talks. Muse writes it down and translates it."},
    {"id": 7, "key": "door", "dur": 8, "caption": "Inside: everything the family keeps.", "vo": "Inside is everything the family keeps."},
    {"id": 8, "key": "kitchen", "dur": 10, "caption": "Parents don’t just receive care. They give.", "vo": "Parents don’t just receive care. They give, and see it land."},
    {"id": 9, "key": "inbox", "dur": 8, "caption": "Everything sent to you, in one place.", "vo": "Everything sent to you, in one place."},
    {"id": 10, "key": "send", "dur": 8, "caption": "Can’t be there? Send something real.", "vo": "And when you can’t be there, send something real."},
    {"id": 11, "key": "rohan", "dur": 4, "caption": "Any family. Any country.", "vo": "Any family. Any country."},
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
