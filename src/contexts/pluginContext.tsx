/**
 * Plugin Context React Hook
 * Provides access to plugin system for React components
 */

import React, { useContext } from 'react';
import type { AppContext, PluginResult } from '../core/types';

interface PluginContextValue {
  context: AppContext | null;
  ask: (input: string, mode?: 'text' | 'voice') => Promise<PluginResult>;
  isInitialized: boolean;
}

export const PluginContext = React.createContext<PluginContextValue>({
  context: null,
  ask: async () => ({ status: 'error', content: [] }),
  isInitialized: false,
});

export const usePlugins = (): PluginContextValue => {
  const contextValue = useContext(PluginContext);
  
  if (!contextValue) {
    throw new Error('usePlugins must be used within PluginProvider');
  }

  return contextValue;
};

export const PluginProvider: React.FC<{
  context: AppContext;
  children: React.ReactNode;
}> = ({ context, children }) => {
  const ask = async (input: string, mode?: 'text' | 'voice'): Promise<PluginResult> => {
    if (!context) {
      return {
        status: 'error',
        content: [
          {
            type: 'text',
            data: 'Plugin system not initialized',
          }
        ],
      };
    }

    try {
      // Detect intent and route to appropriate plugin
      const intent = await context.intentRouter.detect(input);
      const plugin = context.intentRouter.route(intent.intent);
      
      if (!plugin) {
        throw new Error(`No plugin found for intent: ${intent.intent}`);
      }

      // Execute plugin
      const result = await plugin.execute(input, {
        isTauri: typeof window !== 'undefined' && !!(window as any).__TAURI__,
        tauriInvoke: (window as any).__TAURI__?.core?.invoke,
      } as import('../core/types').PluginContext);

      return result;
    } catch (error) {
      console.error('Plugin execution failed:', error);
      return {
        status: 'error',
        content: [
          {
            type: 'text',
            data: error instanceof Error ? error.message : String(error),
          }
        ],
      };
    }
  };

  const contextValue: PluginContextValue = {
    context,
    ask,
    isInitialized: !!context,
  };

  return (
    <PluginContext.Provider value={contextValue}>
      {children}
    </PluginContext.Provider>
  );
};
