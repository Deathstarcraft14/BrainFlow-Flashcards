import React, { useState, useEffect, ReactNode } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';

interface Props {
  children: ReactNode;
}

export function ErrorBoundary({ children }: Props) {
  const [hasError, setHasError] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const errorHandler = (event: ErrorEvent) => {
      setHasError(true);
      setError(event.error);
    };

    const rejectionHandler = (event: PromiseRejectionEvent) => {
      setHasError(true);
      setError(event.reason instanceof Error ? event.reason : new Error(String(event.reason)));
    };

    window.addEventListener('error', errorHandler);
    window.addEventListener('unhandledrejection', rejectionHandler);

    return () => {
      window.removeEventListener('error', errorHandler);
      window.removeEventListener('unhandledrejection', rejectionHandler);
    };
  }, []);

  const handleReset = () => {
    setHasError(false);
    setError(null);
    window.location.reload();
  };

  if (hasError) {
    let errorMessage = "An unexpected error occurred.";
    let isPermissionError = false;

    try {
      const errorData = JSON.parse(error?.message || '{}');
      if (errorData.error?.includes('Missing or insufficient permissions')) {
        isPermissionError = true;
        errorMessage = "You don't have permission to perform this action. Please make sure you're logged in with the correct account.";
      }
    } catch (e) {
      if (error?.message.includes('Missing or insufficient permissions')) {
        isPermissionError = true;
        errorMessage = "Permission denied. This usually happens if your session expired or you're trying to access data that doesn't belong to you.";
      }
    }

    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <Card className="max-w-md w-full border-red-100 shadow-lg">
          <CardHeader className="text-center pb-2">
            <div className="mx-auto w-12 h-12 rounded-full bg-red-100 flex items-center justify-center text-red-600 mb-4">
              <AlertCircle className="w-6 h-6" />
            </div>
            <CardTitle className="text-xl text-slate-900">
              {isPermissionError ? "Access Denied" : "Something went wrong"}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-center space-y-6">
            <p className="text-slate-600 text-sm leading-relaxed">
              {errorMessage}
            </p>
            <div className="pt-2">
              <Button 
                onClick={handleReset}
                className="w-full flex items-center justify-center gap-2"
              >
                <RefreshCw className="w-4 h-4" />
                Reload Application
              </Button>
            </div>
            {!isPermissionError && (
              <p className="text-[10px] text-slate-400 font-mono break-all">
                {error?.message}
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  return <>{children}</>;
}
