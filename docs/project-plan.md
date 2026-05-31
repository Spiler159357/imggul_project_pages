# imggul Improvement Plan

## 1. Goal

The goal of imggul is to evolve from a simple image generation and browsing tool into a project-based character asset production tool.

The current improvement direction is:

- Keep the general image generation area focused on character exploration, pose exploration, art-style testing, and prompt experiments.
- Move actual asset production, saved asset management, planner execution, and project-specific prompt management into project-centered workflows.
- Treat the planner as one of the main production features, not merely as an auxiliary feature inside the situation page.
- Manage characters, outfits, situations, prompts, reference images, generation plans, temporary results, and confirmed assets at the project level.
- Improve import/export, preview, temporary storage, cache, and buffer workflows so the app remains usable under storage and mobile constraints.
- Clarify terminology and storage structure so future code changes can be made safely and directly.

## 2. Terminology And Structure Policy

### 2.1 Naming Policy

The terms used in the UI and data model need to be normalized.

- The field previously called `alias` or `별칭` should be renamed to `name` or `이름`.
- The value previously treated as the actual `name` should be treated as `path` or `경로` instead.
- User-facing labels should avoid the word `별칭` unless there is a strong reason to keep it.
- All rename-related features should separate the following actions:
  - Change display name / 이름 변경
  - Change storage path / 경로 변경
- A path change should be treated as a storage operation and should not be mixed with simple display-name editing.

### 2.2 Project Storage Direction

Project data should be structured so that one project can contain multiple characters, one character can contain multiple outfits, and each situation can contain more than one prompt variant.

A project should eventually manage:

- Project metadata
- Project name
- Project code or identifier
- Project storage path
- Characters
- Character outfits
- Character-specific prompt plans
- Situations
- Situation prompt variants
- Situation composition variants
- Project-level style prompts
- Project-level common prompts
- Reference images
- Planner execution data
- Temporary generated assets
- Confirmed assets
- Logs, personal notes, and temporary memo-like data

### 2.3 Prompt And Import Policy

Prompt data should be saved in a form that can be imported later without requiring manual reconstruction.

- When scheduled generation starts, the prompt, negative prompt, reference images, model settings, character data, situation data, and related planner settings should be saved together at that exact point in time.
- Planner-generated prompt data should be stored in a separated form, not only as one merged prompt string.
- Images uploaded through the planner should preserve the same separated prompt structure when imported later.
- Import should be handled through one clearly defined import entry point.
- Duplicate import buttons should be removed.
- The remaining import button should open a modal where the user selects the import type and target.

## 3. Major Workstreams

### 3.1 UI/UX Improvements

- Show a clear invalid-access notice when a guest user accesses `imggul.com` directly.
- Add an estimated duration display when creating a scheduled generation job.
- Keep scheduled generation usable in the background.
- Improve mobile UI so storage-heavy image checking is minimized.
- Remove duplicate import buttons and consolidate import into one modal-based flow.
- Prevent planner progress updates from forcing the planner screen to scroll back to the top.
- Preserve the previous scroll state when returning from a situation detail page to the situation list.
- Reconsider the planner layout as a major independent workspace rather than a small part of the situation page.
- Keep access to logs, personal notes, and temporary storage in a bottom, side, or otherwise separated utility area.
- Continue incorporating small UI changes whenever actual usage reveals friction.

### 3.2 Image Generation Flow Improvements

- Allow reference images to be selected from images already stored in the project or storage bucket.
- Keep support for direct local image upload.
- Restore the `vibe transfer` workflow.
- Support `webp` images in inpaint workflows.
- Persist prompt-related data, reference data, and model settings at the moment scheduled generation starts.
- Fix the planner upload/import flow so planner prompts are saved in a separated form before generation and can be imported without being merged incorrectly.
- Treat the v4 model quality mismatch as a very low priority bug investigation:
  - The observed issue is that v4 output quality appears lower than NovelAI official site output.
  - This should be investigated later after higher-priority planner and storage issues are resolved.
