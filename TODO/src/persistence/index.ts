/**
 * @module persistence
 * @description Persistence layer barrel export.
 */

export { DatabaseManager, InMemoryDbAdapter, TauriSqliteAdapter } from "./database";
export type { DbAdapter } from "./database";

export { DeviceRepository } from "./deviceRepository";
export type {
  Device,
  DeviceType,
  DeviceService,
  ServiceProtocol,
  ContentSnapshot,
  ChangeRecord,
  ChangeType,
} from "./deviceRepository";

export { ChatRepository } from "./chatRepository";
export type {
  Conversation,
  ChatMessage,
  WatchRule,
} from "./chatRepository";
