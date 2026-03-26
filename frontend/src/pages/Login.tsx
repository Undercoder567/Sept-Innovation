import React, { useState } from "react";
import { Sun, Moon } from "lucide-react";
import { authenticate, setAuthToken } from "../api/analytics";
import { useTheme } from "../ThemeContent";
import "../styles/Login.css";

interface LoginProps {
  onLoginSuccess: () => void;
}

const Login: React.FC<LoginProps> = ({ onLoginSuccess }) => {
  const { theme, toggle } = useTheme();
  const dark = theme === "dark";
  const [userId, setUserId] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      if (!userId.trim() || !password.trim()) {
        throw new Error("Please enter both username and password");
      }

      const token = await authenticate(userId, password);
      setAuthToken(token);
      onLoginSuccess();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Login failed";
      setError(message);
      setPassword("");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-container">
      <div className="login-box">
        <div className="login-header">
          <button type="button" className="login-theme-toggle" onClick={toggle} title="Toggle theme">
            {dark ? <Sun size={14} /> : <Moon size={14} />}
            <span>{dark ? "Dark" : "Light"}</span>
          </button>
          <h1>Sept Innovation</h1>
          <p>Secure Analytics Platform</p>
        </div>

        <form onSubmit={handleSubmit} className="login-form">
          <div className="form-group">
            <label htmlFor="userId">Username</label>
            <input
              id="userId"
              type="text"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              placeholder="Enter your username"
              disabled={loading}
              autoFocus
            />
          </div>

          <div className="form-group">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
              disabled={loading}
            />
          </div>

          {error && <div className="error-message">{error}</div>}

          <button
            type="submit"
            disabled={loading}
            className="login-button"
          >
            {loading ? "Signing in..." : "Sign In"}
          </button>
        </form>

        <div className="login-footer">
          <p>Default credentials for testing:</p>
          <ul>
            <li><strong>admin</strong> / admin123</li>
            <li><strong>analyst</strong> / analyst123</li>
            <li><strong>user</strong> / user123</li>
          </ul>
        </div>
      </div>
    </div>
  );
};

export default Login;
