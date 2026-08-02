# Assets Library v1 Plan

## Summary
Add a new organization-level `Assets` area under the main dashboard sidebar.

This page should act like a lightweight file explorer for the active organization:

- upload assets
- create folders
- browse one folder at a time
- rename items
- move items
- delete items

V1 should stay isolated to its own dashboard page first. Other features such as event pages, emails, forms, and promotions can integrate with the asset library later after the storage model and UI are proven.

The first supported asset types should be:

- images
- PDFs

The design must also leave room to move away from Firebase later. Even if Firebase remains the first backend, the app should not hardcode the asset feature directly to Firebase Storage or Firestore APIs at the product layer.

## Product Goals
- Give each organization one shared asset library that multiple events can reuse.
- Keep the UI familiar by making it feel closer to a file explorer than a settings form.
- Avoid expensive recursive reads, tree hydration, or path rewrites on every browse action.
- Separate binary storage from asset metadata so future integrations stay predictable.
- Add a clean abstraction layer so the underlying provider can change later:
  - Firebase now
  - AWS or another provider later

## Locked v1 Decisions
- Add a new main dashboard sidebar item:
  - `Assets`
- Primary route:
  - `/dashboard/assets`
- Scope:
  - organization/workspace only
- V1 is isolated:
  - no event-level asset library yet
  - no direct integration into editors yet
- V1 asset types:
  - image files
  - PDF files
- The page should support folders.
- The page should support moving both files and folders.
- The page should avoid recursive listing by default.
- Storage provider access must sit behind an abstraction layer.
- Metadata persistence should also sit behind a repository boundary.

## Product Direction
This should feel like a shared workspace library, not a technical storage admin page.

The user should be able to:

- open `Assets`
- create a folder
- upload files into the current folder
- move files between folders
- move folders under other folders
- rename items
- delete items

The page should stay visually clean and avoid over-explaining itself.

## v1 Scope
- Add a new dashboard page under the workspace shell:
  - `/dashboard/assets`
- Add a new sidebar item in `src/features/dashboard/nav.ts`
- Add breadcrumb/meta support in `src/features/dashboard/components/dashboard-shell.tsx`
- Support organization-scoped browsing of:
  - folders
  - files
- Support the following actions:
  - create folder
  - upload file
  - rename file
  - rename folder
  - move file
  - move folder
  - delete file
  - delete folder
- Store file metadata separately from binary blobs.
- Add a storage abstraction layer for file blobs.
- Add a repository abstraction layer for asset/folder metadata.
- Keep the event-page uploader isolated for now, but document it as a future adopter of the shared asset service.

Out of scope for v1:

- rich previews beyond basic image/PDF support
- event-scoped asset libraries
- public asset picker integration inside page/email/form editors
- tagging
- version history
- asset permission sub-roles
- bulk move/copy
- folder sharing rules
- OCR
- AI tagging
- video/audio uploads
- thumbnail pipelines

## Information Architecture and Routes
- Add a new workspace route:
  - `/dashboard/assets`
- Add a new main dashboard sidebar item:
  - `Assets`
- Add breadcrumb/meta support:
  - `Dashboard > Assets`

Recommended initial files:

- `src/app/dashboard/(workspace)/assets/page.tsx`
- `src/features/assets/components/assets-library-page.tsx`
- `src/features/assets/components/asset-explorer-table.tsx`
- `src/features/assets/components/asset-move-dialog.tsx`
- `src/features/assets/components/asset-upload-button.tsx`
- `src/features/assets/schema.ts`
- `src/features/assets/utils.ts`
- `src/lib/assets/blob-store.ts`
- `src/lib/assets/catalog-store.ts`
- `src/lib/assets/providers/firebase-blob-store.ts`
- `src/lib/assets/repositories/firestore-asset-catalog.ts`

Recommended page structure:

- toolbar
- breadcrumb path for the current folder
- current-folder contents
- actions:
  - `New folder`
  - `Upload`
  - `Move`
  - `Rename`
  - `Delete`
- optional detail panel or metadata row

Important UX constraint:

- avoid a fully recursive left-hand folder tree in v1
- browse one folder level at a time using breadcrumb navigation
- this keeps queries simple and predictable

## Storage and Metadata Architecture
Do not couple the feature directly to Firebase APIs in page components or route handlers.

Split the system into two clear boundaries:

### Blob store
Responsible for binary file storage.

Suggested interface:

- `upload`
- `delete`
- `getDownloadUrl`
- `getMetadata`

Suggested implementation names:

- `AssetBlobStore`
- `FirebaseAssetBlobStore`
- later:
  - `S3AssetBlobStore`

