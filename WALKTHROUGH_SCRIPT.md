# Quick Capture — Video Walkthrough Script

> **How to use this:** Read through once before recording. Each section maps to something you'll show on screen. Feel free to paraphrase — these are talking points, not lines to memorize verbatim. Aim for ~5–8 minutes total.

---

## 1. Opening — What this is and why

*[App visible, idle pill sitting in the bottom-right corner of the screen]*

"So, the brief was to build a mini desktop app for quick audio capture — think Siri, but for notes. The core problem I was solving is the friction between having a thought and writing it down. Most note-taking tools ask you to open an app, create a document, give it a title. By that point the thought is gone.

Quick Capture is designed around a single principle: the fastest path from thought to text. It lives in the corner of your screen, stays out of your way when you don't need it, and is one keystroke away when you do."

---

## 2. The idle pill — Minimal footprint

*[Point at the idle pill sitting in the corner]*

"The starting state is a small 124×38px pill — just two buttons separated by a divider. The left one opens your notes feed, the right one starts recording. That's the entire idle UI.

The rationale here is desktop real estate. This app needs to live on top of everything else — it's always-on-top by design — so it has to earn its screen space. A pill this small is less intrusive than a macOS menu bar icon but always visible and one click away.

I used a very light shadow on it — `2px 6px rgba(0,0,0,0.06)` plus a hairline border — not the heavier elevation shadow that the output panel uses. The idle pill should read as a lightweight, ambient element, not a prominent UI surface."

---

## 3. Starting a recording — ⌃Space shortcut

*[Trigger recording via button or shortcut]*

"You can start recording by clicking the mic icon or hitting ⌃Space anywhere on your desktop. That global shortcut is the main interaction — the whole point is that you never have to reach for the mouse.

When recording starts, the app transitions from the pill directly into the full notes panel. I made a deliberate decision here: recording is embedded inside the scratchpad rather than being its own isolated state. This is because I wanted history to be visible while you're speaking — you can see what you've said before, which helps you pick up a train of thought."

---

## 4. The three-phase morphing animation

*[Trigger the idle → recording → output transition a few times slowly]*

"There are three phases: idle, recording, and output. The shell — this outer container — morphs between them using a spring animation rather than a linear ease. It changes both its dimensions and its border-radius at the same time, so the pill rounds into a card rather than snapping.

I chose spring physics because it feels alive in a way that ease-in-out doesn't. The app is operating close to the user's cursor, so motion quality matters more here than it would inside a regular window. This was one of the details specifically called out in the brief — microanimations as a craft signal."

---

## 5. While recording — The listening bar

*[Show the recording state with the waveform bar at the bottom]*

"When recording is active, a floating bar appears at the bottom of the panel. It has three elements: a pulsing 'Listening' label on the left, an animated waveform in the centre, and cancel/confirm buttons on either end.

A few specific decisions here:

The waveform bars respond to actual mic input level in real time — I'm using the Web Audio API to sample frequency data on every animation frame and map it to the opacity of the blob elements. So if you speak louder the waveform gets more active, if the room is silent it goes still. This makes it feel genuinely reactive rather than just decorative.

The 'Listening' label pulses — it fades between 40% and full opacity over 1.8 seconds. It's subtle. I deliberately avoided putting a 'Listening' label anywhere else on screen because with the waveform already animated and the label already pulsing, a third animation would have been competing noise.

The X button on the left discards the recording entirely — no audio gets sent to Whisper, the panel goes back to showing your previous notes unchanged. The checkmark on the right commits it. This gives users an explicit opt-out at any moment without losing prior work."

---

## 6. Transcription — Two-layer approach

*[Stop recording, show the transcribing spinner, then show the result]*

"When you hit the checkmark, the audio blob gets sent to OpenAI Whisper for transcription. I'm using two sources simultaneously: the browser's built-in SpeechRecognition API for a live visual preview while you're speaking, and Whisper for the final, accurate result.

The reason for both: SpeechRecognition is fast but unreliable — it struggles with accents, background noise, and anything that isn't clearly-phrased English. Whisper is accurate but has latency. So during recording the user sees live text building up as they speak, which keeps the interaction feeling responsive, and then on commit the real Whisper transcript replaces it.

During the transcribing state there's a small spinner in the recording bar. I kept it minimal — a 14px spinning ring in the accent colour — rather than a full loading overlay, because the feed behind it is still readable and I didn't want to occlude content unnecessarily."

---

## 7. New entry highlight — Orientation cue

*[Show a freshly transcribed entry at the top of the feed]*

"When a new transcript appears in the feed, that row briefly shows a light grey background that fades away over about five seconds. It's a subtle animation — the background just eases to transparent.

The rationale is spatial orientation. The feed is ordered oldest-to-newest with the newest entry at the bottom, which means after a transcription completes, your eye has to find where the new content appeared. The highlight removes that cognitive search — it's saying 'here's the new thing' without being disruptive. After five seconds it's gone and the feed looks uniform again."

---

## 8. The notes feed — Design language

*[Show the feed with a few entries]*

"The output panel uses a design language I'd describe as Linear-influenced: Inter as the typeface, a tight monochromatic token system, minimal chrome, no decorative elements. The heading 'Voice notes' is semibold at 17px with tight tracking. Timestamps are 12px in a muted colour. Entry text is 14px at 1.45 line height.

I removed divider lines between entries. Whitespace is doing that job instead — each entry has 11px of vertical padding and the visual separation is just the gap, not a rule. Borders add visual weight; removing them makes the list feel lighter and more readable.

The brief specifically said 'inspired by Linear' — so I leaned into Linear's approach of maximum information density at minimum visual noise. Every pixel has to earn its presence."

