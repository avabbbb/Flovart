/*
 * FlovartEffect.cpp — Flovart scene-replace native effect, milestone-1 slice.
 *
 * Dataflow (docs/design/flovart-native-effects.md §4):
 *   pinned local asset file -> decode -> blend(intensity) -> current output frame
 *
 * Rules baked into this file:
 *   - the render path never touches the network, never waits on generation,
 *     and never depends on an agent, browser, or service being online;
 *   - the only file read is the pinned asset path stored in
 *     FLOVART_PARAM_ASSET_PATH;
 *   - a missing or undecoded asset passes the input frame through unchanged
 *     and raises PF_OutFlag_DISPLAY_ERROR_MESSAGE — never silent wrong output.
 *
 * This is a source skeleton. It targets the Adobe After Effects C++ Effect SDK
 * but has NOT been compiled here (no SDK/MSVC on the build machine;
 * asset-manifest.json reports buildStatus "needs-native-sdk"). Lines marked
 * SDK-VERIFY must be checked against the actual SDK headers during the
 * real-host gate in NATIVE_EFFECT.md.
 */

#include "AE_Effect.h"
#include "AE_EffectCB.h"
#include "AE_Macros.h"
#include "Param_Utils.h"
#include "AE_EffectCBSuites.h"
#include "String_Utils.h"
#include "AEFX_SuiteHandlerTemplate.h"
#include "AE_GeneralPlug.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define FLOVART_EFFECT_NAME       "Flovart Scene Replace"
#define FLOVART_ASSET_PATH_MAX    1024
#define FLOVART_BLEND_MAX          100 /* percent */

/*
 * Parameter layout — must stay in sync with asset-manifest.json.
 * FLOVART_INPUT is the layer the effect is applied to.
 */
enum {
    FLOVART_INPUT = 0,
    FLOVART_PARAM_ASSET_PATH,
    FLOVART_PARAM_BLEND,
    FLOVART_PARAM_VERSION,
    FLOVART_NUM_PARAMS
};

/* Decoded pinned-asset frame, filled by the locked decoder library. */
struct FlovartAsset {
    A_long          width;
    A_long          height;
    unsigned char  *pixels;   /* 8-bit BGRA/RGBA straight, decoder-owned */
};

/*
 * Pixel decode is intentionally NOT hand-rolled (main design §4.3: reuse a
 * mature library; OpenImageIO is the candidate). The library and pixel format
 * are locked during the real-SDK prototype; until then
 * FLOVART_HAS_ASSET_DECODER stays undefined and the effect reports the asset
 * as missing instead of drawing wrong pixels.
 */
#ifdef FLOVART_HAS_ASSET_DECODER
extern "C" A_Boolean FlovartDecodeFrame(const char *path, A_long frame, FlovartAsset *out);
#endif

static A_long CurrentFrame(PF_InData *in_data)
{
    /* Integer frames + rational fps per main design §4.3; time_step is the
     * per-frame duration in the effect's time units. */
    return in_data->current_time / in_data->time_step;
}

static bool LoadPinnedAssetFrame(const char *path, A_long frame, FlovartAsset *out)
{
    /* The ONLY file access in the render path: the pinned asset path stored
     * in the effect parameter. No URLs, no temp blobs, no service calls. */
    FILE *fp = fopen(path, "rb");
    if (!fp) return false;

#ifdef FLOVART_HAS_ASSET_DECODER
    fclose(fp);
    return FlovartDecodeFrame(path, frame, out) != FALSE;
#else
    /* Skeleton build: prove the file is readable, then report missing until
     * the decoder library is locked and compiled in. */
    unsigned char probe[16];
    size_t got = fread(probe, 1, sizeof(probe), fp);
    fclose(fp);
    (void)got; (void)frame; (void)out;
    return false;
#endif
}

static PF_Err ResolvePinnedAssetPath(PF_InData *in_data, PF_ParamDef *asset_param,
                                     char *out_path, A_long out_len)
{
    /* PATH params store a PF_PathID resolved through PathDataSuite.
     * SDK-VERIFY: exact suite name/version and PF_GetPathString signature
     * differ across SDK releases; PF_PathID_NONE means "not pinned yet". */
    if (asset_param->u.pd.path_id == PF_PathID_NONE) return PF_Err_BAD_CALLBACK_PARAM;

    AEFX_SuiteScoper<PF_PathDataSuite1> path_suite(in_data, kPFPathDataSuite, kPFPathDataSuiteVersion1);
    return path_suite->PF_GetPathString(in_data->effect_ref, asset_param->u.pd.path_id,
                                        FALSE, out_path, out_len);
}

