# Quick Capture — Video Walkthrough Script

> Read through once before recording. Sections map to things you'll show on screen.
> Paraphrase freely — these are talking points, not lines to memorise.
> Aim for 6–8 minutes total.

---

## 1. Opening — The problem and the brief

*[App visible. Idle pill sitting in bottom-right corner of the screen.]*

"The brief was to build a mini desktop app for quick audio capture — think Siri for notes.

The problem I was solving is the friction between having a thought and getting it down. Most note-taking tools ask you to open an app, find a document, give it a title. By the time you've done all that, the thought is gone.

Quick Capture is built around one principle: the fastest possible path from thought to text. It lives permanently in the corner of your screen, out of the way when you don't need it, and one keystroke away when you do.

The brief asked for Linear-inspired design. I took that seriously — not just aesthetically, but philosophically. Linear is a tool that respects your attention. Every interaction is intentional, nothing is decorative, and the UI never gets in the way of the work. That's what I aimed for here."

---

## 2. The idle pill — Earning its screen space

*[Point at the idle pill]*

"This is the resting state. A 124 by 38 pixel pill with two controls — a notes icon on the left, a mic button on the right. That's it.

The design decision here is about desktop real estate. This app has to sit on top of everything you're doing all day. At this size it's smaller than most menu bar dropdowns. I used a very subtle shadow — barely there — because in the idle state this should feel like ambient furniture, not a feature demanding your attention.

I also chose a pill shape rather than a square or rounded rectangle. The pill reads as a transient, lightweight element — it signals that this thing is going to expand and contract, that it's dynamic. A rectangle would feel like a window. This doesn't."

---

## 3. Recording — One keystroke, no friction

*[Trigger recording with ⌃Space]*

"Control-Space from anywhere on your desktop starts recording. No clicking, no focus switching, no opening an app. The pill morphs directly into the full panel and you're live.

Watch the transition — the pill expands using a spring animation, not a linear ease. The border-radius and dimensions change simultaneously, so it reads as the pill breathing open rather than a box appearing. I used spring physics specifically because this app operates close to your cursor. When something moves right next to where you're looking, motion quality matters more than it would inside a normal window.

Once you're recording, you see a live waveform at the bottom. Those bars are responding to your actual microphone input in real time — I'm sampling frequency data from the Web Audio API on every animation frame. If you speak louder, the waveform gets more active. If the room goes quiet, it settles. It's not decorative — it's giving you genuine feedback that the mic is working."

---

## 4. Transcription — Two-layer approach

*[Speak a sentence, then stop recording with the checkmark]*

"I'm using two transcription sources simultaneously. The browser's built-in Speech Recognition API gives a live visual preview as you speak — you can see words appearing in real time. Then when you stop, the audio goes to OpenAI Whisper for the final, accurate result.

The reason for both: Speech Recognition is fast but unreliable — it struggles with accents, filler words, anything complex. Whisper is accurate but has latency. So the live preview keeps the interaction feeling responsive, and the final Whisper result replaces it with clean text.

I also built in silent audio detection. Whisper has a well-known tendency to hallucinate short phrases — 'thank you', 'okay', 'hmm' — when it receives silence or near-silent audio. I maintain a set of these hallucinations and filter them before anything gets added to the feed. No one needs a history full of ghost transcripts."

---

## 5. The notes feed — Information density

*[Show the feed with a few entries]*

"The output panel is where you spend most of your time. I designed it around Linear's approach — maximum information density at minimum visual noise.

Timestamps and bucket labels — Today, Yesterday, Earlier — give you temporal context without cluttering the entry. I removed divider lines between items and let whitespace do that job instead. Borders add visual weight. Removing them makes the list feel lighter and faster to scan.

The typography is Inter — 14px for body text, 12px for timestamps, semibold at 17px for the header. Every size is intentional. The hierarchy should be immediately legible without you having to think about it.

