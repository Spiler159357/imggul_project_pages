# imggul Requirements Summary

## 1. Overview

This document summarizes the current functional and non-functional requirements for improving imggul.

The project direction is to reorganize imggul around project-based asset production. General image generation remains useful for exploration, but actual character asset generation, situation asset generation, prompt management, import, temporary storage, and batch execution should be handled through project and planner workflows.

The most important current changes are:

- Normalize naming terminology.
- Treat the planner as a central production feature.
- Save planner and scheduled-generation prompt data in an import-friendly structure.
- Improve project storage so characters can have multiple outfits and situations can have multiple prompt variants.
- Fix import duplication and clarify import behavior.
- Improve temporary storage, preview, buffer, and mobile usability.

## 2. Terminology Requirements

### 2.1 Name And Path

- The UI term `별칭` should be changed to `이름`.
- The existing value previously treated as `이름` should be redefined as `경로`.
- Internally, the preferred terms should be:
  - `name`: user-facing display name
  - `path`: storage path or route-like identifier
- Rename features must be split into two independent features:
  - Name change
  - Path change
- Name change must not move or rename storage data.
- Path change must be treated as a storage-affecting operation and should include stronger validation.

### 2.2 Import

- Only one import button should remain in each relevant workflow.
- Duplicate import buttons should be removed.
- The remaining import button should open an import modal.
- The import modal should let the user choose the import source, import type, and import target.
- Planner-created data should be importable without losing its separated prompt structure.

## 3. Functional Requirements

### 3.1 Access And Guest UX

- Guest users who access `imggul.com` directly should see a clear invalid-access notice.
- A guest page or guest guidance screen should be added or improved.
- Guest, regular user, and admin permissions should be clearly separated.

### 3.2 General UI/UX

- Scheduled generation should show an estimated duration before or during reservation creation.
- Planner progress updates must not force the planner screen to scroll to the top.
- Returning from a situation detail page to the situation list should preserve the previous scroll position.
- Mobile UI should reduce storage-heavy image browsing and checking.
- Logs, personal notes, and temporary storage should remain accessible from a bottom, side, or otherwise separated utility area.
- UI changes found during normal use should continue to be recorded and applied iteratively.

### 3.3 Image Generation

- Reference images should be selectable from direct local uploads.
- Reference images should also be selectable from images already stored in project or storage areas.
- The `vibe transfer` feature should be restored.
- `webp` images should be supported in inpaint workflows.
- The default generation unit should be changed to 20 images.
- v4 prompt input should enforce a character-count limit where required.
- The v4 prompt area should support import from planner or saved prompt data.
- The observed v4 quality mismatch against NovelAI official site output should be tracked as a very low priority bug investigation.

### 3.4 Scheduled Generation And Persistence

- When scheduled generation starts, the app should persist the exact prompt data from that moment.
- Persisted scheduled-generation data should include:
  - Positive prompt
  - Negative prompt
  - Character prompt sections
  - Situation prompt sections
  - Project common prompts
  - Style prompts
  - Reference images
  - Model settings
  - Generation count
  - Planner context
  - Import metadata
- Persisted data should be easy to import later.
- Scheduled generation should continue in the background where possible.
- Scheduled generation results should be connected to temporary storage or planner results when needed.

### 3.5 Planner Prompt Handling

- Planner prompts must be saved in separated sections before generation starts.
- Planner upload/import must preserve separated prompt data instead of relying only on a merged prompt string.
- The planner should support importing data into the v4 prompt area.
- Character-specific plans should be savable and loadable independently.
- The planner should cache work-in-progress data strongly enough to survive navigation and partial UI refreshes.

### 3.6 Planner Execution

- The planner should support batch generation.
- Batch generation should allow all situations or selected situations to be generated automatically.
- Each plan should have independent state controls:
  - Start
  - Pause
  - Resume
  - Cancel
  - Complete / confirm
