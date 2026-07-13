# IAM v1 Plan

## Summary
Add an organization-scoped IAM surface inside the dashboard so owners can:

- view organization members
- invite new people into the organization
- assign a role or permission group during invite
- change a member's role or effective permissions later
- manage reusable permission groups to reduce manual permission editing

This should be built as a practical v1 that works with the current Firestore model, while staying flexible because the data model is still evolving.

## Product Direction
The product should not expose raw Firebase or Firestore concepts directly to users.

User-facing language should be:

- `Users & Access`
- `Members`
- `Invites`
- `Permission groups`
- `Role`
- `Access`

Avoid naming the page just `User`, because that sounds like a profile page.

Recommended dashboard nav label:

- `Users & Access`

Recommended route:

- `/dashboard/iam`

Alternative acceptable route if you want it closer to settings:

- `/dashboard/settings/iam`

For v1, I recommend a first-class route:

- `/dashboard/iam`

That makes it easier to grow into a real admin area later.

## Scope for v1
### In scope
- org-scoped members page
- owner-only invite flow
- owner-only member access editing
- permission groups
- role presets
- basic invite lifecycle

### Out of scope for v1
- SSO / enterprise identity providers
- domain auto-join UI
- approval workflows
- cross-organization memberships UI
- audit logs UI
- seat billing
- granular object-level access rules beyond current permission strings

## Recommended Information Architecture
Use one parent page with tabs or sections:

- `Members`
- `Invites`
- `Permission groups`

Optional fourth section later:

- `Audit log`

Recommended layout:

- page header with org name and owner-only actions
- summary cards
- tabbed content

Recommended actions in header:

- `Invite member`
- `Create group`

## Current Data Reality
The repo already has useful primitives:

- `UserDoc`
  - `organizationId`
  - `organizationRole`
  - `permissions`
  - `organizations[]`
- `InvitationDoc`
  - already defined in `src/types/collection.ts`
- `OrganizationDoc`
  - contains org ownership and invite-related fields

The current `UserPermission` set already includes:

- `view:events`
- `write:events`
- `view:form`
- `write:form`
- `view:invoice`
- `write:invoice`
- `view:promotion`
- `write:promotion`
- `view:organization`
- `write:organization`
- `view:user`
- `write:user`

This is enough to build a first IAM UI without redesigning permissions from scratch.

## Recommended v1 Access Model
Use three layers:

### 1. Organization role
Keep the existing role system:

- `owner`
- `admin`
- `member`

Behavior:

- `owner`
  - full access
  - can invite
  - can edit any member except guardrails around owner transfer
  - can manage groups
- `admin`
  - broad operational access
  - may be allowed to invite based on group/permissions
  - cannot remove or demote the owner
- `member`
  - limited access based on group or manual permissions

### 2. Permission group
Add reusable groups, for example:

- `Event Manager`
- `Form Manager`
- `Operations`
- `Read Only`

A group is a named bundle of permission strings.

### 3. Effective permission list
Continue storing a flattened `permissions` array on the `User` document for easy checking at runtime.

This is the pragmatic v1 pattern:

- source of truth:
  - role
  - optional group ids
  - optional manual overrides
- runtime convenience:
  - final `permissions[]` stored on the user doc

That avoids expensive permission composition everywhere in the app.

## Recommended New Documents
### `PermissionGroupDoc`
Suggested new collection:

- `PermissionGroup`

Suggested shape:

```ts
interface PermissionGroupDoc {
  organizationId: string;
  name: string;
  description: string;
  status: "active" | "archived";
  permissions: UserPermission[];
  isSystem: boolean;
  createdAt: Timestamp | FieldValue;
  updatedAt: Timestamp | FieldValue;
}
```

Purpose:

- reusable bundles of permission strings
- easier onboarding and member updates
- supports future system-default groups and org-created groups

### Extend `UserDoc`
Suggested additive fields:

```ts
groupIds?: string[];
manualPermissions?: UserPermission[];
permissionSource?: "role" | "group" | "mixed";
```

For v1, this can still resolve down into the existing:

```ts
permissions: UserPermission[]
```

### Extend `InvitationDoc`
Suggested additive fields:

```ts
groupIds?: string[];
permissions?: UserPermission[];
invitedUserId?: string;
acceptedAt?: Timestamp;
revokedAt?: Timestamp;
```

This allows invites to carry role + group intent before the user joins.

## Recommended Permission Resolution
When a member is created or updated:

1. start with role defaults
2. merge selected group permissions
3. merge manual permissions if allowed
4. write final flattened permissions to `User.permissions`

This should happen server-side only.

Do not trust the client to compute final permissions.

## Suggested Server Ownership Rules
### Only owners should be able to
- create groups
- edit groups
- revoke invites
- promote/demote admins
- change another user's group assignments
- suspend members

### Admins may later be allowed to
- invite members
- assign limited preset groups
- edit operational access only