- Change the default generation unit to 20 images.
- Remove all duplicate import buttons except the single modal-based import entry point.

### 3.3 Project And Planner Design

- Convert the existing explorer screen into a project-list-centered screen.
- After selecting a project, navigate to a project management screen.
- Consider separating the planner into its own major workspace.
- If the existing three-pane layout is retained, reduce the space used by character and situation panes and give more dedicated space to planner management.
- Design the project screen around characters, outfits, situations, prompt sets, plans, temporary results, and confirmed assets.
- Allow one character to have multiple outfits.
- Allow each character to save and load its own planner-related plan data.
- Allow each situation to have multiple prompt variants.
- Allow each situation to have composition variants such as `straight-on`, `from below`, `from side`, and other controlled randomization options.
- Avoid uncontrolled randomization; random composition should be tied to situation or prompt-variant definitions.
- Support batch generation for all selected or all configured situations.
- Allow each plan to be managed independently through a modal or similar detail view.
- Each plan should support independent state controls:
  - Start
  - Pause
  - Resume
  - Cancel
  - Complete / confirm
- Strengthen the queue model so independent plan execution states are reliable.
- Add or improve planner cache so data is not lost during navigation, refresh, or partial execution.
- Reduce the NAI error cooldown if the current 2-minute delay is unnecessarily long.
- Fix cases where automatic deletion after planner selection does not work reliably.
- Add a v4 prompt character-count limit where required.
- Support importing into the v4 prompt area from planner-related data.
- Fix the issue where background generation works but browser-side generation does not.
- Fix planner status not updating in real time after browser generation completes.
- Avoid solving planner status refresh by repeatedly reloading the whole page, because that can break scroll state and UI state.
- Ensure completed browser generation results are reflected in the planner immediately.
- Review whether undo should be supported for planner-generated changes and how it should interact with queued generation.
- Consider future support for sharing situation information between projects.

### 3.4 Temporary Storage, Preview, And Buffer System

- Store plan-generated images as `webp` by default.
- Store plan-generated results in a separate temporary storage area before user confirmation.
- Let users confirm only selected assets.
- Let users bulk-delete unselected temporary assets.
- Support quick navigation through temporary-storage images.
- Strengthen the buffer system because storage bucket usage has limits.
- Avoid loading every image preview at once.
- Improve preview behavior so selecting a character and situation shows only relevant images.
- Reconsider whether external image-site previews should be supported directly, or whether a safer filtered preview system is better.
- Reduce image-checking work on mobile.

### 3.5 Additional Features

- Add image download path selection.
- Add simple image processing tools such as mosaic processing.
- Add or improve a guest page.
- Strengthen security around authentication, access control, uploads, storage access, and guest behavior.
- Migrate data that needs stronger access control or queryability into a database where appropriate.

### 3.6 Codebase Understanding

A separate but important goal is to understand the code structure deeply enough to modify it directly.

Priority areas to map:

- Cloudflare Pages Functions structure
- Frontend file organization
- Routing and page/component structure
- Image storage and API call flow
- Image generation request flow
- Scheduled generation and queue flow
- Browser generation flow
- Planner state management
- Import/export flow
- Temporary-storage state management
- Modal state management
- Security and permission checks
- Database migration candidates

## 4. Phased Progress Plan

### Phase 1: Immediate Stabilization And Terminology Cleanup

- Show invalid-access guidance for direct guest access to `imggul.com`.
- Consolidate duplicate import buttons into one modal-based import button.
- Normalize `별칭` into `이름` and reinterpret the old name field as `경로`.
- Separate name-change and path-change features.
- Add estimated duration display for scheduled generation.
- Prevent planner progress updates from forcing scroll position to the top.
- Preserve situation-list scroll state after visiting situation details.

### Phase 2: Import, Prompt Persistence, And Image Generation Fixes

