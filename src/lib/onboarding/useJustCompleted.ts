'use client';
import { useEffect, useRef, useState } from 'react';

export function useJustCompleted(complete: boolean): boolean {
  const wasIncomplete = useRef(false);
  const [justCompleted, setJustCompleted] = useState(false);
  useEffect(() => {
    if (!complete) {
      wasIncomplete.current = true;
      setJustCompleted(false);
    } else if (wasIncomplete.current) {
      setJustCompleted(true);
    }
  }, [complete]);
  return justCompleted;
}
