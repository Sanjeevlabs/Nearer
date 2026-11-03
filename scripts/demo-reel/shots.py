"""The shot list of the scripted product demo: one source for the recorder, the captions and the voice-over.

dur is seconds of the trimmed clip. Consecutive clips are cross-faded (XFADE seconds), so the final
cut is sum(dur) - XFADE * (n - 1). Captions and voice-over lines are timed from that.
"""

XFADE = 0.3
CAPTION_IN = 0.35  # a caption appears this long after its clip starts ...
CAPTION_OUT = 0.35  # ... and goes this long before it ends

SHOTS = [
    {"id": 1, "key": "voice", "dur": 10, "caption": "Maa’s voice, with the words on screen.", "vo": "Arjun lives far from Maa. He can still hear her voice, and read her words."},
    {"id": 2, "key": "window", "dur": 8, "caption": "Their sky. Their time. Right now.", "vo": "Their sky, their weather, their time, right now."},
    {"id": 4, "key": "lamp", "dur": 8, "caption": "One tap: I’m thinking of you.", "vo": "One tap says I'm thinking of you."},
    {"id": 7, "key": "together", "dur": 9, "caption": "Open your door for chai. Family can join when they’re free.", "vo": "Open your door for chai, and let family join when they can."},
    {"id": 9, "key": "stories", "dur": 8, "caption": "Dadi’s stories in her voice, with translated words.", "vo": "The grandchildren can listen to Dadi tell a story."},
    {"id": 8, "key": "kitchen", "dur": 8, "caption": "Hear Maa teach a family recipe.", "vo": "In the kitchen, Maa teaches Arjun how she makes dal."},
    {"id": 10, "key": "occasions", "dur": 7, "caption": "The photos and voices from family occasions.", "vo": "Birthdays and other family occasions stay together."},
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