All transcripts are read-only. You can't accidentally edit them by clicking. The only editable surface is the tracked-changes diff during Refine mode, which I'll show shortly. This was a deliberate decision — your captured words are a record, not a scratch pad."

---

## 6. Action buttons — Icon-only with purpose

*[Hover over an entry to reveal the action buttons]*

"When you hover an entry, four actions appear: Refine, Tidy, Copy, and Move to. They're icon-only — no labels — because at this scale, labels add noise. Hovering any icon shows a tooltip with the name and a short description. The tooltip delay is 500ms — long enough that it doesn't flash on accidental mouseovers, short enough that it's useful when you actually pause.

**Tidy** is a silent, one-tap cleanup. It sends the transcript to GPT and applies the cleaned version directly — no review, no diff. It's for obvious cleanup: punctuation, capitalisation, removing filler words. You know what the AI is going to fix, so you don't need to review it.

**Refine** is for when you want control. It sends the transcript to GPT and renders the suggestions as a tracked diff — additions in one colour, deletions struck through. You can accept individual suggestions by clicking them, or edit the text directly. This matters because AI cleanup can occasionally overcorrect. The diff gives you visibility before anything changes.

**Copy** copies to clipboard. The icon swaps to a checkmark and holds for a moment — small feedback, but it closes the loop. You know the action fired.

**Move to** is the routing action. I'll demo that separately."

---

## 7. The left rail — Always-present navigation

*[Point at the left rail icons]*

"The left rail is always visible — Notes, Tasks, Ideas, Reminders. Four icons, no labels. Labels appear as tooltips on hover.

I made a specific styling decision here: the unselected state is just the icon, no background. The selected state gets a light grey background — the same token used for hover states throughout the app. No purple, no accent colour, no heavy outline. The selected state should be clear but not loud. If the selected state competed with the content, you'd always be drawn to the nav instead of the notes.

This rail stays visible even during selection mode. Earlier in the design, I had it disappearing when you entered selection mode — that was a mistake, it was disorienting. The rail is permanent wayfinding. It should always be there."

---

## 8. Move to — Routing thoughts into the right bucket

*[Click the Move to icon, select Tasks]*

"The Move to action is where the real value of the app lives. A voice note is raw material. The Move to flow is how you process it into something structured.

When you click Move to, you get a three-option popover: Tasks, Ideas, or Reminders. Choosing one sends the transcript to GPT, which extracts structured items from it. That extraction shows up in the review modal.

The modal header follows an iOS sheet pattern — title and source text on the left, Cancel and the confirm action on the right as text buttons. No X button, no footer bar. This hierarchy feels familiar and immediate — it's the same pattern you use in Calendar, in Reminders, in most native iOS sheets. Familiarity reduces cognitive load.

The background overlay stays within the app boundary. I spent time on this — if you use a fixed-position overlay portaled to the document body, it bleeds outside the app window. Instead the modal portals to the shell element using absolute positioning, so the overlay is always contained. The app never bleeds outside itself."

---

## 9. The Tasks panel — Linear-inspired status system

*[Navigate to Tasks panel, show the task list]*

"The Tasks panel is where I drew most heavily on Linear's design language.

Tasks are grouped into three status categories: In Progress, To Do — which I've labelled 'Not Started' — and Done. Only sections with tasks are shown. If you have no done tasks, that section doesn't appear. The grouping is automatic based on each task's status.

Each task has a status indicator — the circle on the left. An empty grey ring is Not Started. A half-filled accent ring is In Progress. A filled accent circle with a check is Done. These are all CSS — the in-progress state uses a conic gradient.

Clicking the status circle opens a small floating picker. I portal this to document body with a fixed position calculated from getBoundingClientRect, which means it escapes any overflow clipping — including the app's own container. And it's smart about direction: if there's not enough space below the button, it opens upward. You can see that working correctly near the bottom of the panel.