---

## 9. Actions per entry — Refine, Copy, Restore

*[Hover over an entry to show the action buttons]*

"Each entry has actions that appear next to the timestamp. For the latest entry: Refine, Copy, and conditionally Restore. For past entries: the same set.

**Refine** sends the note to GPT and gets back a cleaned version. Instead of just replacing the text, I render the suggestions as a tracked diff — additions highlighted in one colour, deletions struck through in another, directly in the note body. This way the user can see exactly what the AI wants to change before accepting it. You can click any suggested addition to accept just that word, or edit the tracked note directly, or hit Restore to revert to the original.

The reason for the diff view rather than a straight replacement: these are voice transcripts, so 'corrections' might occasionally be wrong. The AI might mishear what you meant to keep. Showing the change as a diff rather than a fait accompli gives the user control without adding extra steps for the common case.

**Copy** copies the note to clipboard. If you're in the tracked diff view, it copies the accepted text — deletions stripped, additions kept as plain text. When you click it, the icon swaps to a checkmark and the label changes from 'Copy' to 'Copied' for 900ms. Small feedback, but it closes the loop — the user knows the action fired.

**Restore** only appears after you've run Refine. It takes you back to the raw transcript. One tap, no confirmation modal."

---

## 10. Checklist mode — Spoken to-do lists

*[Demo: speak a list of tasks, then trigger checklist format]*

"One of the sample use cases in the brief was speaking a to-do list. I implemented a checklist mode — after transcribing, if you toggle to checklist view, the raw text gets sent to GPT to be reformatted as structured tasks.

The items then render as an actual interactive checklist — you can check things off, the label gets a strikethrough, the colour shifts to muted. Each item animates in with a staggered delay, 90ms apart, which gives the list a satisfying cascade effect rather than everything appearing at once.

If you start another recording while in checklist mode, the existing items stay visible at reduced opacity while new audio comes in, and after transcription the combined text gets re-formatted as tasks. The 'Adding more…' label appears between the existing list and the live preview to signal what's happening."

---

## 11. Inline editing — Click to expand and correct

*[Click a past entry text to expand it for editing]*

"Past entries are clamped to three lines by default. If an entry is longer, an ellipsis clips it, and clicking the text expands it accordion-style. This keeps the feed scannable without permanently truncating content.

Once expanded, the text becomes directly editable — it's a contentEditable div that saves on blur. This handles the brief's requirement for quick corrections to speech-to-text mistakes. You don't need to enter a separate 'edit mode' or tap a pencil icon — clicking the text just makes it editable. Pressing Escape or clicking away commits the change."

---

## 12. Bulk delete — Selection mode

*[Tap the trash icon, show selection mode, delete some entries]*

"The trash icon in the header enters selection mode. Each entry gets a checkbox in the left margin and the header swaps its controls for 'Cancel'. At the bottom of the panel, a sticky action bar shows a count of selected items and a Delete button.

This pattern — enter selection, select, confirm at bottom — follows established mobile conventions for multi-select. It's more forgiving than a per-row delete button that's always one misclick away from losing a note, and it supports bulk operations naturally."

---

## 13. Continue from note — ⌃Space in output state

*[Show the output panel, then hit ⌃Space to start a second recording]*

"Here's a flow that I think demonstrates how the keyboard shortcut changes the experience. If you're looking at your notes and hit ⌃Space again, it doesn't create a new note from scratch — it starts a recording that will *append* to the current note.

This is the 'thinking in fragments' use case. You dictate something, realise you have more to add, hit ⌃Space without thinking, keep talking. The second recording gets merged at the end of the first with a single space. It's seamless."

---

## 14. Dark mode

*[Toggle dark/light mode with the moon/sun icon]*

"The dark/light toggle is in the header alongside the other chrome controls. The preference is persisted to localStorage and applied as a CSS class on the root element rather than relying on system `prefers-color-scheme` — this keeps the pill appearance consistent regardless of system settings.

The dark mode palette uses `#111111` for the canvas and `#191919` for surfaces, with white at 10.6% opacity for borders. This follows the same token structure as the light mode so every component adapts without special-casing. I kept the colour system entirely monochromatic except for the accent — a single blue — used only for the AI-suggested additions and spinner rings."

---

## 15. Icon system

*[Point out a few icons across the UI]*

"All icons are from Lucide React at a stroke weight of 1.65. This specific weight is thinner than the default 2.0 and gives the icons a refined, editorial quality that matches the rest of the typographic palette. Heavier strokes would have felt too heavy against the 14px text.

I created thin wrapper components for each icon — MicIcon, CopyIcon, TrashIcon, etc. — that all share a constant `SW = 1.65` stroke weight. This means the visual weight is locked across every icon in the app regardless of which icon is used where."

---

## 16. What I'd add with more time

"If I had more time I'd want to work on a few things:

The onboarding moment — right now if you open the app fresh it says 'No captures yet.' I'd want a more inviting empty state that explains the ⌃Space shortcut immediately.

Search — once the feed has more than a handful of entries, finding something specific requires scrolling. A simple text filter would be high value.

Tagging or folders — light organisation for people who capture a lot.

And on the AI side, a more conversational interaction where you could follow up on a note — 'turn this into a bullet list', 'make this shorter' — rather than just a single-pass Refine operation.

But those are second-layer features. The core — capture, transcribe, correct, copy — I'm happy with how it works and how it feels."

---

## Closing

"The brief was to build something small but polished. I tried to treat every interaction as if it mattered — the spring on the phase transition, the waveform responding to your voice, the diff showing you exactly what the AI wants to change. The goal was a tool you'd actually want to keep open in the corner of your screen. Thanks for watching."
