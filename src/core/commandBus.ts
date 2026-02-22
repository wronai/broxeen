/**
 * Command Bus - implements CQRS pattern for plugin communication
 */

import type { CommandBus as ICommandBus } from './types';

type CommandHandler<T = unknown> = (payload: T) => Promise<unknown>;

export class CommandBus implements ICommandBus {
  private handlers = new Map<string, CommandHandler>();

  register<T>(command: string, handler: CommandHandler<T>): void {
    if (this.handlers.has(command)) {
      throw new Error(`Command ${command} is already registered`);
    }
    
    this.handlers.set(command, handler as CommandHandler<unknown>);
    console.log(`Command registered: ${command}`);
  }

  unregister(command: string): void {
    if (!this.handlers.has(command)) {
      throw new Error(`Command ${command} not found`);
    }
    
    this.handlers.delete(command);
    console.log(`Command unregistered: ${command}`);
  }

  async execute<T>(command: string, payload?: T): Promise<unknown> {
    const handler = this.handlers.get(command);
    if (!handler) {
      throw new Error(`No handler registered for command: ${command}`);
    }
    
    try {
      return await handler(payload as T);
    } catch (error) {
      console.error(`Command ${command} execution failed:`, error);
      throw error;
    }
  }

  /**
   * Get all registered commands
   */
  getRegisteredCommands(): string[] {
    return Array.from(this.handlers.keys());
  }

  /**
   * Check if command is registered
   */
  has(command: string): boolean {
    return this.handlers.has(command);
  }

  /**
   * Clear all handlers
   */
  clear(): void {
    this.handlers.clear();
  }
}
