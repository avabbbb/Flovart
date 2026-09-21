/*
 * FlovartEffect.r — PiPL (Plug-in Property List) resource for the Flovart
 * scene-replace effect. Compiled into the .aex by the AE SDK build; kept
 * next to FlovartEffect.cpp so the plugin name/match-name live in one place.
 * Skeleton: not compiled on this machine (buildStatus "needs-native-sdk").
 */

#include "AEConfig.h"
#include "AE_Effect.h"
#include "AE_General.r"

resource 'PiPL' (16000) {
    {
        Kind { AE_Effect },
        Name { "Flovart Scene Replace" },
        Category { "Flovart" },
        AE_Effect_Version { 65536 /* 1.0.0 */ },
        AE_Effect_Match_Name { "FLOVART_SceneReplace" },
        AE_Effect_Info_Flags { 0 },
        AE_Effect_Global_OutFlags { 0x00000004 /* PIX_INDEPENDENT */ | 0x00020000 /* USE_OUTPUT_EXTENT */ },
        AE_Effect_Global_OutFlags_2 { 0x00000002 /* SUPPORTS_THREADED_RENDERING */ },
        AE_ImageInfo_Extension { 0 },
        AE_Effect_Support_URL { "https://flovart.local/support" },
        CodeWin64X86 { "EffectMain" }
    }
};
