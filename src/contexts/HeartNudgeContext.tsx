'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

type HeartNudgeContextValue = {
  nudgeKey: number;
  nudge: () => void;
};

const HeartNudgeContext = createContext<HeartNudgeContextValue>({ nudgeKey: 0, nudge: () => {} });

export function HeartNudgeProvider({ children }: { children: ReactNode }) {
  const [nudgeKey, setNudgeKey] = useState(0);
  const nudge = useCallback(() => setNudgeKey((k) => k + 1), []);

  const value = useMemo(() => ({ nudgeKey, nudge }), [nudgeKey, nudge]);

  return <HeartNudgeContext.Provider value={value}>{children}</HeartNudgeContext.Provider>;
}

export function useHeartNudge() {
  return useContext(HeartNudgeContext);
}
