# Meeting Threads

A prototype for the follow-through between meetings. Someone usually owns that work: taking notes, turning them into action items, tracking those items, and working each one into the right agenda later in the week. Most of it happens by hand. Transcripts and summaries help with the notes; they don't say where each item should land next.

Meeting Threads puts two weeks of meetings on one canvas and draws the topics that run between them. It runs entirely on synthetic data: a design ops lead and 17 colleagues at a fictional company, 46 meetings, 37 transcripts.

## What it does

- **Two weeks around today.** The dates follow the real calendar: two working days already happened, the rest is coming up. It opens on today, with the day before just in view. Only meetings that have ended have transcripts, and suggestions only land on upcoming agendas. A line marks now.
- **Five views of the same two weeks.** Calendar (the default: every meeting by time, overlaps stacked), then project, people, meeting type and theme. Switching animates every meeting to its new place.
- **Themes as threads.** A theme is a concern that runs through several projects, such as Activation or Component consistency. Each theme is drawn as a line between the meetings that discussed it.
- **Action items that say only what is known.** A dot marks the meeting where an item was raised. Once it's added to a later agenda, an arrowed line runs to that meeting. Until then, a short stub ends in a "?".
- **A queue you can work through.** Suggestions are grouped by the meeting they'd go to. Each shows the exact line it would add and who would see it, and its button names the meeting ("Add to Research ops sync"). Theme follow-ups quote whoever raised the theme. Keys: J and K move, A adds, D dismisses, U undoes. An added item stays in place showing what changed, with Undo.
- **Suggested agenda items, with reasons.** A suggestion only targets a later meeting for a strong reason: the topic is already on that meeting's table, the same group meets again, or it's a 1:1 with the person who owns it. Each one shows the quote that prompted it and states the reason. Anything without a strong reason is marked as needing its own meeting.
- **Move upcoming meetings.** Drag a meeting to a new time, or drag an edge to change its start or end, in 15-minute steps. Alt+arrows do the same from the keyboard. A toast offers Undo, and ⌘Z (Ctrl+Z) undoes the latest move or queue decision.
- **Pages for every meeting, theme, project and person.** Transcript, agenda, the threads through a meeting and where they go next; who carried a theme and what it produced; what you and a colleague said and what's still open.
- **Import a real transcript.** Paste an Otter export, "Name: text" lines or an Atlas meeting bundle for one meeting, preview the speakers, themes and action items found, then add it. Plain rules run in the browser, learned from the meetings already there; they catch promises like "I'll…" and "Let me…". When run locally with a key, Jev can check each possible promise (see below). Every line says whether Jev or the rules decided it.
- **A short tour** on first visit, replayable from the header.
- **Rename and reorder rows in place.** In the project, meeting type and theme views, drag a row label's grip or use Alt+↑/↓ to reorder, and click its pencil (or double-click the name) to rename. In the people view rows can be reordered but not renamed.
- **Demo settings.** Restore the original names and order, or reset everything to a first visit.
- **Privacy controls.** Hide a meeting's transcript or leave a person out of suggestions. Notes and decisions stay in your browser. Nothing is sent anywhere unless you turn Jev on during an import on the local dev server.

## Reading the canvas

The key at the bottom left names every kind of line. Hover or tab to any line for a card that says why it exists, with the evidence.

| Line | Means |
|---|---|
| Solid line in a theme's color | Both meetings discussed that theme |
| Arched line with an arrowhead | Something said in one meeting is suggested for (dashed) or on (solid) a later agenda |
| Dotted line with end circles | One meeting, shown in each project or theme row it belongs to |
| Dot with an arrowed line | An action item, raised at the dot's meeting and on the agenda the arrow reaches |
| Dot with a fading stub and "?" | An action item no meeting has committed to yet |

## Run it

