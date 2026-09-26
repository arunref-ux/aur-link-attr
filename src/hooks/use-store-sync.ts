import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { subscribeStore } from "@/data/store";

/** Keeps every query fresh when the simulated backend mutates. */
export function useStoreSync() {
  const queryClient = useQueryClient();
  useEffect(() => {
    const unsubscribe = subscribeStore(() => {
      void queryClient.invalidateQueries();
    });
    return () => {
      unsubscribe();
    };
  }, [queryClient]);
}