static void CopyInputThrough(const PF_LayerDef *input, PF_LayerDef *output)
{
    const A_long w = output->extent_hint.right - output->extent_hint.left;
    const A_long h = output->extent_hint.bottom - output->extent_hint.top;

    for (A_long y = 0; y < h; ++y) {
        const PF_Pixel8 *src = (const PF_Pixel8 *)((const char *)input->data + (size_t)y * (size_t)input->rowbytes);
        PF_Pixel8 *dst = (PF_Pixel8 *)((char *)output->data + (size_t)y * (size_t)output->rowbytes);
        memcpy(dst, src, (size_t)w * sizeof(PF_Pixel8));
    }
}

/* output = input * (1 - mix) + asset * mix, per pixel, over the overlap. */
static void CompositeAsset8(const PF_LayerDef *input, const FlovartAsset *asset,
                            double mix, PF_LayerDef *output)
{
    const A_long w = output->extent_hint.right - output->extent_hint.left;
    const A_long h = output->extent_hint.bottom - output->extent_hint.top;
    const A_long keep = 256L - (A_long)(mix * 256.0);
    const A_long add  = (A_long)(mix * 256.0);

    for (A_long y = 0; y < h; ++y) {
        const PF_Pixel8 *src = (const PF_Pixel8 *)((const char *)input->data + (size_t)y * (size_t)input->rowbytes);
        PF_Pixel8 *dst = (PF_Pixel8 *)((char *)output->data + (size_t)y * (size_t)output->rowbytes);
        const unsigned char *arow = (y < asset->height)
            ? asset->pixels + (size_t)y * (size_t)asset->width * 4 : NULL;

        for (A_long x = 0; x < w; ++x) {
            if (!arow || x >= asset->width) { dst[x] = src[x]; continue; }
            const unsigned char *a = arow + (size_t)x * 4;
            dst[x].red   = (A_u_char)((src[x].red   * keep + a[0] * add) >> 8);
            dst[x].green = (A_u_char)((src[x].green * keep + a[1] * add) >> 8);
            dst[x].blue  = (A_u_char)((src[x].blue  * keep + a[2] * add) >> 8);
            dst[x].alpha = (A_u_char)((src[x].alpha * keep + a[3] * add) >> 8);
        }
    }
}

static PF_Err About(PF_InData *in_data, PF_OutData *out_data,
                    PF_ParamDef *params[], PF_LayerDef *output)
{
    AEFX_CLR_STRUCT(*out_data);
    PF_SPRINTF(out_data->return_msg,
               "%s v1.0\rPinned-asset scene replace. Renders a fixed local "
               "asset over the current frame; never generates or fetches.",
               FLOVART_EFFECT_NAME);
    return PF_Err_NONE;
}

static PF_Err GlobalSetup(PF_InData *in_data, PF_OutData *out_data,
                          PF_ParamDef *params[], PF_LayerDef *output)
{
    out_data->my_version = PF_VERSION(1, 0, 0, PF_Stage_DEVELOP, 1);
    /* Skeleton is 8-bit only; DEEP_COLOR_AWARE is a real-host gate item. */
    out_data->out_flags  = PF_OutFlag_PIX_INDEPENDENT | PF_OutFlag_USE_OUTPUT_EXTENT;
    out_data->out_flags2 = PF_OutFlag2_SUPPORTS_THREADED_RENDERING;
    return PF_Err_NONE;
}

