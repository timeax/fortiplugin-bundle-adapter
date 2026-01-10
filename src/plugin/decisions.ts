/* =========================================================
 * Shared primitives
 * ========================================================= */

export type PermissionType =
   | "db"
   | "file"
   | "notification"
   | "module"
   | "network"
   | "codec"
   | (string & {});

/**
 * previous = the concrete's CURRENT natural_key you are modifying.
 * (server will build a new naturalKey from current target + merged actions)
 */
export interface PermissionDecisionBase<TType extends PermissionType> {
   type: TType;
   previous: string;
}

/** Tri-state toggle: null = do not touch */
export type TriState = boolean | null;

/* =========================================================
 * DB decision detail
 *  - explicit actions (tri-state)
 *  - null means "admin didn't touch"
 * ========================================================= */

export interface DbPermissionDecisionDetail
   extends PermissionDecisionBase<"db"> {
   select?: TriState;
   insert?: TriState;
   update?: TriState;
   delete?: TriState;
   truncate?: TriState;
   grouped_queries?: TriState;
}

/* =========================================================
 * File decision detail
 * ========================================================= */

export interface FilePermissionDecisionDetail
   extends PermissionDecisionBase<"file"> {
   read?: TriState;
   write?: TriState;
   append?: TriState;
   delete?: TriState;
   mkdir?: TriState;
   rmdir?: TriState;
   list?: TriState;
}

/* =========================================================
 * Notification decision detail
 * ========================================================= */

export interface NotificationPermissionDecisionDetail
   extends PermissionDecisionBase<"notification"> {
   send?: TriState;
   receive?: TriState;
}

/* =========================================================
 * Module decision detail
 *  - action is represented by access in concrete; UI uses "call"
 * ========================================================= */

export interface ModulePermissionDecisionDetail
   extends PermissionDecisionBase<"module"> {
   call?: TriState;
}

/* =========================================================
 * Network decision detail
 *  - action is represented by access in concrete; UI uses "request"
 * ========================================================= */

export interface NetworkPermissionDecisionDetail
   extends PermissionDecisionBase<"network"> {
   request?: TriState;
}

/* =========================================================
 * Codec decision detail
 *  - action is represented by access in concrete; UI uses "invoke"
 * ========================================================= */

export interface CodecPermissionDecisionDetail
   extends PermissionDecisionBase<"codec"> {
   invoke?: TriState;
}

/* =========================================================
 * Union
 * ========================================================= */

export type PermissionDecisionDetail =
   | DbPermissionDecisionDetail
   | FilePermissionDecisionDetail
   | NotificationPermissionDecisionDetail
   | ModulePermissionDecisionDetail
   | NetworkPermissionDecisionDetail
   | CodecPermissionDecisionDetail;

/* =========================================================
 * Action key helpers (optional, but makes UI simpler)
 * ========================================================= */

export type DbActionKey =
   | "select"
   | "insert"
   | "update"
   | "delete"
   | "truncate"
   | "grouped_queries";

export type FileActionKey =
   | "read"
   | "write"
   | "append"
   | "delete"
   | "mkdir"
   | "rmdir"
   | "list";

export type NotificationActionKey = "send" | "receive";
export type ModuleActionKey = "call";
export type NetworkActionKey = "request";
export type CodecActionKey = "invoke";

export type PermissionActionKeyByType = {
   db: DbActionKey;
   file: FileActionKey;
   notification: NotificationActionKey;
   module: ModuleActionKey;
   network: NetworkActionKey;
   codec: CodecActionKey;
};

/* =========================================================
 * Convenience: payload you POST from the UI
 * ========================================================= */

export interface PermissionDecisionRequestDto {
   plugin_id: number;
   detail: PermissionDecisionDetail;

   /**
    * Host-side metadata only.
    * Keep this minimal; justification is dev-only and should not be part of host decision payload.
    */
   meta?: {
      active?: boolean;
      constraints?: Record<string, unknown> | null;
      audit?: Record<string, unknown> | null;
   };
}