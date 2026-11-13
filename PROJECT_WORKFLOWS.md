# Yogurt project workflows

Fork base: Yogurt v0.3.11. noMinute is retained as a reference, not required as a running service.

The user's durable meeting record belongs in the selected Obsidian project folder. Audio has a separate policy: reference an existing external file, archive it outside the vault, or delete it after durable transcript/notes export. Store the original URI, content checksum and retention outcome in frontmatter. Never delete source audio on cancellation, transcription errors, failed summary generation or incomplete export. Voice enrollment requires user-confirmed names.

Provider choices: Yogurt's local model, signed-in Codex CLI, signed-in Claude Code CLI, OpenAI API, Anthropic API, or an OpenAI-compatible local/remote endpoint. Never silently switch providers. API secrets belong in OS-backed encrypted storage; Markdown and project settings contain no keys. CLI sign-in is performed by the user through each vendor's existing CLI. Provider eligibility and usage limits depend on the user's account.

Start with an import workflow: select a project, import existing audio/video, transcribe locally, review speakers, summarize with project context, write transcript/notes/review Markdown into Obsidian, then apply audio retention. Existing live Yogurt meetings should use the same export boundary. Context comes from selected project Markdown folders; generated meetings are excluded. Keep original transcript facts separate from glossary/background context.

Speaker profiles use native Mac/Core ML embedding extraction as an optional model pack, keeping Python/PyTorch out of the desktop bundle. Diarization (who spoke when) and identity matching (which known person) are distinct. Unknown/ambiguous voices remain unnamed; confirmation seeds profiles. Embeddings from different model versions must never be mixed. Cross-platform speaker inference is a separate adapter.

A custom build must use separate app data and an intentional update channel; stock upstream auto-updates must not replace the fork. Retain the upstream MIT license/attribution. Develop/test with an isolated Yogurt profile. No private Obsidian content, cloud inference or real recording is part of development smoke tests without the user's selection.

Follow-ups are selected from meeting context, rather than a fixed user-chosen template. The selection returns a reason and a draft (agenda, project update, research, implementation, reference notes, another appropriate draft, or none). It does not automatically execute proposed work or alter curated project knowledge.


## Using this build

This is an initial local fork called **Yogurt Projects**, based on upstream v0.3.11. It uses `so.yogurt.projects`, a separate `Yogurt Projects` app-data directory and disabled upstream updates. Existing official Yogurt meetings/settings are not migrated automatically. noMinute is unchanged.

Open **Project workflows** in the sidebar or **Project workflows & providers** during onboarding. Choose an existing Obsidian vault and project folder. Choose relative context folders, an output subfolder and a summary provider, then save. **Use this provider for Yogurt summaries** also changes the regular meeting-summary/Ask provider; project import/export uses its own saved configuration. Jobs retain a settings snapshot so editing a project does not silently change already queued work.