- The queue system should be redesigned or strengthened to support independent plan states.
- Execution should support background generation and browser-side generation consistently.
- The issue where background generation works but browser generation fails should be fixed.
- Planner status should update when browser generation completes.
- Planner results should be reflected immediately after generation completes.
- Repeated full-page refresh should not be used as the primary update solution because it can break scroll, modal, and planner state.
- Undo behavior for planner changes should be reviewed and designed.
- Automatic deletion after planner selection should be fixed when it does not work reliably.
- The NAI error cooldown should be shortened if the current 2-minute delay is unnecessarily long and safe to reduce.

### 3.7 Planner UI

- The planner should be considered as a separate major workspace or a dominant part of the project screen.
- The existing three-pane layout should be reconsidered.
- Character and situation areas can be reduced if planner space needs to be expanded.
- Each plan should be manageable through a plan-specific modal or detail screen.
- The plan modal should include existing input information and toggles for new options.
- Plan state and queue status should be visible and controllable from the UI.

### 3.8 Project Management

- The existing explorer screen should become a project-list-centered screen.
- Selecting a project should open the project management screen.
- Project management should include child areas for:
  - Characters
  - Outfits
  - Situations
  - Prompt sets
  - Planner plans
  - Temporary results
  - Confirmed assets
- A project should store project-level common prompts and style prompts.
- Project data should be designed for future import/export.
- Project-to-project situation sharing may be added later.

### 3.9 Characters And Outfits

- One character should be able to have multiple outfits.
- Character-specific prompts should be savable and reusable.
- Character-specific planner plans should be savable and loadable.
- Images should be reviewable by character.
- External image upload should be supported and linked to the selected project, character, or outfit where appropriate.

### 3.10 Situations

- Situations should belong to projects.
- A situation should be able to hold multiple prompt variants.
- A situation should be able to hold multiple composition variants.
- Composition variants may include options such as `straight-on`, `from below`, `from side`, and similar camera/viewpoint tags.
- Randomized composition should be controlled by situation or prompt-variant settings rather than being applied blindly.
- Situation-specific generation requirements should be usable in planner execution.

### 3.11 Prompt Sets

- System prompt design should be formalized.
- The app should support project-level common prompts.
- The app should support project-level style prompts.
- The app should support situation-specific prompts.
- The app should support character-specific additional tags and excluded tags.
- Prompt helper functionality for weighting syntax may be added, but it is lower priority than planner and import correctness.

### 3.12 Temporary Storage

- Images generated through plans should be stored as `webp` by default.
- Generation results should be stored in a separate temporary storage area before confirmation.
- Users should be able to confirm selected assets only.
- Users should be able to bulk-delete unselected temporary assets.
- Users should be able to navigate temporary-storage images quickly.
- Temporary-storage cleanup rules should be clear and safe.

### 3.13 Preview And Buffer System

- The buffer system should be strengthened because storage bucket usage is limited.
- The app should avoid showing all images at once.
- If a character and situation are selected, previews should show only matching images.
- Mobile views should minimize storage-heavy image checking.
- The image-site preview strategy should be reconsidered because excessive preview loading can burden the storage/buffer system.

### 3.14 Upload Flow

- The existing “select target, then upload” flow should be changed to “start upload, then select target” if this remains useful after project restructuring.
- Upload targets should be connected to project, character, outfit, situation, or temporary storage data.
- External image uploads should continue to be supported from the project management screen.
- Planner-uploaded images should preserve prompt and import metadata where applicable.

### 3.15 Image Download And Processing

- Image downloads should support choosing or specifying a save path.
- Simple image processing tools should be added where useful.
- Mosaic processing should be supported as an initial simple image-processing feature.

### 3.16 Security And Data Migration

- Security should be strengthened around authentication, access control, uploads, storage access, and guest behavior.
- Guest access should not expose project or storage data incorrectly.
- Data that needs stronger consistency, permission checks, or queryability should be migrated to a database.
- Storage paths and path changes should be validated carefully.

