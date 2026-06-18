import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import App from './App';
import { AuthProvider } from './core/context/AuthContext';
import { ClipboardProvider } from './core/context/ClipboardContext';
import { SilverstarQueryProvider } from './shared/query/QueryProvider';
import './core/styles/app.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
    <AuthProvider>
      <SilverstarQueryProvider>
          <ClipboardProvider>
              <App />
              <Toaster
                position="bottom-right"
                toastOptions={{
                  duration: 3000,
                  style: { background: '#1a1a2e', color: '#e0e0e0', borderRadius: '8px' },
                }}
              />
          </ClipboardProvider>
      </SilverstarQueryProvider>
    </AuthProvider>
  </BrowserRouter>
);