- Local: the normal Yogurt notes model. Speech recognition remains local for every provider. For an external provider, select the project as the default before continuing first-run setup to skip local summary/embedding model downloads. Switching to local starts that model setup. A download already in progress is not cancelled by changing providers.
- Codex: install the current Codex CLI, run `codex login` in Terminal, then select Codex. Optional model; blank uses the CLI default. Runs non-interactively in a private temporary directory with a read-only sandbox, ephemeral sessions and user configuration disabled. See [Codex non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode).
- Claude Code: install/sign into the Claude Code CLI, then select it. Optional model; blank uses its default. Runs `claude --print` with tools and MCP connections disabled, without a persisted session. See [Claude headless mode](https://code.claude.com/docs/en/headless).
- OpenAI / Anthropic API: enter your model ID and save a key. Keys are encrypted with Electron OS-backed safeStorage, separate from project settings and Markdown. OpenAI uses the Responses API with storage disabled; Anthropic uses Messages. Subscription access and API billing are separate.
- Compatible endpoint: for LM Studio, Ollama's OpenAI-compatible endpoint, or another provider, enter its base `/v1` URL and exact model ID. A key is optional for a local endpoint. Remote endpoints require HTTPS. There is no automatic provider fallback.

Import audio/video, wait for local transcription, review names, optionally listen to a voice sample and **Confirm and remember this voice**, then **Approve speakers and summarize**. AVFoundation decodes common Mac formats; installing FFmpeg adds codecs/containers such as unsupported WebM/MKV. No FFmpeg or Python/PyTorch runtime is bundled by this addition. Voice inference uses the optional FluidAudio/Core ML model pack, downloaded only when recognition is enabled. Names are proposals until reviewed; similarity thresholds have not been calibrated on your recordings. Forget a saved profile from the project screen.

Each output folder contains `transcript.md`, `notes.md`, `review.md`, `follow-up.md`, and the retrieved background excerpts in `context.json`. Notes cite exact transcript quotes. Quote checks do not prove that an interpretation is correct. Follow-ups are contextual proposals with a reason and source IDs, and can select **none**. They never execute work automatically. Original files remain untouched on inference/export failure or cancellation. For imported media, deletion or verified external archiving happens only after all Markdown outputs have been published. The original URI and checksum remain in frontmatter. Uncompressed temporary audio is removed after transcription/speaker analysis; short review samples are removed after completion.

Finished meetings from this fork can also be exported using their existing transcript, without another speech pass. In this first version, their original audio stays managed by Yogurt and both recording-track links appear in the Obsidian transcript. The import-only archive/delete policy does not change Yogurt-managed recordings. Reusable voice enrollment currently operates on imported recordings, not existing live meetings. These are explicit next integration points.

## Calendar accounts

The Mac integration reads EventKit calendars available to macOS; it has no direct Google or Notion Calendar API connection. For Google events, including those shown in the **Notion Calendar app**, add the same Google account under **System Settings → Internet Accounts**, enable Calendars, confirm its events appear in Apple Calendar, and grant Yogurt Projects calendar access/select the calendars in settings. Notion database date items do not sync to Google/iCloud this way. See [Google's setup instructions](https://support.google.com/calendar/answer/99358?co=GENIE.Platform%3DDesktop&hl=en) and [Notion's calendar guide](https://www.notion.com/help/use-notion-calendar-with-notion).

## Build and validation

Use the repository-pinned pnpm 10.7.0 and Node compatible with Electron tooling. `pnpm install --frozen-lockfile`, `pnpm -C app typecheck`, `pnpm -C app test`, and `pnpm -C app build`. Native project audio requires macOS, Swift 6.2 and the pinned FluidAudio Swift package. `pnpm -C app exec playwright test projects.spec.ts --workers=1` exercises the project setup/export UI in an isolated fake profile. A local unpacked application can be made with `pnpm -C app package-local`; it applies an ad-hoc local signature required on Apple Silicon. It is not a Developer ID-signed or notarized public release.

Validated: TypeScript, the full unit suite (1,859 passed, four skipped), a real isolated Electron project setup/export test, compilation of native recording/speaker helpers, and synthetic video-to-16 kHz mono WAV conversion. Provider requests are mocked in tests. No real API keys/subscription inference, speech-model inference or real-person speaker accuracy was exercised; no private vault notes were used. Optional speaker support is initially macOS-only. The local application bundle contains no speech, summary or speaker weights; those are downloaded separately when selected.

FluidAudio is Apache-2.0; its bundled license is in `app/resources/licenses/FluidAudio-Apache-2.0.txt`. The upstream Yogurt MIT license and attribution are retained.

Packaged checks include source-folder exclusion, notes-engine IPC startup, and actual application initialization with a disposable fake profile. The unpacked Apple Silicon app is approximately 402 MiB before separately downloaded models.


## Models and folder settings (Projects .2)

**Settings → Models, folders & tools** is also available at the top of **Project workflows**, including during onboarding.

First startup now pauses before any model download. It checks the configured model folder, the official Yogurt model cache, ownscribe's inference folder, Hugging Face/Whisper caches, LM Studio, Ollama model blobs and llama.cpp's cache. The scan reads directory metadata and bounded file prefixes, never full tensor data. Choose discovered files, choose individual files, or **Look in another folder**. Continuing explicitly allows downloads for any models still missing. CLI/API defaults skip local summary weights. Catalog-matching, verified search weights in the official Yogurt cache are reused in place too. Models are not copied or moved.

Discovery finds Whisper GGML `.bin` speech files and GGUF language-model weights. Known embedding/projector files are excluded from summary choices. Other weight formats require an engine that supports them; matching a header does not guarantee the selected model fits memory or loads successfully. Keep reused files at their selected locations. The first-run choice is saved per app profile; **Check for existing models** can scan again later.

App-wide paths include an existing Whisper model, an existing summary GGUF, the future model-download folder, processing cache folder, optional speaker-pack folder, and absolute paths to Codex/Claude/FFmpeg executables. File format and access checks run before saving. Blank restores automatic selection. Changes to storage/tool paths require restarting; saving never relocates existing files or changes a running job. Initial model-file choices apply immediately before setup begins. The panel shows effective locations, model sizes and available processing-disk space. Custom summary weights disable the starter/recommended-summary downloads; the separate search model may still be needed for local summaries.

Per-project settings now include the input folder, folder checking, output-folder picker/preview, imported speech language (including Thai or automatic detection), and optional contextual follow-ups. Folder checks run while the app is open, about every 10 seconds, and only inspect top-level media files. A file must be unchanged across two checks and at least five seconds old. The UI asks for **Import recording** or **Skip this file**; scanning alone never transcribes, sends content to a provider or deletes audio. Changed/replaced files need another review; skipped versions stay skipped across restarts. Each monitored folder belongs to one project, and a monitored inbox must differ from its audio archive. Folders with more than 500 recordings show an error rather than silently skipping files. Subfolders are not scanned.

Other conveniences: multiple-file imports start in the project's input folder, project selection is remembered, saved API keys can be removed, and failed/cancelled jobs can be retried from their checkpoint. Saved transcripts are reviewed before another summary; completed audio retention is not repeated. Disabling follow-ups still writes an explanatory `follow-up.md` and avoids the extra generation request.

Validation for .2: 1,859 unit tests passed (four skipped), typecheck/build passed, and four isolated Electron UI tests passed, covering restart persistence, folder approval and first-startup reuse without replacement downloads. Tests use synthetic model headers and fake inference; real-model inference accuracy is not claimed.