- Save prompt, negative prompt, reference images, model settings, and planner context at scheduled generation start.
- Store planner prompts in separated form before generation.
- Ensure uploaded planner images can be imported without losing prompt separation.
- Restore storage-based reference image selection.
- Restore `vibe transfer`.
- Add `webp` inpaint support.
- Set the default generation unit to 20 images.
- Add v4 prompt character-count validation.
- Support import into the v4 prompt area.

### Phase 3: Project Structure Redesign

- Convert the existing explorer into a project list.
- Design and implement the project management screen.
- Keep logs, personal notes, and temporary storage accessible from a separated utility area.
- Add project-level management for characters, outfits, situations, prompt sets, and style prompts.
- Allow one character to have multiple outfits.
- Allow situations to hold multiple prompt and composition variants.
- Define project-level storage paths and database-backed metadata boundaries.

### Phase 4: Planner As A Main Workspace

- Decide whether the planner becomes an independent page/workspace or a dominant area inside the project screen.
- Move plan management into per-plan modal or detail screens.
- Add independent plan states: start, pause, resume, cancel, complete.
- Strengthen the queue model for batch and background generation.
- Add batch generation for all configured or selected situations.
- Save and load character-specific plans.
- Improve planner cache.
- Fix browser generation, planner refresh, completion reflection, and undo-related issues.
- Fix automatic deletion issues after plan selection.
- Reduce NAI error cooldown if safe.

### Phase 5: Temporary Storage, Preview, And Buffer Optimization

- Store generated plan results in temporary storage as `webp`.
- Add confirm-selected and bulk-delete-unselected workflows.
- Improve temporary-storage navigation.
- Strengthen the buffer system around bucket usage limits.
- Improve filtered previews based on character and situation.
- Reduce mobile storage-checking costs.

### Phase 6: Security, Database Migration, And Code Documentation

- Strengthen authentication, authorization, upload, and storage-access checks.
- Add or improve guest-page behavior.
- Migrate necessary data into a database.
- Document the code structure enough to support direct development.
- Investigate the low-priority v4 quality mismatch after core planner features stabilize.
- Consider future cross-project situation sharing.

## 5. Priorities

### P0: Immediate / Blocking

- Remove duplicate import buttons and consolidate import through one modal.
- Normalize name/path terminology and split name-change from path-change.
- Preserve separated prompt data for planner generation and import.
- Prevent planner UI scroll resets during progress updates.
- Fix browser-generation and planner-refresh mismatch.
- Add character-specific plan save/load.

### P1: High

- Project data model redesign.
- Planner workspace redesign.
- Per-plan state controls and queue model.
- One character with multiple outfits.
- Multiple prompt variants per situation.
- Batch generation for situations.
- Temporary storage confirmation and cleanup.
- Storage-based reference image selection and `vibe transfer` restoration.

### P2: Medium

- Estimated scheduled-generation duration.
- `webp` inpaint support.
- Default generation unit change to 20 images.
- v4 prompt character-count validation.
- Planner cache strengthening.
- Situation scroll restoration.
- Download path selection.
- Mosaic image processing.
- Preview and buffer improvements.
- Mobile UI improvements.

### P3: Low / Later

- v4 quality mismatch investigation against NovelAI official output.
- Cross-project situation sharing.
- External image-site preview strategy.
- Additional convenience image-processing features.
- Full codebase documentation after the core design stabilizes.

## 6. Open Questions

- Should the planner become a fully independent page, or should it remain inside the project screen as a dominant workspace?
- What is the exact data schema for project, character, outfit, situation, prompt variant, and plan?
- Which metadata must move into a database immediately, and which data can remain file or storage based?
- How should plan undo behave after generation has already started?
- What is the safest refresh model for real-time planner updates without breaking scroll or modal state?
- How should composition randomization be exposed without making generation results too inconsistent?
- Should external image-site preview remain supported, or should previews be limited to filtered project-owned data?
