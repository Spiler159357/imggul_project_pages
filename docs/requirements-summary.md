# imggul Requirements Summary

## 1. Overview

This document summarizes future improvement requirements for the imggul project. The current direction focuses on image generation UX, project-based asset management, prompt presets, temporary storage workflows, and storage usage optimization.

## 2. Functional Requirements

### 2.1 Access And UI/UX

- Guest users who access `imggul.com` directly should see a clear invalid-access notice.
- Image prompt input should support easier weighting syntax entry and review.
- Scheduled image generation should show an estimated duration.
- Scheduled generation should continue in the background without requiring the user to keep watching the screen.
- The side area shown after image generation should be collapsible when it is not needed.

### 2.2 Image Generation

- Reference images should be selectable from both direct uploads and images already stored in the storage bucket.
- The `vibe transfer` feature should be usable again.
- Differences in v4 model pricing should be investigated when needed.

### 2.3 Prompt Presets

- Users should be able to save prompt presets for different situations.
- Presets should belong to a project.
- Presets should have a structure that can later be imported from other project features.
- Users should be able to select multiple presets at the same time.
- Asset generation plans should be executable based on the selected preset combination.
- Plans should support character-specific additional tags and excluded tags.
- The final UI model for this area should be designed later, including checkboxes, tag entry, and toggles.

### 2.4 Scheduled Generation And Data Persistence

- When scheduled generation starts, prompt data, reference images, and settings should be persisted together.
- Persisted data should be reusable later through import and playback flows.
- Scheduled generation results should be stored in temporary storage when needed.

### 2.5 Temporary Storage

- Images generated through plans should be stored as `webp`.
- Generation results should be stored in a separate temporary storage area.
- Users should be able to select and confirm desired assets.
- Unselected assets should be removable from temporary storage in bulk.
- Users should be able to navigate temporary-storage images quickly by direction keys.

### 2.6 Upload Flow

- The existing "select target, then upload" flow should become an "start upload, then select target" flow.
- After project restructuring, upload targets should be connected to project, character, and situation data.
- External image uploads should continue to be supported from the project management screen.

### 2.7 Project Management

- The existing explorer screen should become a project-list-centered screen.
- Selecting a project should navigate to the project management screen.
- Each project should have a name, code, display alias, and actual storage path.
- Project management should include child areas for characters, situations, and prompt sets.
- Projects should be able to store style prompts for unified visual direction.

### 2.8 Characters

- Users should be able to review images by character.
- Users should be able to save and open image prompts per character.
- External image upload should be supported.

### 2.9 Situations

- Users should be able to configure asset situations within a project.
- Situations should connect to preset definitions.
- Situation-specific generation requirements should be usable in plans.

### 2.10 Prompt Sets

- System prompt design should become formalized.
- Users should be able to manage project-level common prompts, style prompts, and situation-specific prompts.
- The app should provide helper functionality for defining prompt sets.

### 2.11 Image Search And Management

- Image downloads should support choosing a save path.
- Basic image processing features, such as mosaic support, should be provided.

### 2.12 Preview And Storage Management

- The buffer system should be strengthened to account for storage usage limits.
- Showing all images at once should be avoided for previews.
- If a character or situation is selected, previews should show only matching images.
- Mobile views should reduce the amount of storage-heavy image checking.

### 2.13 Security

- Security around authentication, access control, uploads, and storage access should be strengthened.
- Guest access and regular user/admin access should have clearly separated permissions.

## 3. Non-Functional Requirements

- Project-level data structures should be easy to import and export later.
- Storage usage for generated images should be controllable.
- The UI should clearly separate image generation from project management responsibilities.
- Temporary-storage data should be cleanable based on confirmation state.
- Code structure should be documented so it remains understandable and directly editable.

## 4. Responsibility Areas

### Image Generation Area

- Character and pose exploration
- Art-style exploration
- Single-image generation
- Prompt experimentation
- Reference-image-based tests

### Project Area

- Actual asset generation
- Character-specific image management
- Situation-specific asset management
- Prompt preset management
- Stored generation plan execution
- Temporary result confirmation and cleanup

## 5. Open Questions

- Final layout for the project management screen
- UI model for including and excluding plan tags
- Concrete layout for collapsing side and shared space
- Exact storage location and cleanup rules for the buffer system
- Concrete scope for security hardening
- Cause of v4 model pricing differences

## 6. Priority Investigation Items

- Project-level data model
- Scheduled image generation processing structure
- Temporary storage structure
- How stored images should be referenced
- Preset import/export format