Requires Node 20 or later.

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # the logic checks, no browser needed
npm run gen      # regenerate the synthetic data from data/seed.json
```

## How it's built

React, Motion (Framer Motion), Vite and Vitest, plus one bundled typeface (Instrument Sans). No backend; the only server-side piece is an optional proxy in the local dev server that holds the Jev key.

- **Layouts are calculations; motion is one number.** Each view is a plain function from the data to box positions. A single progress value drives every block, label and thread each frame, so threads stay attached mid-flight and an interrupted switch starts from where things are.
- **Suggestions are derived, never stored.** Only your decisions are saved. One function picks where a topic can land and reports why, and the explanation you read comes from that same function.
- **Privacy runs first.** Every view reads the data after hidden transcripts and excluded people are applied.

| Folder | What's there |
|---|---|
| `data/` | `seed.json` (hand-written people, themes, projects, schedule and story meetings) and the generated calendar, transcripts and annotations |
| `scripts/` | The data generator, with self-checks, and a script that packages the build as a single page |
| `src/data/` | Loading and validation, privacy, transcript import |
| `src/layout/` | Lanes, layouts, tweening, label placement |
| `src/threads/` | Threads, action items, suggestions and their reasons, page summaries |
| `src/ui/` | Canvas, thread layer, cards, action queue, pages, privacy panel |
| `src/jev/` | Jev: candidate promises, redaction, the decision rules, the dev-server proxy and its browser client |
| `eval/jev/` | Labelled sets and the rules-versus-Jev comparison (`npm run eval:jev`) |
| `tests/` | One Vitest file per logic module (191 tests), including an accuracy check that runs the transcript extractor on every bundled meeting against the hand-made annotations |

I designed it and built it by directing Claude. I wrote the spec, made the design calls (what counts as a strong reason to put a topic on someone's agenda, how themes differ from projects, what each line should mean) and reviewed each step in the browser. Claude wrote the code. Comments in the code cite the design specs (005 to 007), which are kept separately.

## Jev (optional)

[Jev](https://typesafe.ai) (TypeSafe's System One model) answers yes-or-no questions about text with a calibrated rating. Here it checks the promises the rules find. The rules first list every turn that might be a promise ("I'll…", "let me…", "I'm sending…"). Jev then rates each one: 0.7 or above is added, 0.3 or below is set aside, and anything between is listed under "Needs a look" for you to tick. It also names who owns the task, and is trusted only when it gives the same answer with the attendees listed in two different orders.

- **Off by default.** Turning it on sends the possible promises, with the two turns before each, to TypeSafe, a third party. Social Security digits, dates of birth, and card and account numbers are replaced first, including when another speaker repeats them. The browser checks every request before sending and the proxy checks again; either one stops the send.
- **Local only.** Calls go through a proxy in the dev server that holds the key. The published page has no proxy, no key and no Jev option; it uses the rules, or answers already in an Atlas bundle.
- **Atlas bundles.** A bundle whose turns already carry Jev answers to the same question set (`mt-turn-1`) and model is used as is, without asking again.

To use it, set `TYPESAFE_API_KEY` in your shell environment (for example in `~/.zshenv`, never in a file in this folder) and start the dev server from that shell with `npm run dev`. `JEV_ENABLED=0 npm run dev` turns it off. `npm run eval:jev` compares rules with rules plus Jev on the labelled sets in `eval/jev/sets` (it calls Jev). On a real recorded call, Jev found all five commitments with none wrong, where the rules scored F1 0.67. On the scripted sets Jev is just as precise but more cautious, so more lines land in "Needs a look".

## Data shape

The three input files are shaped so real exports can replace the synthetic ones:

1. **Calendar:** `data/calendar.json` follows the Google Calendar `events.list` shape.
2. **Transcripts:** `data/transcripts/<event id>.json` is a minimal diarized shape: speakers, then segments with a speaker, an offset and text. Real transcript exports need a small adapter into it.
3. **Annotations:** `data/annotations.json` holds what neither source has: meeting types, themes, projects, action items and the speaker mapping. On real data an extraction step would produce it.

## Not built yet

- A zoomable time range (fixed at two weeks for now).
- Writing added agenda items back to a real calendar.
- Theme tagging with Jev. Jev only checks promises for now.
