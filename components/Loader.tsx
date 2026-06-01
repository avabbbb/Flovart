

import React from 'react';

interface LoaderProps {
    progressMessage: string;
}

export const Loader: React.FC<LoaderProps> = ({ progressMessage }) => {
    return (
        <div className="theme-aware absolute top-4 right-4 z-50 flex items-center space-x-2">
             <div className="isl-shell isl-pop-in flex h-10 w-auto items-center justify-center gap-3 px-4 py-2" style={{ borderRadius: 'var(--isl-r-pill)' }}>
                <svg className="animate-spin h-6 w-6" style={{ color: 'var(--isl-mint-deep)' }} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                <span className="text-sm font-bold" style={{ color: 'var(--isl-ink)' }}>{progressMessage || 'Generating...'}</span>
            </div>
        </div>
    );
};