### Catalog store
Responsible for file/folder metadata used by the dashboard explorer.

Suggested interface:

- `listChildren`
- `getNode`
- `createFolder`
- `createFileRecord`
- `renameNode`
- `moveNode`
- `deleteNode`

Suggested implementation names:

- `AssetCatalogStore`
- `FirestoreAssetCatalogStore`
- later:
  - `DynamoAssetCatalogStore`
  - `SqlAssetCatalogStore`

This split is important because a future AWS migration may change:

- blob storage:
  - Firebase Storage -> S3
- metadata persistence:
  - Firestore -> DynamoDB, Postgres, or another store

The app layer should talk to the interfaces, not the provider-specific clients.

## Core Modeling Decision
Use virtual folders backed by metadata instead of treating storage paths as the source of truth.

That means:

- folders exist in metadata
- files exist in metadata
- blob object keys stay stable and opaque
- UI paths are derived from metadata, not from storage folder names

This avoids expensive object renames when a user:

- renames a folder
- moves a folder
- reorganizes the library

Recommended blob key shape:

- `organizations/{organizationId}/assets/files/{assetId}/{sanitizedOriginalName}`

Recommended rule:

- never encode the visible folder path into the blob key
- only encode stable ids

That makes file moves metadata-only rather than storage-copy operations.

## Data Model
Use one metadata model for both files and folders.

Recommended collection name:

- `AssetNode`

Recommended node kinds:

- `"folder"`
- `"file"`

Suggested document shape:

- `organizationId`
- `kind`
- `parentId`
- `name`
- `mimeType?`
- `extension?`
- `sizeBytes?`
- `blobKey?`
- `provider`
- `status`
- `createdBy`
- `updatedBy`
- `createdAt`
- `updatedAt`

Field notes:

- `parentId`
  - `null` means the organization root
- `name`
  - user-visible file or folder name
- `blobKey`
  - only for files
- `provider`
  - example:
    - `firebase-storage`
    - future:
      - `s3`
- `status`
  - example values:
    - `ready`
    - `uploading`
    - `failed`

Optional future metadata:

- `checksum`
- `width`
- `height`
- `pageCount`
- `description`

V1 should not require those extras.

## Folder Browsing Strategy
The page should never recursively fetch the whole tree.

Recommended browse pattern:

- load only the current folder's direct children
- load the current folder record if needed
- load breadcrumb ancestors for the current folder only

That means the common page request stays close to:

- one query for folder contents
- a small number of point reads for breadcrumb ancestors

Avoid:

- auto-loading all descendants
- recursive tree hydration
- counting everything in the organization on every page load

## Folder Move Strategy
Moving folders can become very expensive if descendants need path rewrites.

To avoid that:

- store `parentId`, not a denormalized full path string as the canonical source
- derive breadcrumb chains from parent links
- keep blob keys stable

Recommended move behavior:

- moving a file updates only the file metadata
- moving a folder updates only that folder's `parentId`
- child nodes remain attached to the moved folder without needing rewrites

Important validation:

- prevent moving a folder into itself
- prevent moving a folder into one of its descendants

That validation can be done by walking the destination folder's parent chain upward, which is far cheaper than scanning an entire subtree.

## Request and Cost Guardrails
This feature should be designed around predictable, low-query behavior.

Recommended guardrails:

- browse by `parentId`
- paginate large folders
- no recursive tree fetches
- no background recounts on every mutation
- no storage copy during normal rename/move actions
- no path-based folder semantics in blob storage

Recommended pagination defaults:

- page size: `50`
- optional load more / cursor paging for larger folders

Recommended depth guardrail:

- maximum folder depth: `8`

Recommended upload guardrails for v1:

- images only:
  - common web-safe types
- PDFs only:
  - `application/pdf`
- maximum file size:
  - images: `10 MB`
  - PDFs: `25 MB`

Recommended naming guardrails:

- trim whitespace
- reject empty names
- reject slash characters in names
- enforce per-folder uniqueness for:
  - folder names
  - file names

## UX Plan
The page should feel more like a file explorer and less like a form-heavy admin console.

### Explorer layout
- top breadcrumb path
- current folder title
- actions row
- current folder contents in a clean table or list

### Suggested columns
- name
- type
- size
- updated
- actions

### Supported actions
- open folder
- download file
- rename
- move
- delete

### Upload flow
- user uploads from the current folder
- upload result appears in the current listing
- failed uploads show a clear retry/error state

### Move flow
- open a move dialog
- choose destination folder
- confirm move

Important v1 UX constraint:

- no always-expanded recursive tree sidebar
- use breadcrumbs and destination pickers instead

