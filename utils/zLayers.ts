/**
 * Z-index layer constants — single source of truth for the stacking order.
 *
 * Layer map (ascending):
 *   resizeHandle  10   Panel resize drag handle
 *   dragIndicator 20   PromptBar file-drop overlay
 *   panel         30   RightPanel / LayerPanel floats
 *   toolbar       40   Toolbar menu bubbles
 *   sidebar       45   WorkspaceSidebar (fixed)
 *   promptDock    48   PromptBar outer dock (pointer-events-none)
 *   toolbarCrop   50   Toolbar crop submenu
 *   popover       80   PromptBar popovers (mode/model/more)
 *   configMenu    85   ConfigSelector dropdown (must beat popover)
 *   notification  9998 Success/error toast bar
 *   modal         9999 Full-screen modals (legal, batch, A/B compare)
 */

export const Z = {
    resizeHandle: 10,
    dragIndicator: 20,
    panel: 30,
    toolbar: 40,
    sidebar: 45,
    promptDock: 48,
    toolbarCrop: 50,
    popover: 80,
    configMenu: 85,
    notification: 9998,
    modal: 9999,
} as const;
