import { useEffect, useState } from 'react';
import { useAuthStore } from '../stores/useAuthStore';

export function useAuth() {
  const { user, initialized, init } = useAuthStore();
  const [authOpen, setAuthOpen] = useState(false);

  useEffect(() => {
    if (!initialized) init();
  }, [initialized, init]);

  return {
    user,
    isLoggedIn: !!user,
    authOpen,
    setAuthOpen,
    requireAuth: (action?: () => void) => {
      if (user) {
        action?.();
      } else {
        setAuthOpen(true);
      }
    },
  };
}