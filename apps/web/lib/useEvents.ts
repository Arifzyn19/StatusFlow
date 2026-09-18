'use client';
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';

export interface BusEvent {
  topic: string;
  data: Record<string, unknown>;
  at: string;
}

/** Subscribe to /api/events (SSE) and invalidate queries on change. */
export function useLiveEvents() {
  const qc = useQueryClient();
  useEffect(() => {
    const es = new EventSource('/api/events', { withCredentials: true });
    es.onmessage = (m) => {
      try {
        const evt = JSON.parse(m.data) as BusEvent;
        if (evt.topic.startsWith('account.')) {
          qc.invalidateQueries({ queryKey: ['accounts'] });
          qc.invalidateQueries({ queryKey: ['stats'] });
        }
        if (evt.topic.startsWith('upload.')) {
          qc.invalidateQueries({ queryKey: ['uploads'] });
          qc.invalidateQueries({ queryKey: ['stats'] });
          const id = (evt.data as { uploadId?: string }).uploadId;
          if (id) qc.invalidateQueries({ queryKey: ['upload', id] });
        }
      } catch {
        /* ignore malformed */
      }
    };
    es.onerror = () => {
      /* EventSource auto-retries */
    };
    return () => es.close();
  }, [qc]);
}