static PF_Err ParamsSetup(PF_InData *in_data, PF_OutData *out_data,
                          PF_ParamDef *params[], PF_LayerDef *output)
{
    PF_Err      err = PF_Err_NONE;
    PF_ParamDef def;

    /* 1. Asset Path — pinned local media file this instance renders.
     * Persists with the project; cannot time-vary. The generation pipeline
     * writes the committed asset path here; the render path only reads it. */
    AEFX_CLR_STRUCT(def);
    def.param_type = PF_Param_PATH; /* SDK-VERIFY: PF_Param_PATH vs PF_ParamType_PATH */
    strcpy(def.name, "Asset Path");
    def.flags      = PF_ParamFlag_CANNOT_TIME_VARY | PF_ParamFlag_CANNOT_INTERP;
    def.uu.id      = FLOVART_PARAM_ASSET_PATH;
    def.u.pd.path_id = PF_PathID_NONE;
    err = PF_AddParam(in_data->effect_ref, -1, &def);
    if (err) return err;

    /* 2. Blend — mix intensity 0..100%, keyframable within the verified range. */
    AEFX_CLR_STRUCT(def);
    PF_ADD_FLOAT_SLIDERX("Blend",
                         0, FLOVART_BLEND_MAX,        /* valid min/max  */
                         0, FLOVART_BLEND_MAX,        /* slider min/max */
                         FLOVART_BLEND_MAX,           /* default 100%   */
                         PF_Precision_HUNDREDTHS,
                         0,                           /* display flags  */
                         0,                           /* param flags    */
                         FLOVART_PARAM_BLEND);
    if (err) return err;

    /* 3. Version — integer slot of the applied asset version (V1, V2, ...).
     * String/UUID version ids are deferred to the generation pipeline slice;
     * an integer is enough to prove project persistence + reopen. */
    AEFX_CLR_STRUCT(def);
    def.param_type        = PF_Param_SLIDER;
    strcpy(def.name, "Version");
    def.flags             = PF_ParamFlag_CANNOT_TIME_VARY | PF_ParamFlag_CANNOT_INTERP;
    def.uu.id             = FLOVART_PARAM_VERSION;
    def.u.sd.dephault     = 1;
    def.u.sd.valid_min    = 1;
    def.u.sd.slider_min   = 1;
    def.u.sd.valid_max    = 9999;
    def.u.sd.slider_max   = 9999;
    err = PF_AddParam(in_data->effect_ref, -1, &def);
    if (err) return err;

    out_data->num_params = FLOVART_NUM_PARAMS;
    return PF_Err_NONE;
}

static PF_Err Render(PF_InData *in_data, PF_OutData *out_data,
                     PF_ParamDef *params[], PF_LayerDef *output)
{
    const double mix = params[FLOVART_PARAM_BLEND]->u.fs_d.value / (double)FLOVART_BLEND_MAX;

    char path[FLOVART_ASSET_PATH_MAX];
    path[0] = '\0';
    const PF_Err path_err = ResolvePinnedAssetPath(in_data, params[FLOVART_PARAM_ASSET_PATH],
                                                   path, sizeof(path));

    FlovartAsset asset;
    AEFX_CLR_STRUCT(asset);
    const bool have_asset =
        (path_err == PF_Err_NONE) && LoadPinnedAssetFrame(path, CurrentFrame(in_data), &asset);

    if (!have_asset) {
        /* Missing/undecoded pinned asset: show the original frame and mark it
         * explicitly — never silently export wrong content (main design §3.3). */
        CopyInputThrough(&params[FLOVART_INPUT]->u.ld, output);
        out_data->out_flags |= PF_OutFlag_DISPLAY_ERROR_MESSAGE;
        PF_SPRINTF(out_data->return_msg,
                   "Flovart: pinned asset missing or not decoded yet.");
        return PF_Err_NONE;
    }

    CompositeAsset8(&params[FLOVART_INPUT]->u.ld, &asset, mix, output);
    return PF_Err_NONE;
}

extern "C" DllExport PF_Err EffectMain(
    PF_Cmd       cmd,
    PF_InData   *in_data,
    PF_OutData  *out_data,
    PF_ParamDef *params[],
    PF_LayerDef *output,
    void        *extra)
{
    PF_Err err = PF_Err_NONE;
    try {
        switch (cmd) {
        case PF_Cmd_ABOUT:        err = About(in_data, out_data, params, output);       break;
        case PF_Cmd_GLOBAL_SETUP: err = GlobalSetup(in_data, out_data, params, output); break;
        case PF_Cmd_PARAMS_SETUP: err = ParamsSetup(in_data, out_data, params, output); break;
        case PF_Cmd_RENDER:       err = Render(in_data, out_data, params, output);      break;
        default: break;
        }
    } catch (PF_Err &thrown) {
        err = thrown;
    }
    return err;
}
