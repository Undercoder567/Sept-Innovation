// App.tsx - Root with Authentication
import React, { useState, useEffect } from "react";
import { ThemeProvider } from "./ThemeContent";
import Dashboard from "./pages/Dashboard";
import Login from "./pages/Login";
import { getAuthToken } from "./api/analytics";

const AppContent: React.FC = () => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isChecking, setIsChecking] = useState(true);

  useEffect(() => {
    const token = getAuthToken();
    setIsAuthenticated(!!token);
    setIsChecking(false);
  }, []);

  if (isChecking) {
    return <div className="app-loading">Loading...</div>;
  }

  if (!isAuthenticated) {
    return <Login onLoginSuccess={() => setIsAuthenticated(true)} />;
  }

  return <Dashboard />;
};

const App: React.FC = () => {
  return (
    <ThemeProvider>
      <AppContent />
    </ThemeProvider>
  );
};

export default App;
