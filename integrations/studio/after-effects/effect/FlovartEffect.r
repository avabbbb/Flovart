/*
 * FlovartEffect.r — PiPL (Plug-in Property List) resource for the Flovart
 * scene-replace effect. Compiled into the .aex by the AE SDK build; kept
 * next to FlovartEffect.cpp so the plugin name/match-name live in one place.
 * Windows builds use the PiPL preprocessing and resource flow from Adobe's
 * After Effects Plug-in SDK sample project.
 */

#include "AEConfig.h"
#include "AE_EffectVers.h"

#ifndef AE_OS_WIN
    #include "AE_General.r"
#endif

resource 'PiPL' (16000) {
    {
        Kind { AEEffect },
        Name { "Iris Scene Replace" },
        Category { "Iris" },
#ifdef AE_OS_WIN
    #if defined(AE_PROC_INTELx64)
        CodeWin64X86 { "EffectMain" },
    #elif defined(AE_PROC_ARM64)
        CodeWinARM64 { "EffectMain" },
    #endif
#elif defined(AE_OS_MAC)
        CodeMacIntel64 { "EffectMain" },
        CodeMacARM64 { "EffectMain" },
#endif
        AE_PiPL_Version { 2, 0 },
        AE_Effect_Spec_Version { PF_PLUG_IN_VERSION, PF_PLUG_IN_SUBVERS },
        AE_Effect_Version { 65536 /* 1.0.0 */ },
        AE_Effect_Info_Flags { 0 },
        AE_Effect_Global_OutFlags { 0x00000004 /* PIX_INDEPENDENT */ },
        AE_Effect_Global_OutFlags_2 { 0 /* no unverified MFR/thread-safety claim */ },
        AE_Effect_Match_Name { "FLOVART_SceneReplace" },
        AE_Reserved_Info { 0 },
        AE_Effect_Support_URL { "https://flovart.local/support" }
    }
};
