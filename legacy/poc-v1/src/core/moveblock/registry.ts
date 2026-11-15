// Move_Primitive registry (Req 12.3, 12.9).
import { err, ok, type PrimitiveDescriptor, type Result } from './types';

export interface DuplicatePrimitiveError {
  kind: 'duplicate_primitive';
  name: string;
  message: string;
}

/** Read-only view handed to the parser, printer, and Move_Generator prompt builder. */
export interface RegistryView<T extends PrimitiveDescriptor = PrimitiveDescriptor> {
  get(name: string): T | undefined;
  has(name: string): boolean;
  /** All registered primitives in registration order. */
  list(): readonly T[];
}

/**
 * Generic over the entry type so the sim layer can store full primitives
 * (descriptor + `apply`) while core code only sees descriptors.
 */
export class PrimitiveRegistry<T extends PrimitiveDescriptor = PrimitiveDescriptor>
  implements RegistryView<T>
{
  readonly #entries = new Map<string, T>();

  /** Adds a primitive. A duplicate name is rejected and the existing entry is kept (Req 12.9). */
  register(primitive: T): Result<void, DuplicatePrimitiveError> {
    if (this.#entries.has(primitive.name)) {
      return err({
        kind: 'duplicate_primitive',
        name: primitive.name,
        message: `Move_Primitive "${primitive.name}" is already registered`,
      });
    }
    this.#entries.set(primitive.name, primitive);
    return ok(undefined);
  }

  get(name: string): T | undefined {
    return this.#entries.get(name);
  }

  has(name: string): boolean {
    return this.#entries.has(name);
  }

  /** Read at call time, so primitives registered later are included (Req 12.3). */
  list(): readonly T[] {
    return Object.freeze([...this.#entries.values()]);
  }
}
