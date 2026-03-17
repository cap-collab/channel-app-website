'use client';

import { createContext, useContext } from 'react';
import { useSearchParams } from 'next/navigation';

// Isolate useSearchParams in its own component so that if it suspends,
// it doesn't unmount BroadcastClient (which holds all broadcast state).
// BroadcastClient reads the token from context instead of calling useSearchParams directly.

const SearchParamsContext = createContext<{ token: string | null }>({ token: null });

export function useToken() {
  return useContext(SearchParamsContext).token;
}

export function SearchParamsProvider({ children }: { children: React.ReactNode }) {
  const searchParams = useSearchParams();
  const token = searchParams.get('token');

  return (
    <SearchParamsContext.Provider value={{ token }}>
      {children}
    </SearchParamsContext.Provider>
  );
}
