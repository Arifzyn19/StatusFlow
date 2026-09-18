/** Tiny in-process pub/sub for SSE fan-out. No Redis needed. */
type Handler = (data: unknown) => void;

export class EventBus {
  private topics = new Map<string, Set<Handler>>();
  private all = new Set<Handler>();

  onAll(h: Handler): () => void {
    this.all.add(h);
    return () => {
      this.all.delete(h);
    };
  }

  on(topic: string, h: Handler): () => void {
    let s = this.topics.get(topic);
    if (!s) {
      s = new Set();
      this.topics.set(topic, s);
    }
    s.add(h);
    return () => {
      s!.delete(h);
    };
  }

  emit(topic: string, data: unknown): void {
    const evt = { topic, data, at: new Date().toISOString() };
    this.all.forEach((h) => {
      try {
        h(evt);
      } catch {
        /* isolate listeners */
      }
    });
    this.topics.get(topic)?.forEach((h) => {
      try {
        h(evt);
      } catch {
        /* isolate */
      }
    });
  }
}

export const bus = new EventBus();