## 4. Non-Functional Requirements

- Project-level data structures should be importable and exportable later.
- Prompt data should remain reconstructable after generation.
- Planner state should survive navigation and partial refreshes where possible.
- UI refresh behavior should not destroy scroll state, modal state, or selected plan state.
- Storage usage should be controllable.
- Mobile usage should avoid unnecessary image loading.
- Temporary-storage data should be cleanable by confirmation state.
- Security-sensitive data should not rely only on client-side conventions.
- Code structure should be documented enough for direct development.

## 5. Responsibility Areas

### 5.1 General Image Generation Area

- Character and pose exploration
- Art-style exploration
- Single-image generation
- Prompt experimentation
- Reference-image-based tests
- Vibe transfer tests
- Inpaint tests

### 5.2 Project Area

- Actual asset generation
- Character management
- Outfit management
- Situation management
- Prompt-set management
- Project style prompt management
- Stored plan execution
- Temporary result confirmation and cleanup
- External upload connection to project data

### 5.3 Planner Area

- Character-specific plan save/load
- Situation-based generation planning
- Prompt variant selection
- Composition variant selection
- Batch generation
- Queue management
- Start, pause, resume, cancel, and complete states
- Planner cache
- Import-friendly prompt persistence
- Browser/background generation status synchronization

### 5.4 Utility Area

- Logs
- Personal notes
- Temporary storage access
- Buffer/storage usage awareness
- Download tools
- Simple image processing tools

## 6. Priority Requirements

### P0: Must Fix First

- Remove duplicate import buttons and consolidate import through a modal.
- Normalize `별칭` to `이름` and old `이름` to `경로`.
- Split name-change and path-change features.
- Save planner prompts in separated form before generation.
- Preserve planner prompt structure during upload/import.
- Fix planner scroll-to-top behavior during progress updates.
- Fix browser-generation status not reflecting in planner.
- Add character-specific plan save/load.

### P1: High Priority

- Redesign project data structure.
- Redesign planner as a main workspace.
- Add per-plan modal/detail management.
- Add plan pause/resume/cancel/complete states.
- Strengthen queue system.
- Support one character with multiple outfits.
- Support multiple prompt variants per situation.
- Support batch generation for situations.
- Restore storage-based reference image selection.
- Restore `vibe transfer`.
- Improve temporary storage confirmation and cleanup.

### P2: Medium Priority

- Add estimated generation duration.
- Add `webp` inpaint support.
- Set default generation unit to 20 images.
- Add v4 prompt character-count validation.
- Support v4 prompt import.
- Improve planner cache.
- Preserve situation-list scroll state.
- Reduce NAI error cooldown if safe.
- Add download path selection.
- Add mosaic processing.
- Improve previews and buffer behavior.
- Improve mobile UI.

### P3: Low Priority / Later

- Investigate v4 quality mismatch against NovelAI official site output.
- Add cross-project situation sharing.
- Decide external image-site preview strategy.
- Expand simple image-processing tools beyond mosaic.
- Complete full codebase documentation after the core structure stabilizes.

## 7. Open Questions

- Should the planner become an independent page, or should it remain inside the project screen?
- What is the exact schema for projects, characters, outfits, situations, prompt variants, and plans?
- Which data should be moved into a database first?
- How should real-time planner updates work without full refresh?
- How should undo work when generation has already started or completed?
- How should composition randomization be configured per situation?
- What is the final mobile UI layout for project, planner, and preview workflows?
- Should image-site previews remain supported, or should previews be limited to filtered project-owned images?

## 8. Priority Investigation Items

- Current planner code flow
- Current browser generation flow
- Current background generation flow
- Scheduled generation processing structure
- Import button locations and import call paths
- Prompt merge/separation behavior in planner upload
- Temporary storage structure
- Storage bucket usage and buffer limits
- Project-level data model
- Database migration candidates
- Security and permission-check locations
- Code structure for direct future development
