// src/context/UserContext.js
import { createContext, useContext, useEffect, useState } from 'react';

const UserContext = createContext();

export function UserProvider({ children }) {
  const [user, setUserState] = useState(undefined); // undefined = loading
  const [viewAsCoach, setViewAsCoach] = useState(true);

  const setUser = (userData) => {
    setViewAsCoach(userData?.role === 'admin');
    if (userData) {
      localStorage.setItem('user', JSON.stringify(userData));
    } else {
      localStorage.removeItem('user');
    }
    setUserState(userData);
  };

  useEffect(() => {
    const storedUser = localStorage.getItem('user');
    if (storedUser) {
      setUserState(JSON.parse(storedUser));
    } else {
      setUserState(null);
    }
  }, []);

  const effectiveUser = user?.role === 'admin' && viewAsCoach
    ? { ...user, role: 'coach' }
    : user;

  return (
    <UserContext.Provider value={{
      user: effectiveUser,
      accountUser: user,
      setUser,
      viewAsCoach,
      setViewAsCoach,
    }}>
      {children}
    </UserContext.Provider>
  );
}

export function useUser() {
  return useContext(UserContext);
}
