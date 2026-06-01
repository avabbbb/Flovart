export interface CompactChromeMetrics {
    viewportWidth: number;
    outerGap: number;
    sidebarWidth: number;
    toolbarLeftClosed: number;
    toolbarLeftOpen: number;
    toolbarScale: number;
    rightPanelDefaultWidth: number;
    rightPanelMinWidth: number;
    rightPanelWidthCap: number;
    rightPanelCollapsedWidth: number;
    promptMaxWidth: number;
    promptDockBottom: number;
    promptSideInset: number;
    canvasBottomInset: number;
    isTablet: boolean;
    isMobile: boolean;
}

export const getCompactChromeMetrics = (viewportWidth: number): CompactChromeMetrics => {
    if (viewportWidth <= 640) {
        const availablePanelWidth = Math.max(280, viewportWidth - 20);
        return {
            viewportWidth,
            outerGap: 10,
            sidebarWidth: availablePanelWidth,
            toolbarLeftClosed: 10,
            toolbarLeftOpen: 10,
            toolbarScale: 0.92,
            rightPanelDefaultWidth: availablePanelWidth,
            rightPanelMinWidth: Math.max(260, viewportWidth - 48),
            rightPanelWidthCap: availablePanelWidth,
            rightPanelCollapsedWidth: 0,
            promptMaxWidth: viewportWidth - 20,
            promptDockBottom: 10,
            promptSideInset: 10,
            canvasBottomInset: 86,
            isTablet: true,
            isMobile: true,
        };
    }

    if (viewportWidth <= 1024) {
        return {
            viewportWidth,
            outerGap: 12,
            sidebarWidth: Math.min(320, viewportWidth - 28),
            toolbarLeftClosed: 12,
            toolbarLeftOpen: 12,
            toolbarScale: 0.94,
            rightPanelDefaultWidth: Math.min(340, viewportWidth - 28),
            rightPanelMinWidth: Math.min(300, viewportWidth - 44),
            rightPanelWidthCap: Math.min(360, viewportWidth - 28),
            rightPanelCollapsedWidth: 0,
            promptMaxWidth: Math.min(760, viewportWidth - 24),
            promptDockBottom: 12,
            promptSideInset: 12,
            canvasBottomInset: 90,
            isTablet: true,
            isMobile: false,
        };
    }

    if (viewportWidth <= 1440) {
        return {
            viewportWidth,
            outerGap: 14,
            sidebarWidth: 264,
            toolbarLeftClosed: 14,
            toolbarLeftOpen: 286,
            toolbarScale: 0.88,
            rightPanelDefaultWidth: 320,
            rightPanelMinWidth: 296,
            rightPanelWidthCap: 440,
            rightPanelCollapsedWidth: 0,
            promptMaxWidth: 760,
            promptDockBottom: 14,
            promptSideInset: 20,
            canvasBottomInset: 92,
            isTablet: false,
            isMobile: false,
        };
    }

    return {
        viewportWidth,
        outerGap: 16,
        sidebarWidth: 256,
        toolbarLeftClosed: 16,
        toolbarLeftOpen: 276,
        toolbarScale: 0.8,
        rightPanelDefaultWidth: 304,
        rightPanelMinWidth: 280,
        rightPanelWidthCap: 400,
        rightPanelCollapsedWidth: 0,
        promptMaxWidth: 700,
        promptDockBottom: 16,
        promptSideInset: 18,
        canvasBottomInset: 88,
        isTablet: false,
        isMobile: false,
    };
};
