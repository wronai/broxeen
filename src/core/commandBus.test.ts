/**
 * Command Bus Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CommandBus } from './commandBus';

describe('CommandBus', () => {
  let bus: CommandBus;

  beforeEach(() => {
    bus = new CommandBus();
  });

  afterEach(() => {
    bus.clear();
  });

  it('should register command handler', () => {
    const handler = async (payload: string) => `Result: ${payload}`;
    
    bus.register('test:command', handler);
    
    expect(bus.has('test:command')).toBe(true);
    expect(bus.getRegisteredCommands()).toContain('test:command');
  });

  it('should throw error when registering duplicate command', () => {
    const handler1 = async () => 'result1';
    const handler2 = async () => 'result2';
    
    bus.register('test:command', handler1);
    
    expect(() => bus.register('test:command', handler2)).toThrow(
      'Command test:command is already registered'
    );
  });

  it('should execute command successfully', async () => {
    const handler = async (payload: string) => `Processed: ${payload}`;
    
    bus.register('test:command', handler);
    
    const result = await bus.execute('test:command', 'test payload');
    
    expect(result).toBe('Processed: test payload');
  });

  it('should throw error when executing non-existent command', async () => {
    await expect(bus.execute('nonexistent:command')).rejects.toThrow(
      'No handler registered for command: nonexistent:command'
    );
  });

  it('should unregister command successfully', () => {
    const handler = async () => 'result';
    
    bus.register('test:command', handler);
    expect(bus.has('test:command')).toBe(true);
    
    bus.unregister('test:command');
    expect(bus.has('test:command')).toBe(false);
  });

  it('should throw error when unregistering non-existent command', () => {
    expect(() => bus.unregister('nonexistent:command')).toThrow(
      'Command nonexistent:command not found'
    );
  });

  it('should handle command execution errors', async () => {
    const errorHandler = async () => {
      throw new Error('Command execution failed');
    };
    
    bus.register('error:command', errorHandler);
    
    await expect(bus.execute('error:command')).rejects.toThrow('Command execution failed');
  });

  it('should clear all commands', () => {
    bus.register('command1', async () => 'result1');
    bus.register('command2', async () => 'result2');
    bus.register('command3', async () => 'result3');
    
    expect(bus.getRegisteredCommands()).toHaveLength(3);
    
    bus.clear();
    
    expect(bus.getRegisteredCommands()).toHaveLength(0);
  });

  it('should work with different payload types', async () => {
    interface TestPayload {
      message: string;
      count: number;
    }
    
    const handler = async (payload: TestPayload) => ({
      processed: true,
      message: payload.message.toUpperCase(),
      doubled: payload.count * 2,
    });
    
    bus.register('complex:command', handler);
    
    const result = await bus.execute('complex:command', {
      message: 'hello',
      count: 5,
    });
    
    expect(result).toEqual({
      processed: true,
      message: 'HELLO',
      doubled: 10,
    });
  });
});
