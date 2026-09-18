/** Simple counting semaphore for upload / ffmpeg concurrency limits. */
export class Semaphore {
  private current = 0;
  private queue: (() => void)[] = [];

  constructor(private max: number) {}

  async acquire(): Promise<() => void> {
    if (this.current < this.max) {
      this.current += 1;
      return () => this.release();
    }
    await new Promise<void>((res) => this.queue.push(res));
    this.current += 1;
    return () => this.release();
  }

  tryAcquire(): (() => void) | null {
    if (this.current < this.max) {
      this.current += 1;
      return () => this.release();
    }
    return null;
  }

  private release(): void {
    this.current = Math.max(0, this.current - 1);
    const next = this.queue.shift();
    if (next) next();
  }

  get used(): number {
    return this.current;
  }
}
