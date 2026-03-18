export interface Command {
  readonly type: string;
}

export type CommandHandler<TCommand extends Command = Command> = (
  command: TCommand
) => void | Promise<void>;

/**
 * Routes commands to their single registered handler.
 *
 * CQRS rule: a command expresses an INTENT to change state.
 *  - One command → one handler (not fan-out like events).
 *  - Handlers may throw to signal business rule violations.
 *  - Commands never return domain data — they either succeed or throw.
 */
export class CommandBus {
  private handlers = new Map<string, CommandHandler>();

  register<TCommand extends Command>(type: string, handler: CommandHandler<TCommand>): void {
    if (this.handlers.has(type)) {
      throw new Error(`Handler already registered for command type: ${type}`);
    }
    this.handlers.set(type, handler as CommandHandler);
  }

  async dispatch<TCommand extends Command>(command: TCommand): Promise<void> {
    const handler = this.handlers.get(command.type);
    if (!handler) {
      throw new Error(`No handler registered for command type: ${command.type}`);
    }
    await handler(command);
  }
}