For v1, keep it simpler:

- only `owner` manages IAM

That reduces risk and keeps the first version understandable.

## Dashboard Route Plan
Recommended routes:

- `/dashboard/iam`
- `/dashboard/iam/invites`
- `/dashboard/iam/groups`

If you want a simpler v1, keep just:

- `/dashboard/iam`

with three internal sections:

- members
- invites
- groups

I recommend the single-route approach for v1.

## Page Structure
### Header
- title: `Users & Access`
- description: `Manage members, invites, and permission groups for this organization.`
- actions:
  - `Invite member`
  - `Create group`

### Summary cards
- total members
- pending invites
- active groups

### Section 1: Members
Each member row/card should show:

- name
- email
- status
- org role
- assigned groups
- effective access summary
- join date

Owner actions per member:

- change role
- assign/remove groups
- edit direct permissions
- suspend/reactivate
- revoke access

Guardrails:

- cannot remove the last owner
- cannot demote yourself without explicit owner transfer flow

### Section 2: Invites
Each invite row/card should show:

- email
- role
- assigned group(s)
- status
- created by
- created time
- expiry

Actions:

- resend
- revoke
- copy invite link

### Section 3: Permission groups
Each group row/card should show:

- name
- description
- permissions included
- system/custom badge
- number of members using the group

Actions:

- create
- edit
- archive
- duplicate

## Good v1 Default Groups
Recommended system groups:

- `Organization Admin`
- `Events Manager`
- `Forms Manager`
- `Read Only`

Possible defaults:

- `Organization Admin`
  - broad write access except maybe destructive owner-only operations
- `Events Manager`
  - events + public page + responses access
- `Forms Manager`
  - forms + templates + responses access
- `Read Only`
  - view-only operational access

These should be editable only if you want custom org behavior later.

For v1, system groups can be read-only templates that users duplicate.

## Invite Flow
Recommended flow:

1. owner clicks `Invite member`
2. enters email
3. selects role
4. optionally selects permission group(s)
5. submit creates `InvitationDoc`
6. invite status becomes `active`

Possible delivery modes later:

- email invite
- copy link
- invite code

For v1, the simplest realistic path is:

- create invite
- show/copy invite link

Email sending can come later.

## Member Edit Flow
Recommended flow:

1. owner opens member row
2. updates:
   - role
   - groups
   - optional manual permissions
3. server recalculates flattened `permissions[]`
4. write updated user document

Keep this server-driven via admin routes.

## Firestore and API Plan
### New collection
- `PermissionGroup`

### Existing collections to use
- `User`
- `Organization`
- `Invitation`

### New API routes
Recommended server routes:

- `GET /api/dashboard/iam`
  - org-scoped IAM summary
- `POST /api/dashboard/iam/invites`
  - create invite
- `PATCH /api/dashboard/iam/members/[userId]`
  - update role/groups/permissions
- `POST /api/dashboard/iam/groups`
  - create group
- `PATCH /api/dashboard/iam/groups/[groupId]`
  - update group
- `POST /api/dashboard/iam/invites/[inviteId]/revoke`
  - revoke invite

All should use:

- session cookie
- server-side auth decode
- org scope lookup
- owner check

## UI and Naming Guidance
Use user-friendly labels instead of raw permission strings where possible.

Example display mapping:

- `view:events` -> `View events`
- `write:events` -> `Manage events`
- `view:form` -> `View forms`
- `write:form` -> `Manage forms`

For the UI, favor grouped capability summaries instead of exposing a long raw checkbox list first.

Suggested permission categories:

- Events
- Forms
- Promotions
- Billing
- Organization
- Users & access

## Recommended v1 Build Order
### Phase 1
- add `Users & Access` page scaffold
- org-scoped members read view
- owner-only guard

### Phase 2
- invite creation flow
- pending invites list

### Phase 3
- permission groups collection and CRUD
- member assignment to groups

### Phase 4
- member edit flow
- flattened permission recomputation

### Phase 5
- resend/revoke invite
- status changes and guardrails

## Test Plan
### Happy paths
- owner opens `/dashboard/iam`
- owner sees org members
- owner creates invite
- owner creates group
- owner assigns group to member
- member permissions update correctly

### Permission tests
- non-owner cannot access owner-only IAM actions
- owner cannot remove the final owner
- owner cannot accidentally break their own access without explicit confirmation

### Data integrity tests
- invite carries role/group metadata
- effective permissions are recalculated on member updates
- archived groups are not offered for new assignment

### UI behavior
- members, invites, and groups each have clear empty states
- long permission lists stay readable
- role/group changes are visible after refresh

## Recommended v1 Definition of Done
The IAM v1 feature is in a good first state when:

- `/dashboard/iam` exists
- only owners can manage it
- members list is real and org-scoped
- invites can be created
- permission groups can be created and assigned
- user permissions are updated server-side and persisted cleanly
- UI terminology is understandable for non-technical organizers