Next to the status icon is a small text label — Not Started, In Progress, Done. This makes the current state legible at a glance without requiring you to read the circle's visual state. The In Progress label appears in the accent colour; the others are muted."

---

## 10. Move to Tasks — Setting status before adding

*[Show the Move to Tasks modal with the status picker on each draft task]*

"When you move a note to Tasks, each extracted draft has a status selector. It defaults to Not Started. You can change it before adding — if you're moving a note that says 'start the investor update tonight', you might want to immediately mark that as In Progress.

This means by the time tasks land in your Tasks panel, they already have the right status. You're not doing a second pass to categorise what you just added."

---

## 11. The moved-to badge — Provenance and re-routing

*[Show a note that has been moved, click the badge]*

"After moving a note to a folder, the Move to button is replaced by a small badge showing which folder it went to — Tasks, Ideas, or Reminders. This is provenance — you know at a glance that this note has already been processed.

The badge is clickable. Clicking it opens a contextual dropdown with two options: remove it from the current folder, or move it to one of the other two. The re-route goes through the full review modal. So if you moved something to Tasks and then realised it was actually an idea, two taps and it's in Ideas."

---

## 12. Toast acknowledgements — Closing every loop

*[Perform a few actions — toggle a task, delete a note, add a task]*

"Every mutating action in the app fires a toast. Add a task — 'Task added'. Toggle status — 'In Progress' or 'Task done'. Delete notes — 'Deleted 2 notes'. Move a note — '3 added to Tasks'. Remove from a folder — 'Removed from Ideas'.

I'm showing these because the brief evaluated usability — and feedback is usability. Without acknowledgements, users are left wondering if the action worked. Every state change gets a confirmation. The toasts are brief — 1.8 seconds — and they appear at the bottom of the panel where they don't obscure content."

---

## 13. Bulk delete — Selection mode

*[Tap the trash icon, select a few entries, delete]*

"The trash icon enters selection mode. The left rail stays visible — only the action buttons per entry are hidden. Checkboxes appear in the left margin and the panel header swaps to show a Cancel button.

At the bottom, a sticky bar shows a count and a Delete button. The count updates live as you select. The Delete button is muted until at least one item is selected.

I chose this pattern — enter selection, select items, confirm at bottom — over per-row delete buttons because voice notes are things you want to keep. A per-row button that's always one misclick away from destroying a note felt wrong for this content type. This pattern requires intent."

---

## 14. Design system — The token approach

*[Show a few different UI elements]*

"Everything in the UI draws from a CSS variable token system. Background, surface, border, text, muted text, icon default, icon active, accent — all defined once and consumed everywhere. Dark mode is a second set of the same tokens swapped at the root level.

The accent colour is used exactly once in the functional palette — for selected states, AI suggestions, and status indicators. Nowhere else. This means the accent always signals something actionable or AI-generated. When you see that colour, it means the system is trying to tell you something.

Icons are all Lucide React at stroke weight 1.65, thinner than the default 2.0. This specific weight gives them an editorial, refined quality that holds up at small sizes. All icons share a constant stroke weight token so nothing ever looks heavier or lighter than anything else."

---

## 15. What I would build next

"A few things I'd want to add with more time:

The Ideas panel is currently a form — title plus body textarea. That's not right for how ideas actually emerge from voice. An idea is a raw insight, not a structured document. I'd redesign it as flowing text — a bold first line that becomes the title automatically, body text below it, and an optional tag for routing: Product, Strategy, Content. Something closer to how a founder or executive actually thinks rather than how a form designer thinks.

Search across the feed is the other obvious gap. Once you have more than a week of captures, finding anything requires scrolling. A simple text filter would be high value.

And I'd add a 'next action' field to tasks — a single line below the task text that says what the actual next physical thing to do is. Linear has this and it's the difference between a task that sits there and a task that gets done.

But the core loop — capture, transcribe, process, organise — is solid. Thanks for watching."

---

*Total estimated time: 6–8 minutes*
