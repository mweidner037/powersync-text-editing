import { Outlet, createBrowserRouter, useNavigate } from 'react-router-dom';
import LoginPage from '@/app/auth/login/page';
import RegisterPage from '@/app/auth/register/page';
import EntryPage from '@/app/page';
import DocumentEditPage from '@/app/views/documents/edit/page';
import DocumentsPage from '@/app/views/documents/page';
import ViewsLayout from '@/app/views/layout';
import SQLConsolePage from '@/app/views/sql-console/page';
import { useSupabase } from '@/components/providers/SystemProvider';
import React from 'react';

export const DOCUMENTS_ROUTE = '/views/docs';
export const DOCUMENT_EDIT_ROUTE = '/views/docs/:id';
export const LOGIN_ROUTE = '/auth/login';
export const REGISTER_ROUTE = '/auth/register';
export const SQL_CONSOLE_ROUTE = '/sql-console';

interface AuthGuardProps {
  allowAnon?: boolean;
  children: JSX.Element;
}

const AuthGuard = ({ children, allowAnon }: AuthGuardProps) => {
  const connector = useSupabase();

  const navigate = useNavigate();
  React.useEffect(() => {
    if (!connector) {
      console.error(`No Supabase connector has been created yet.`);
      return;
    }

    connector.client.auth.onAuthStateChange(async (event, _session) => {
      if (event === 'SIGNED_OUT') {
        navigate(LOGIN_ROUTE);
      }
    });

    const loginGuard = () => {
      if (allowAnon) {
        if (!connector.currentSession) {
          void connector.anonLogin();
        }
      } else {
        if (!connector.isLoggedInAsUser()) {
          navigate(LOGIN_ROUTE);
        }
      }
    };
    if (connector.ready) {
      loginGuard();
    } else {
      const l = connector.registerListener({
        initialized: () => {
          loginGuard();
        }
      });
      return () => l?.();
    }
  }, [allowAnon]);
  return children;
};

/**
 * Navigate to this route after authentication
 */
export const DEFAULT_ENTRY_ROUTE = DOCUMENTS_ROUTE;

export const router = createBrowserRouter([
  {
    path: '/',
    element: <EntryPage />
  },
  {
    path: LOGIN_ROUTE,
    element: <LoginPage />
  },
  {
    path: REGISTER_ROUTE,
    element: <RegisterPage />
  },
  {
    element: (
      <ViewsLayout>
        <Outlet />
      </ViewsLayout>
    ),
    children: [
      {
        path: DOCUMENTS_ROUTE,
        element: (
          <AuthGuard>
            <DocumentsPage />
          </AuthGuard>
        )
      },
      {
        path: DOCUMENT_EDIT_ROUTE,
        element: (
          <AuthGuard allowAnon>
            <DocumentEditPage />
          </AuthGuard>
        )
      },
      {
        path: SQL_CONSOLE_ROUTE,
        element: (
          <AuthGuard>
            <SQLConsolePage />
          </AuthGuard>
        )
      }
    ]
  }
]);
