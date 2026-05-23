# imggul Improvement Plan

## 1. Goal

The goal is to separate and organize image generation, image browsing, and project-specific asset management so imggul can evolve from a simple image generation tool into a project-based asset creation tool.

The main direction is:

- Keep the image generation tab focused on character and pose exploration, art-style exploration, and idea validation.
- Move actual asset creation and saved asset management into project-centered workflows.
- Manage prompts, reference images, situations, presets, and temporary generation results at the project level.
- Improve preview and temporary-storage workflows to reduce storage usage and mobile load.

## 2. Major Workstreams

### 2.1 UI/UX Improvements

- Show a clear invalid-access notice when a guest reaches `imggul.com` directly.
- Add helper functionality for prompt weighting syntax.
- Show estimated time for scheduled generation.
- Let scheduled generation continue in the background.
- Continuously incorporate usage issues found during normal use.

### 2.2 Image Generation Flow Improvements

- Allow reference images to be selected from storage, not only from local upload.
- Restore the `vibe transfer` workflow.
- Store situation-specific prompt presets in a project-owned structure and design them for natural import later.
- Allow selecting multiple presets and using them for asset generation plans.
- Support character-specific additional tags and excluded tags in plans.
- Force plan-based generation results to `webp` and store them in separate temporary storage.
- Let users confirm only selected assets and bulk-delete unselected temporary assets.
- Support quick directional navigation through temporary-storage images.
- Persist prompt-related data at the start of scheduled generation for later import.
- Investigate v4 model pricing differences when this becomes relevant.
- Change the upload flow from "select target, then upload" to "start upload, then select target".

### 2.3 Project Structure Features

- Convert the existing explorer screen into a project-list-centered screen.
- Keep logs, personal memos, and temporary storage access in a bottom or side utility area.
- Navigate to a project management screen after selecting a project.
- Reduce layout waste by applying collapsible or foldable side-space behavior where appropriate.
- Manage project name, code, display alias, and actual storage path.
- Provide child sections for characters, situations, and prompt sets.
- Store style prompts for a consistent visual direction per project.

### 2.4 Additional Improvements

- Add support for choosing the save path when downloading images.
- Add simple image processing features such as mosaic support.
- Strengthen the buffer system with storage-usage limits in mind.
- Improve previews so they show relevant images based on selected character or situation instead of loading everything.
- Strengthen security features.

## 3. Phased Progress Plan

### Phase 1: Stabilization

- Improve guest-access guidance.
- Add image download path selection.
- Add basic security checks.

### Phase 2: Image Generation Workflow

- Add prompt input helper functionality.
- Support selecting reference images from storage.
- Restore `vibe transfer`.
- Add estimated time display and background processing for scheduled generation.
- Persist data at the start of scheduled generation.

### Phase 3: Project Screen And Structure

- Convert the existing explorer screen into a project list.
- Add the project management screen.
- Design character, situation, and prompt-set structures.
- Design project-specific style prompt and preset storage.
- Strengthen external image upload linkage to projects.

### Phase 4: Saved Asset Generation Plans

- Implement situation-specific preset storage and import structure.
- Add generation plans based on multiple selected presets.
- Add support for character-specific extra tags and excluded tags.
- Add temporary-storage-based generated result management.
- Add selected-asset confirmation and bulk cleanup of unselected assets.
- Improve directional navigation in temporary storage.

### Phase 5: Operations And Optimization

- Improve preview loading behavior.
- Strengthen the buffer system.
- Optimize storage usage.
- Investigate v4 model pricing differences.
- Document code structure and development guidance.

## 4. Priorities

### High

- Project structure design
- Project-level persistence for prompts and related data
- Temporary storage and generated result management

### Medium

- Prompt input UX improvements
- Background scheduled generation
- Reference image selection from storage
- Preview improvements
- Download path selection

### Low

- v4 model pricing investigation
- Convenience features for external UI flows
- Expansion of additional image processing features

## 5. Separate Study Items

To make future development easier and safer, the codebase structure should be understood and documented clearly.

Priority areas to map:

- Cloudflare Pages Functions structure
- Frontend file organization
- Image storage and API call flow
- Image generation request and scheduled processing flow
- Explorer, modal, and temporary-storage state management
