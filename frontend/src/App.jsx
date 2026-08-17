import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import Login from './pages/Login';
import Signup from './pages/Signup';
import Dashboard from './pages/Dashboard';

function RequireAuth({ children }) {
  const { user } = useAuth();
  // Note: this is a UX convenience only, not a security boundary — the real
  // enforcement happens server-side on every request via the auth middleware.
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

// Small always-visible build marker so a stale GitHub Pages deploy is
// obvious at a glance instead of needing devtools open. Safe to leave in
// production - it's just a version string, no sensitive info.
function BuildBadge() {
  return (
    <div
      style={{
        position: 'fixed',
        bottom: 4,
        right: 8,
        fontSize: 11,
        color: '#999',
        fontFamily: 'monospace',
        pointerEvents: 'none',
        zIndex: 9999
      }}
    >
      v{__APP_VERSION__} · {new Date(__BUILD_TIME__).toLocaleString()}
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter basename={import.meta.env.BASE_URL}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route
            path="/dashboard"
            element={
              <RequireAuth>
                <Dashboard />
              </RequireAuth>
            }
          />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </BrowserRouter>
      <BuildBadge />
    </AuthProvider>
  );
}
