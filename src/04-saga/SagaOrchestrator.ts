export type SagaStep = {
  name: string;
  execute: () => Promise<void> | void;
  compensate: () => Promise<void> | void;
};

export type SagaStatus = 'pending' | 'running' | 'completed' | 'compensating' | 'failed';

export interface SagaContext {
  sagaId: string;
  status: SagaStatus;
  completedSteps: string[];
  failedStep?: string;
  error?: string;
}

/**
 * Orchestration-style Saga coordinator.
 *
 * A Saga is a sequence of local transactions. If any step fails, the Saga
 * "compensates" by undoing all previously completed steps in REVERSE order.
 *
 * Compensation order is critical — LIFO (stack), not FIFO.
 * Example: StepA → StepB → StepC fails → undo C, undo B, undo A.
 *
 * This approach solves the distributed transaction problem without a 2PC
 * coordinator: each service makes a local, atomic change and publishes an event.
 * If anything goes wrong, compensation events trigger the rollback logic.
 *
 * Orchestration vs Choreography:
 *  - Orchestration (this file): a central coordinator knows every step.
 *    Simpler to reason about; single point of failure; harder to scale.
 *  - Choreography: each service reacts to events and produces the next one.
 *    No central brain; harder to trace; easier to scale horizontally.
 */
export class SagaOrchestrator {
  private context: SagaContext;
  private completedStepsStack: SagaStep[] = [];

  constructor(sagaId: string) {
    this.context = {
      sagaId,
      status: 'pending',
      completedSteps: [],
    };
  }

  async execute(steps: SagaStep[]): Promise<SagaContext> {
    this.context.status = 'running';

    for (const step of steps) {
      try {
        await step.execute();
        this.completedStepsStack.push(step);
        this.context.completedSteps.push(step.name);
      } catch (err) {
        this.context.failedStep = step.name;
        this.context.error = err instanceof Error ? err.message : String(err);
        await this.compensate();
        return this.context;
      }
    }

    this.context.status = 'completed';
    return this.context;
  }

  private async compensate(): Promise<void> {
    this.context.status = 'compensating';

    // LIFO — undo in reverse order of completion
    while (this.completedStepsStack.length > 0) {
      const step = this.completedStepsStack.pop()!;
      try {
        await step.compensate();
      } catch (err) {
        // Compensation itself failed — saga is in an inconsistent state.
        // In production: alert, page on-call, require manual intervention.
        this.context.error =
          `Compensation failed for step "${step.name}": ` +
          (err instanceof Error ? err.message : String(err));
        this.context.status = 'failed';
        return;
      }
    }

    this.context.status = 'failed';
  }

  getContext(): SagaContext {
    return { ...this.context };
  }
}
