/**
 * @module core/commandBus
 * @description Generic command bus for CQRS write-side operations.
 *
 * Replaces direct command instantiation with a dispatch pattern.
 * Commands are decoupled from handlers — new commands don't modify the bus.
 *
 * Integrates with existing Broxeen commands (browseCommand, sendMessageCommand, etc.)
 * while enabling plugin-registered commands.
 */

import type { ICommand, ICommandBus, ICommandHandler } from "./plugin.types";

// ─── Middleware ──────────────────────────────────────────────

export type CommandMiddleware = (
  command: ICommand<unknown>,
  next: () => Promise<unknown>,
) => Promise<unknown>;

// ─── Implementation ─────────────────────────────────────────

export class CommandBus implements ICommandBus {
  private handlers = new Map<string, ICommandHandler<ICommand<unknown>, unknown>>();
  private middlewares: CommandMiddleware[] = [];

  /**
   * Register a handler for a command type.
   * One handler per command type (SRP).
   */
  register<TCommand extends ICommand<TResult>, TResult>(
    commandType: string,
    handler: ICommandHandler<TCommand, TResult>,
  ): void {
    if (this.handlers.has(commandType)) {
      throw new Error(
        `Handler already registered for command "${commandType}". ` +
        `Each command type must have exactly one handler.`,
      );
    }
    this.handlers.set(
      commandType,
      handler as ICommandHandler<ICommand<unknown>, unknown>,
    );
  }

  /**
   * Unregister a handler (useful for plugin cleanup).
   */
  unregister(commandType: string): void {
    this.handlers.delete(commandType);
  }

  /**
   * Add middleware that wraps every dispatch (logging, auth, metrics, etc.)
   */
  use(middleware: CommandMiddleware): void {
    this.middlewares.push(middleware);
  }

  /**
   * Dispatch a command to its registered handler.
   * Runs through middleware chain first.
   */
  async dispatch<TResult>(command: ICommand<TResult>): Promise<TResult> {
    const handler = this.handlers.get(command.type);
    if (!handler) {
      throw new Error(
        `No handler registered for command "${command.type}". ` +
        `Available commands: ${Array.from(this.handlers.keys()).join(", ") || "none"}`,
      );
    }

    // Build middleware chain
    const execute = () => handler.execute(command) as Promise<TResult>;

    if (this.middlewares.length === 0) {
      return execute();
    }

    // Chain middlewares (last middleware calls execute)
    let index = 0;
    const chain = (): Promise<unknown> => {
      if (index < this.middlewares.length) {
        const mw = this.middlewares[index++];
        return mw(command, chain);
      }
      return execute();
    };

    return chain() as Promise<TResult>;
  }

  get registeredCommands(): string[] {
    return Array.from(this.handlers.keys());
  }
}

// ─── Built-in Middleware ─────────────────────────────────────

/** Logs every command dispatch (integrate with existing logger.ts) */
export function loggingMiddleware(
  log: (msg: string) => void,
): CommandMiddleware {
  return async (command, next) => {
    const start = performance.now();
    log(`[CommandBus] → ${command.type}`);
    try {
      const result = await next();
      const ms = (performance.now() - start).toFixed(1);
      log(`[CommandBus] ✓ ${command.type} (${ms}ms)`);
      return result;
    } catch (err) {
      const ms = (performance.now() - start).toFixed(1);
      log(`[CommandBus] ✗ ${command.type} (${ms}ms): ${err}`);
      throw err;
    }
  };
}

// ─── Command Definitions (for use across the app) ───────────

/**
 * Example: PluginQueryCommand — dispatches a query through the plugin system.
 * This replaces the direct browseCommand / sendMessageCommand pattern.
 */
export interface PluginQueryCommand extends ICommand<void> {
  readonly type: "plugin:query";
  readonly intent: string;
  readonly rawInput: string;
  readonly resolvedTarget?: string;
  readonly source: "voice" | "text" | "api";
}

export function createPluginQueryCommand(
  rawInput: string,
  intent: string,
  source: "voice" | "text" | "api" = "text",
  resolvedTarget?: string,
): PluginQueryCommand {
  return {
    type: "plugin:query",
    intent,
    rawInput,
    resolvedTarget,
    source,
  };
}
