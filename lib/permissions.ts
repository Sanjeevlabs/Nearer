// Who may do what in a family. One table, read by route handlers (enforced)
// and by screens (to hide what you can't do). Generation (elder/adult/child)
// is who you are in the tree; access is what you may do:
//   owner  exactly one (the creator): everything an admin can, plus handing
//          the family over, deleting it, and billing.
//   admin  up to 3 counting the owner: lets joiners in, removes people,
//          changes roles, edits the tree, moderates, runs care. Admins never
//          read others' private things (sealed morning letters, partner
//          orders, safety check-ins they weren't chosen for).
//   member shares, voices, wishes, plans, care tasks, invites (joiners wait).
//   teen   (13-17) shares, voices, wishes, stories. No care, Trusted nearby,
//          Send something, or being at someone's window.
//   child  (0-12) a profile only, no login.
// Elder mode is a setting, not a role. A pending member can do nothing yet.
import type { Member } from "./schemas";

export type Action =
  | "tree.add" // add a person or link two people
  | "tree.edit" // edit a person who has no account yet
  | "tree.remove" // remove a person who has no account yet
  | "tree.remove-account" // remove someone who has their own account
  | "roles.assign" // change someone's access
  | "members.approve" // let a joiner in, or decline them
  | "invite.create"
  | "invite.revoke"
  | "care.manage" // care tasks, local helpers, trusted nearby
  | "care.write" // any write to care (own tasks, own trusted nearby)
  | "partners.order" // Send something
  | "window.at" // be one of the people at someone's window
  | "events.plan"
  | "content.moderate" // delete someone else's voice memory, photo, recipe…
  | "owner.transfer"
  | "family.delete"
  | "billing.manage";

export const MAX_ADMINS = 3; // owner included
export const MAX_PEOPLE = 50; // per family, everyone counted
export const MAX_SIDES = 4; // families per person: their own and the ones they joined
export const MAX_FAMILIES = 4; // per person (sides)

const MEMBER: Action[] = ["tree.add", "tree.edit", "tree.remove", "invite.create", "care.manage", "care.write", "partners.order", "window.at", "events.plan"];
const ADMIN: Action[] = [...MEMBER, "tree.remove-account", "roles.assign", "members.approve", "invite.revoke", "content.moderate"];
const OWNER: Action[] = [...ADMIN, "owner.transfer", "family.delete", "billing.manage"];

const TABLE: Record<Member["access"], Action[]> = {
  owner: OWNER,
  admin: ADMIN,
  member: MEMBER,
  teen: [],
  child: [],
};

type Who = Pick<Member, "access"> & { status?: Member["status"] };

export function can(who: Who | undefined | null, action: Action): boolean {
  if (!who || who.status === "pending") return false;
  return Boolean(TABLE[who.access ?? "member"]?.includes(action));
}

/** Owner or admin: the people who look after the family. */
export function isAdmin(who: Pick<Member, "access"> | undefined | null): boolean {
  return who?.access === "owner" || who?.access === "admin";
}

/** Owner, admin or member: a grown-up with an account (not a teen or child). */
export function isGrownUp(who: Pick<Member, "access"> | undefined | null): boolean {
  return who?.access === "owner" || who?.access === "admin" || who?.access === "member";
}

/**
 * A place the family made for someone who hasn't joined yet: no account, not
 * an admin, not a teen or child, not waiting for approval. An invite code may
 * open only this kind of place ("I'm Maa"), never a child's profile.
 */
export function isClaimable(m: Pick<Member, "email" | "access" | "status" | "role">): boolean {
  return !m.email && m.access === "member" && m.status !== "pending" && m.role !== "child";
}

/** Authors manage their own things; admins may remove anything in the family. */
export function canChange(who: Pick<Member, "id" | "access"> | undefined | null, ownerId: string | null | undefined, mode: "edit" | "delete" = "delete"): boolean {
  if (!who) return false;
  if (ownerId && ownerId === who.id) return true;
  return mode === "delete" && can(who, "content.moderate");
}

export const ACCESS_ORDER: Member["access"][] = ["owner", "admin", "member", "teen", "child"];

export const ACCESS_LABEL: Record<Member["access"], { label: string; note: string }> = {
  owner: { label: "Owner", note: "Started the family; can hand it over" },
  admin: { label: "Admin", note: "Lets people in, manages roles and the tree" },
  member: { label: "Member", note: "Shares, plans, helps with care and invites" },
  teen: { label: "Teen", note: "Shares, voices, wishes and stories" },
  child: { label: "Child", note: "A profile only, no login" },
};
