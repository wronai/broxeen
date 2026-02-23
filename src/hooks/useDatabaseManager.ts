/**
 * useDatabaseManager — extracts DatabaseManager from the PluginProvider's AppContext.
 * Returns null if not available (e.g. during loading or in tests).
 */

import { createContext, useContext } from 'react';
import type { DatabaseManager } from '../persistence/databaseManager';

export const DatabaseManagerContext = createContext<DatabaseManager | null>(null);

export function useDatabaseManager(): DatabaseManager | null {
  return useContext(DatabaseManagerContext);
}