## API and Service Shape
Use server-side routes or server actions that call the abstraction layer.

Possible route shapes:

- `GET /api/dashboard/assets?parentId=...`
- `POST /api/dashboard/assets/folders`
- `POST /api/dashboard/assets/files`
- `PATCH /api/dashboard/assets/nodes/[nodeId]`
- `DELETE /api/dashboard/assets/nodes/[nodeId]`
- `POST /api/dashboard/assets/nodes/[nodeId]/move`

Suggested responsibilities:

- list route:
  - returns direct children only
- create folder route:
  - validates parent and uniqueness
- upload route:
  - validates mime type and size
  - stores blob through `AssetBlobStore`
  - writes metadata through `AssetCatalogStore`
- move route:
  - validates cross-folder rules
  - prevents cycles
- delete route:
  - deletes metadata
  - deletes blob if the node is a file

## Delete Semantics
Keep delete behavior explicit.

Recommended v1 rules:

- deleting a file deletes:
  - metadata
  - blob
- deleting an empty folder succeeds
- deleting a non-empty folder should either:
  - be blocked in v1
  - or require an explicit recursive delete confirmation later

To keep costs and risk lower, the recommended v1 decision is:

- allow deleting empty folders only
- defer recursive folder delete to a later phase

## Existing Code Reuse Direction
The codebase already has Firebase-based uploads for:

- organization logo
- user avatar
- event page assets

The new asset library should not duplicate that pattern forever.

Recommended direction:

- build the new asset abstraction cleanly
- keep event-page assets isolated for now
- later migrate event-page uploads to use the shared asset services

This reduces risk now while still moving the architecture in the right direction.

## Future Integration Path
Once the isolated asset page is stable, later phases can connect it to:

- event page builder image selection
- email attachments or linked PDFs
- form-related media
- promotion assets

Possible later UX:

- `Choose from Assets`
- `Upload new`

Those integrations should reuse the same organization library instead of inventing separate upload silos.

## Suggested Implementation Phases
1. Add the markdown plan.
2. Add the `Assets` sidebar item and `/dashboard/assets` route shell.
3. Add shared asset schemas and metadata types.
4. Add the storage abstraction interfaces.
5. Add Firebase-backed blob and Firestore-backed catalog adapters.
6. Build the isolated asset library page with breadcrumb browsing.
7. Add folder creation, file upload, rename, move, and delete flows.
8. Add tests for folder navigation, uniqueness, move validation, and upload constraints.
9. Later, integrate the shared asset library into page/email/form features.

## Test Plan
- Navigation:
  - `Assets` appears in the main dashboard sidebar
  - `/dashboard/assets` loads in the workspace shell
  - breadcrumb shows `Dashboard > Assets`
- Browsing:
  - root folder loads
  - child folder navigation works
  - breadcrumb navigation works
  - only direct children are returned for a folder query
- Folder creation:
  - can create a folder in root
  - can create a folder inside another folder
  - duplicate folder names in the same parent are rejected
- File upload:
  - image upload succeeds
  - PDF upload succeeds
  - unsupported mime types are rejected
  - oversize files are rejected
- Rename:
  - can rename file
  - can rename folder
  - duplicate names in the same parent are rejected
- Move:
  - file can move to another folder
  - folder can move to another folder
  - moving a folder into itself is rejected
  - moving a folder into its descendant is rejected
  - moving items does not require blob copies
- Delete:
  - file delete removes blob and metadata
  - empty folder delete succeeds
  - non-empty folder delete is blocked in v1
- Scoping:
  - one organization cannot list another organization's assets
- Abstraction:
  - page and routes depend on interfaces, not Firebase-specific code paths

## Acceptance Criteria
- A markdown plan exists at `docs/assets-library-v1-plan.md`
- The plan defines a new organization-level dashboard tab:
  - `Assets`
- The plan defines a new route:
  - `/dashboard/assets`
- The plan defines an isolated v1 asset-library page
- The plan supports:
  - images
  - PDFs
  - folders
  - file move
  - folder move
- The plan defines a storage abstraction layer
- The plan defines a metadata repository abstraction layer
- The plan avoids recursive tree fetching as the default browse model
- The plan avoids path-based blob renames on normal move/rename actions
- The plan explicitly keeps cross-feature integrations for later phases

## Assumptions
- The active organization already exists in dashboard context and can scope every asset request.
- A shared organization library is more useful than event-level libraries for the first release.
- Firebase is acceptable as the first provider, but should not leak through the whole feature.
- Virtual folders backed by metadata are a better long-term fit than using storage paths as the UI model.
- Keeping the first release isolated is more valuable than rushing editor integrations.
