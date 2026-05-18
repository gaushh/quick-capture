# Quick Capture — Video Walkthrough Script

> Read through once before recording. Sections map to things you'll show on screen.
> Paraphrase freely — these are talking points, not lines to memorise.
> Aim for 6–8 minutes total.

---

## 1. Opening — The problem and the brief

*[App visible. Idle pill sitting in bottom-right corner of the screen.]*

"The goal was to build a mini desktop app for quick audio capture — think Siri for notes.

The problem I was solving is the friction between having a thought and getting it down. Most note-taking tools ask you to open an app, find a document, give it a title. By the time you've done all that, the thought is gone.

And this is a real problem for the user I had in mind — a founder or executive who gets their best ideas mid-flow. They're deep in Slack, replying to emails, writing a cursor prompt — not sitting at a clean desk waiting to take notes. The insight arrives in the middle of something else. Quick Capture is built for that moment.

One principle: the fastest possible path from thought to text. It lives permanently in the corner of your screen, out of the way when you don't need it.

The brief asked for Linear-inspired design. I took that seriously — not just aesthetically, but philosophically. Linear is a tool that respects your attention. Every interaction is intentional, nothing is decorative or random, and the UI never gets in the way of the work. That was my design philosophy."

---

## 2. The idle pill — Earning its screen space

*[Point at the idle pill]*

"This is the resting state. A tiny pill with two controls — a notes icon on the left, a mic button on the right. That's it.

The goal of this app is to sit on top of everything you're doing all day. It should feel ambient while you work and should never demand your attention. The pill earns its screen real estate by staying almost invisible until you need it."

---

## 3. Recording — One keystroke, no friction

*[Trigger recording with ⌃Space]*

"Control-Space from anywhere on your desktop starts recording. No clicking, no focus switching, no opening an app. Or just click the pill directly if you're not a shortcut person. Either way — the pill morphs directly into the full panel and you're live.

Watch the transition — the pill expands using a spring animation, not a linear ease. It reads as the pill breathing open rather than a box appearing. That motion quality matters when something is moving right next to where you're looking."

---

## 4. Transcription — Two-layer approach

*[Speak a sentence, then stop recording with the checkmark]*

"I'm using two transcription sources simultaneously. The browser's built-in Speech Recognition API gives a live visual preview as you speak. Then when you stop, the audio goes to OpenAI Whisper for the final, accurate result.

The reason for both: Speech Recognition is fast but unreliable — it struggles with accents, filler words, anything complex. Whisper is accurate but has latency. So the live waveform keeps the interaction feeling responsive, and the final Whisper result replaces it with clean text.

I also built in silent audio detection. Whisper has a well-known tendency to hallucinate short phrases — 'thank you', 'okay', 'hmm' — when it receives silence or near-silent audio. I maintain a set of these hallucinations and filter them before anything gets added to the feed. No one needs a history full of ghost transcripts."

---

## 5. The notes feed — Information density

*[Show the feed with a few entries]*

"The output panel is where you spend most of your time. I designed it around Linear's approach — maximum information density at minimum visual noise.

Timestamps and bucket labels — Today, Yesterday, Earlier — give you temporal context without cluttering the entry. I removed divider lines between items and let whitespace do that job instead. Borders add visual weight. Removing them makes the list feel lighter and faster to scan.

All transcripts are read-only. You can't accidentally edit them by clicking. The only editable surface is the tracked-changes diff during Refine mode, which I'll show shortly. This was a deliberate decision — your captured words are a record, not a scratch pad."

---

## 6. Action buttons — Icon-only with purpose

*[Hover over an entry to reveal the action buttons]*

"When you hover an entry there are three actions to note, occasionally four: Refine, Copy, Move to, and Restore. They're icon-only — no labels — because at this scale, labels add noise. Hovering any icon shows a tooltip with the name and a short description. The tooltip delay is 500ms — long enough that it doesn't flash on accidental mouseovers, short enough that it's useful when you actually pause.

Refine sends the transcript to GPT and renders the suggestions as a tracked diff — additions in one colour, deletions struck through. You can accept individual suggestions by clicking them, or edit the text directly. This matters because AI cleanup can occasionally overcorrect. The diff gives you visibility before anything changes.

Restore brings your original transcript back if you've refined it and want to start over.

Copy copies to clipboard. The icon swaps to a checkmark and holds for a moment — small feedback, but it closes the loop.

Move to is the routing action. I'll demo that shortly."

---

## 7. The left rail — Always-present navigation

*[Point at the left rail icons]*

"The sidebar is always visible — Notes, Tasks, Ideas, Reminders. Four folders for categorisation. No labels, just icons. Labels appear as tooltips on hover.

The unselected state is just the icon, no background. The selected state gets a subtle grey fill — the same token used for hover states throughout the app. No accent colour, no heavy outline. The selected state is clear but quiet. If the nav competed with the content, you'd always be looking at the wrong thing.

This sidebar is the core navigation layer of the whole app. The idea is that a founder or an executive captures a thought in under three seconds, then comes back to it later through the right folder — not by scrolling through a raw list. Tasks for things to act on. Ideas for insights to develop. Reminders for things that need to resurface. The sidebar is how raw transcript becomes organised thought."

---

## 8. Move to — Routing thoughts into the right bucket

*[Click the Move to icon, select Tasks]*

"The Move to action is where the real value of the app lives. A voice note is raw material. The Move to flow is how you turn it into something structured.

When you click Move to, you get three options: Tasks, Ideas, or Reminders. Choosing one sends the transcript to GPT, which extracts the relevant structured items. That extraction shows up in a review modal before anything gets saved.

