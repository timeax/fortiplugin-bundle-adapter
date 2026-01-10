import { PermissionType } from "./decisions";

/** --- db --- */
export type DbPermissionActions = {
   select: boolean;
   insert: boolean;
   update: boolean;
   delete: boolean;
   truncate: boolean;
   grouped_queries: boolean;
}; // keys match DbUpsertDto::ACTIONS 6

export interface DbPermissionAttributes {
   model: string;
   readable_columns: string[] | null;
   writable_columns: string[] | null;
   permissions: DbPermissionActions;
} // 7

/** --- file --- */
export type FilePermissionActions = {
   read: boolean;
   write: boolean;
   append: boolean;
   delete: boolean;
   mkdir: boolean;
   rmdir: boolean;
   list: boolean;
}; // keys match FileUpsertDto::ACTIONS 8

export interface FilePermissionAttributes {
   base_dir: string;
   paths: string[];
   follow_symlinks: boolean;
   permissions: FilePermissionActions;
} // 9

/** --- notification --- */
export type NotificationPermissionActions = {
   send: boolean;
   receive: boolean;
}; // keys match NotificationUpsertDto::ACTIONS 10

export interface NotificationPermissionAttributes {
   channel: string;
   templates_allowed: string[] | null;
   recipients_allowed: string[] | null;
   permissions: NotificationPermissionActions;
} // 11

/** --- module --- */
export interface ModulePermissionAttributes {
   module: string;
   apis: string[];
   access: boolean;
} // 12

/** --- network --- */
export interface NetworkPermissionAttributes {
   hosts: string[];
   methods: string[];
   schemes: string[] | null;
   ports: number[] | null;
   paths: string[] | null;
   headers_allowed: string[] | null;
   ips_allowed: string[] | null;
   auth_via_host_secret: boolean;
   access: boolean;
   label: string | null;
} // 13

/** --- codec --- */
export interface CodecPermissionAttributes {
   module: string;
   allowed: string[];
   access: boolean;
} // 14

/** Convenience map + generic record wrapper (useful for UI) */
export type PermissionAttributesByType = {
   db: DbPermissionAttributes;
   file: FilePermissionAttributes;
   notification: NotificationPermissionAttributes;
   module: ModulePermissionAttributes;
   network: NetworkPermissionAttributes;
   codec: CodecPermissionAttributes;
};

export type PermissionUpsertRecord<T extends PermissionType = PermissionType> = {
   type: T;
   natural_key: string;
   attributes: PermissionAttributesByType[T];
};