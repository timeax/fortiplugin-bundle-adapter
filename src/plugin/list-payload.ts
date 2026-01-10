import { PermissionType } from "./decisions";

/* =========================================
 * Core primitives
 * ========================================= */
export type PermissionWindow =
  | null
  | {
      limited: true;
      type: string | null;
      value: string | null;
    };

export type PermissionConstraints =
  | (Record<string, unknown> & { required?: boolean })
  | null;

export type PermissionAudit = Record<string, unknown> | null;

/* =========================================
 * Sources (exact nesting per PermissionListItem::toArray)
 * ========================================= */

export interface PermissionSourceDirect {
  assignment_id: number | string | null;
  active: boolean;
  window: PermissionWindow;

  constraints: PermissionConstraints;
  audit: PermissionAudit;

  justification: string | null;

  /** derived in listPermissions() from constraints.required */
  required: boolean;
}

export interface PermissionSourceTag {
  tag_id: number | string | null;
  tag_name: string | null;

  active: boolean;
  constraints: PermissionConstraints;
  audit: PermissionAudit;
}

export interface PermissionListSources {
  direct: PermissionSourceDirect[];
  tags: PermissionSourceTag[];
}

/* =========================================
 * Presentation slices
 * (what extractPresentationAndActions returns)
 * ========================================= */

export interface DbPermissionPresentation {
  model: string | null;
  table: string | null;
  columns: string[] | null;
}

export interface FilePermissionPresentation {
  base_dir: string;
  paths: string[];
  follow_symlinks: boolean;
}

export interface NotificationPermissionPresentation {
  channel: string | null;
  channels: string[] | null;
  templates: string[] | null;
  recipients: string[] | null;
}

export interface ModulePermissionPresentation {
  plugin: string | null;
  plugin_fqcn: string | null;
  apis: string[];
  plugin_docs: string | null;
}

export interface NetworkPermissionPresentation {
  hosts: string[];
  methods: string[];

  schemes: ("https" | "http" | string)[] | null;
  ports: number[] | null;
  paths: string[] | null;

  headers_allowed: string[] | null;
  ips_allowed: string[] | null;

  auth_via_host_secret: boolean;
}

export interface CodecPermissionPresentation {
  module: string; // default "codec"
  allowed: unknown | null;
  methods: unknown | null;
  groups: unknown | null;
  options: unknown | null;
}

/**
 * For unknown/new types, your PHP falls back to $presentation = $row.
 * So this is the generic fallback.
 */
export type UnknownPresentation = Record<string, unknown>;

/* =========================================
 * Effective actions (boolean map)
 * ========================================= */

export type ActionFlags = Record<string, boolean>;

export type DbActionFlags = ActionFlags & {
  select?: boolean;
  insert?: boolean;
  update?: boolean;
  delete?: boolean;
  truncate?: boolean;
  grouped_queries?: boolean;
};

export type FileActionFlags = ActionFlags & {
  read?: boolean;
  write?: boolean;
  append?: boolean;
  delete?: boolean;
  mkdir?: boolean;
  rmdir?: boolean;
  list?: boolean;
};

export type NotificationActionFlags = ActionFlags & {
  send?: boolean;
  receive?: boolean;
};

export type ModuleActionFlags = ActionFlags & {
  call?: boolean;
  publish?: boolean;
  subscribe?: boolean;
};

export type NetworkActionFlags = ActionFlags & {
  request?: boolean;
};

export type CodecActionFlags = ActionFlags & {
  invoke?: boolean;
};

/* =========================================
 * Concrete (raw model arrays)
 * ========================================= */

export type ConcreteRow = Record<string, unknown>;

/* =========================================
 * Items (exact keys from PermissionListItem::toArray)
 * ========================================= */

export interface PermissionListItemBase<
  TType extends PermissionType,
  TPresentation,
  TActions extends ActionFlags
> {
  type: TType;
  concreteId: number;
  naturalKey: string | null;

  presentation: TPresentation;
  effectiveActions: TActions;

  concrete: ConcreteRow;

  /** NOTE: nested under sources.{direct,tags} */
  sources: PermissionListSources;

  required: boolean;
  activeEffective: boolean;
}

export type DbPermissionListItem = PermissionListItemBase<
  "db",
  DbPermissionPresentation,
  DbActionFlags
>;

export type FilePermissionListItem = PermissionListItemBase<
  "file",
  FilePermissionPresentation,
  FileActionFlags
>;

export type NotificationPermissionListItem = PermissionListItemBase<
  "notification",
  NotificationPermissionPresentation,
  NotificationActionFlags
>;

export type ModulePermissionListItem = PermissionListItemBase<
  "module",
  ModulePermissionPresentation,
  ModuleActionFlags
>;

export type NetworkPermissionListItem = PermissionListItemBase<
  "network",
  NetworkPermissionPresentation,
  NetworkActionFlags
>;

export type CodecPermissionListItem = PermissionListItemBase<
  "codec",
  CodecPermissionPresentation,
  CodecActionFlags
>;

export type UnknownPermissionListItem = PermissionListItemBase<
  PermissionType,
  UnknownPresentation,
  ActionFlags
>;

export type PermissionListItem =
  | DbPermissionListItem
  | FilePermissionListItem
  | NotificationPermissionListItem
  | ModulePermissionListItem
  | NetworkPermissionListItem
  | CodecPermissionListItem
  | UnknownPermissionListItem;

/* =========================================
 * Summary (exact keys from PermissionListSummary::toArray)
 * ========================================= */

export interface PermissionListSummaryDto {
  totals: {
    by_type: Record<string, number>;
    total: number;
    active: number;
    inactive: number;
  };
  required: {
    total: number;
    satisfied: number;
    pending: number;
  };
}

/* =========================================
 * Result (PermissionListResult::toArray)
 * ========================================= */

export interface PermissionListResultDto {
  items: PermissionListItem[];
  summary: PermissionListSummaryDto;
}