Think about the use case — you've just finished a call and you have three minutes before your next one. You recorded a quick note. One tap on Move to Tasks and GPT has already pulled out the action items, ready to review. You're going from raw voice to an organised task list in about ten seconds.

I kept it as a single action — one button, one destination, one review — so it registers as a core behaviour. The power of the app is in that loop: capture, route, act."

---

## 9. The Tasks panel — Linear-inspired status system

*[Navigate to Tasks panel, show the task list]*

"When you move a note to Tasks, each extracted draft has a status selector. It defaults to Not Started. You can change it before adding — if you're moving a note that says 'start the investor update tonight', you might want to immediately mark that as In Progress. By the time tasks land in your Tasks panel, they already have the right status. You're not doing a second pass to categorise what you just added.

In the Tasks panel, tasks are grouped into three categories: Not Started, In Progress, and Done. Only sections with tasks are shown — if you have nothing done yet, that section doesn't appear. The grouping is automatic based on each task's status.

Each task has a status indicator on the left. An empty grey ring is Not Started. A half-filled accent ring is In Progress. A filled circle with a check is Done. Clicking the circle opens a small floating picker — smart about direction, opens upward if there's not enough space below. Next to the icon is a small text label so the state is legible at a glance."

---

## 10. The Ideas panel — Capturing raw insight

*[Navigate to Ideas panel, show a few idea entries]*

"Ideas work differently from Tasks. When you move a note to Ideas, GPT doesn't extract a checklist — it surfaces the core insight from what you said, gives it a title, and preserves the supporting detail as the body.

The panel is designed for the kind of thinking that happens mid-stream. You're not sitting down to write a strategy doc — you're in the middle of something and a thought lands. The Ideas folder is where it goes so it doesn't disappear. Title at the top so you can scan quickly. Body below for the fuller context.

The current design is intentionally lightweight — it's a starting point. The way I think about this panel longer term is that it should feel less like a form and more like a scratchpad: flowing text, auto-extracted title, an optional tag to route by theme — Product, Strategy, Content. But even as it stands, it solves the core problem: the idea is captured, named, and there when you need it."

---

## 11. The moved-to badge — Provenance and re-routing

*[Show a note that has been moved, click the badge]*

"After moving a note to a folder, the Move to button is replaced by a small badge showing which folder it went to — Tasks, Ideas, or Reminders. This is provenance — you know at a glance that this note has already been processed.

The badge is clickable. Clicking it opens a contextual dropdown: remove it from the current folder, or move it to one of the other two. The re-route goes through the full review modal. So if you moved something to Tasks and then realised it was actually an idea, two taps and it's in Ideas."

---

## 12. The Reminders panel — Things that need to resurface

*[Navigate to Reminders panel, show a few entries]*

"Reminders are for thoughts that aren't tasks and aren't ideas — they're things you want to surface again. A follow-up you need to remember. Something to check on next week. A name someone mentioned that you want to look up later.

When you move a note to Reminders, GPT extracts the reminder items and presents them for review. In the Reminders panel they sit as a list you can toggle off once they're done. Simple and direct.

This is currently a lightweight implementation — it captures the core behaviour. Longer term, I'd want Reminders to have an actual time dimension: due dates, a daily digest, push notifications. That's the version that makes it genuinely useful for an executive who needs things to resurface at the right moment, not just sit in a list."

---

## 13. Bulk delete — Selection mode

*[Tap the trash icon, select a few entries, delete]*

"The trash icon enters selection mode. The sidebar stays visible — only the per-entry action buttons are hidden. Checkboxes appear in the left margin and the panel header swaps to show a Cancel button.

At the bottom, a sticky bar shows a count and a Delete button. The count updates live as you select. The Delete button is muted until at least one item is selected.

I chose this pattern — enter selection, select items, confirm at bottom — over per-row delete buttons because voice notes are things you want to keep. A per-row button that's always one misclick away from destroying a note felt wrong for this content type. This pattern requires intent."

---

## 14. Feedback — Closing every loop

*[Perform a few actions — toggle a task, delete a note, move a note]*

"Every mutating action in the app fires a toast. Add a task — 'Task added'. Toggle status — 'In Progress' or 'Task done'. Delete notes — 'Deleted 2 notes'. Move a note — '3 added to Tasks'. Remove from a folder — 'Removed from Ideas'.

Without acknowledgements, users are left wondering if the action worked. Every state change gets a confirmation. The toasts are brief — 1.8 seconds — and they appear at the bottom of the panel where they don't obscure content."

---

## 15. What I would build next

"A few things I'd want to add with more time.

The most interesting is custom folders. Right now the four panels — Notes, Tasks, Ideas, Reminders — are fixed. The extension I'd build is letting users define their own categories. But more than just a label: each custom folder would have a skill attached to it — a short instruction that tells GPT how to extract and structure content from a transcript specifically for that folder. So a founder might create a 'VC Prep' folder with a skill that pulls out investor objections and talking points. An exec might have a 'Team Feedback' folder that extracts action items and names. The folder becomes a routing rule, and the skill is the intelligence behind it.

On Reminders — the current version is lightweight, deliberately so. What I'd build is a full time layer: due dates, a daily morning digest, and notifications that surface the right reminder at the right moment. The use case I have in mind is someone who records a note at 9pm — 'follow up with David tomorrow about the term sheet' — and gets a nudge at 9am without having to remember to check the app.

Search across the feed is the other obvious gap. Once you have more than a week of captures, finding anything requires scrolling. A simple text filter with keyword highlighting would unlock the history in a way that makes the app genuinely useful as a long-term capture layer, not just a today tool.

But the core loop — capture, transcribe, route, act — is solid. And it's fast. That's the thing I'd want someone evaluating this to feel: it never gets in your way. Thanks for watching."

---

*Total estimated time: 6–8 minutes*
