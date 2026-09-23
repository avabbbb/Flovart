/*
 * FlovartEffect.cpp — fixed-footage scene replacement for After Effects.
 *
 * The host-owned "Asset Version" layer parameter pins an imported footage
 * layer in the AEP. Render checks that layer out at the current composition
 * time, blends it with the effect input, and checks it back in. This keeps
 * project media/relink behavior with After Effects and keeps the render path
 * local, synchronous, and independent of Flovart, Providers, and Agents.
 */

#include "AE_Effect.h"
#include "AE_EffectCB.h"
#include "AE_EffectCBSuites.h"
#include "AE_GeneralPlug.h"
#include "AE_Macros.h"
#include "Param_Utils.h"
#include "String_Utils.h"

#include <stdint.h>
#include <stddef.h>

#define FLOVART_EFFECT_NAME "Flovart Scene Replace"
#define FLOVART_BLEND_MAX 100

#if defined(_WIN32)
#define FLOVART_DLL_EXPORT __declspec(dllexport)
#elif defined(__APPLE__)
#define FLOVART_DLL_EXPORT __attribute__((visibility("default")))
#else
#error Unsupported platform for the Flovart After Effects effect
#endif

enum {
    FLOVART_INPUT = 0,
    FLOVART_PARAM_ASSET_VERSION,
    FLOVART_PARAM_BLEND,
    FLOVART_NUM_PARAMS
};

static PF_Err About(PF_OutData *out_data)
{
    AEFX_CLR_STRUCT(*out_data);
    PF_SPRINTF(out_data->return_msg,
               "%s v1.0\rBlends a project-pinned footage layer over the current frame.",
               FLOVART_EFFECT_NAME);
    return PF_Err_NONE;
}

static PF_Err GlobalSetup(PF_OutData *out_data)
{
    AEFX_CLR_STRUCT(*out_data);
    out_data->my_version = PF_VERSION(1, 0, 0, PF_Stage_DEVELOP, 1);
    out_data->out_flags = PF_OutFlag_PIX_INDEPENDENT;
    out_data->out_flags2 = PF_OutFlag2_NONE;
    return PF_Err_NONE;
}

static PF_Err ParamsSetup(PF_InData *in_data, PF_OutData *out_data)
{
    PF_ParamDef def;

    AEFX_CLR_STRUCT(def);
    PF_ADD_LAYER("Asset Version", PF_LayerDefault_NONE, FLOVART_PARAM_ASSET_VERSION);

    AEFX_CLR_STRUCT(def);
    PF_ADD_FLOAT_SLIDERX("Blend",
                         0, FLOVART_BLEND_MAX,
                         0, FLOVART_BLEND_MAX,
                         FLOVART_BLEND_MAX,
                         PF_Precision_HUNDREDTHS,
                         PF_ValueDisplayFlag_PERCENT,
                         0,
                         FLOVART_PARAM_BLEND);

    out_data->num_params = FLOVART_NUM_PARAMS;
    return PF_Err_NONE;
}

static double MapPixelCenter(A_long destination, double source_scale, A_long source_size)
{
    double mapped = ((double)destination + 0.5) * source_scale - 0.5;
    if (mapped < 0.0) mapped = 0.0;
    if (mapped > (double)(source_size - 1)) mapped = (double)(source_size - 1);
    return mapped;
}

static A_u_char MixChannel(A_u_char input, A_u_char asset, double blend)
{
    const double mixed = (double)input * (1.0 - blend) + (double)asset * blend;
    return (A_u_char)(mixed + 0.5);
}

static A_u_char InterpolateChannel(A_u_char top_left,
                                   A_u_char top_right,
                                   A_u_char bottom_left,
                                   A_u_char bottom_right,
                                   double x_fraction,
                                   double y_fraction)
{
    const double top = (double)top_left + ((double)top_right - (double)top_left) * x_fraction;
    const double bottom = (double)bottom_left + ((double)bottom_right - (double)bottom_left) * x_fraction;
    const double value = top + (bottom - top) * y_fraction;
    return (A_u_char)(value + 0.5);
}

static bool HasValidWorldLayout8(const PF_EffectWorld *world)
{
    if (!world || world->width <= 0 || world->height <= 0 || world->rowbytes <= 0) {
        return false;
    }

    const uint64_t minimum_rowbytes = (uint64_t)world->width * (uint64_t)sizeof(PF_Pixel8);
    const uint64_t max_size = (uint64_t)((size_t)-1);
    if (minimum_rowbytes > max_size || (uint64_t)world->rowbytes < minimum_rowbytes) {
        return false;
    }

    const uint64_t last_row_offset = (uint64_t)(world->height - 1) * (uint64_t)world->rowbytes;
    return last_row_offset <= max_size - minimum_rowbytes;
}

static PF_Pixel8 SampleBilinear(const PF_Pixel8 *pixels,
                                A_long rowbytes,
                                A_long width,
                                A_long height,
                                double x,
                                double y)
{
    const A_long x0 = (A_long)x;
    const A_long y0 = (A_long)y;
    const A_long x1 = x0 + (x0 + 1 < width ? 1 : 0);
    const A_long y1 = y0 + (y0 + 1 < height ? 1 : 0);
    const double x_fraction = x - (double)x0;
    const double y_fraction = y - (double)y0;
    const PF_Pixel8 *row0 = (const PF_Pixel8 *)((const char *)pixels + (size_t)y0 * (size_t)rowbytes);
    const PF_Pixel8 *row1 = (const PF_Pixel8 *)((const char *)pixels + (size_t)y1 * (size_t)rowbytes);
    const PF_Pixel8 top_left = row0[x0];
    const PF_Pixel8 top_right = row0[x1];
    const PF_Pixel8 bottom_left = row1[x0];
    const PF_Pixel8 bottom_right = row1[x1];
    PF_Pixel8 sampled;

    sampled.alpha = InterpolateChannel(top_left.alpha, top_right.alpha, bottom_left.alpha, bottom_right.alpha, x_fraction, y_fraction);
    sampled.red = InterpolateChannel(top_left.red, top_right.red, bottom_left.red, bottom_right.red, x_fraction, y_fraction);
    sampled.green = InterpolateChannel(top_left.green, top_right.green, bottom_left.green, bottom_right.green, x_fraction, y_fraction);
    sampled.blue = InterpolateChannel(top_left.blue, top_right.blue, bottom_left.blue, bottom_right.blue, x_fraction, y_fraction);
    return sampled;
}

static PF_Err Composite8(PF_EffectWorld *input,
                         PF_EffectWorld *asset,
                         PF_EffectWorld *output,
                         double blend)
{
    PF_Pixel8 *input_pixels = NULL;
    PF_Pixel8 *asset_pixels = NULL;
    PF_Pixel8 *output_pixels = NULL;

    if (!HasValidWorldLayout8(input)
        || !HasValidWorldLayout8(asset)
        || !HasValidWorldLayout8(output)) {
        return PF_Err_BAD_CALLBACK_PARAM;
    }

    PF_Err err = PF_GET_PIXEL_DATA8(input, NULL, &input_pixels);
    if (err) return err;
    err = PF_GET_PIXEL_DATA8(asset, NULL, &asset_pixels);
    if (err) return err;
    err = PF_GET_PIXEL_DATA8(output, NULL, &output_pixels);
    if (err) return err;

    if (!input_pixels || !asset_pixels || !output_pixels) {
        return PF_Err_BAD_CALLBACK_PARAM;
    }

    const A_Boolean input_matches_output = input->width == output->width && input->height == output->height;
    const A_Boolean asset_matches_output = asset->width == output->width && asset->height == output->height;
    const double input_scale_x = (double)input->width / (double)output->width;
    const double input_scale_y = (double)input->height / (double)output->height;
    const double asset_scale_x = (double)asset->width / (double)output->width;
    const double asset_scale_y = (double)asset->height / (double)output->height;
    for (A_long y = 0; y < output->height; ++y) {
        const double input_y = input_matches_output ? 0.0 : MapPixelCenter(y, input_scale_y, input->height);
        const double asset_y = asset_matches_output ? 0.0 : MapPixelCenter(y, asset_scale_y, asset->height);
        const PF_Pixel8 *input_row = input_matches_output
            ? (const PF_Pixel8 *)((const char *)input_pixels + (size_t)y * (size_t)input->rowbytes)
            : NULL;
        const PF_Pixel8 *asset_row = asset_matches_output
            ? (const PF_Pixel8 *)((const char *)asset_pixels + (size_t)y * (size_t)asset->rowbytes)
            : NULL;
        PF_Pixel8 *output_row = (PF_Pixel8 *)((char *)output_pixels + (size_t)y * (size_t)output->rowbytes);

        for (A_long x = 0; x < output->width; ++x) {
            const double input_x = input_matches_output ? 0.0 : MapPixelCenter(x, input_scale_x, input->width);
            const double asset_x = asset_matches_output ? 0.0 : MapPixelCenter(x, asset_scale_x, asset->width);
            const PF_Pixel8 source = input_matches_output
                ? input_row[x]
                : SampleBilinear(input_pixels, input->rowbytes, input->width, input->height, input_x, input_y);
            const PF_Pixel8 replacement = asset_matches_output
                ? asset_row[x]
                : SampleBilinear(asset_pixels, asset->rowbytes, asset->width, asset->height, asset_x, asset_y);
            PF_Pixel8 *destination = output_row + x;

            destination->alpha = MixChannel(source.alpha, replacement.alpha, blend);
            destination->red = MixChannel(source.red, replacement.red, blend);
            destination->green = MixChannel(source.green, replacement.green, blend);
            destination->blue = MixChannel(source.blue, replacement.blue, blend);
        }
    }

    return PF_Err_NONE;
}

static PF_Err Render(PF_InData *in_data,
                     PF_OutData *out_data,
                     PF_ParamDef *params[],
                     PF_LayerDef *output)
{
    PF_Err err = PF_Err_NONE;
    PF_ParamDef asset_checkout;
    AEFX_CLR_STRUCT(asset_checkout);

    if (!in_data || !out_data || !params
        || !params[FLOVART_INPUT]
        || !params[FLOVART_PARAM_ASSET_VERSION]
        || !params[FLOVART_PARAM_BLEND]
        || !output) {
        return PF_Err_BAD_CALLBACK_PARAM;
    }

    const double blend_value = params[FLOVART_PARAM_BLEND]->u.fs_d.value;
    if (blend_value != blend_value) {
        out_data->out_flags |= PF_OutFlag_DISPLAY_ERROR_MESSAGE;
        PF_SPRINTF(out_data->return_msg, "Flovart: Blend must be a valid number.");
        return PF_Err_BAD_CALLBACK_PARAM;
    }

    PF_EffectWorld *input = &params[FLOVART_INPUT]->u.ld;
    err = PF_CHECKOUT_PARAM(in_data,
                            FLOVART_PARAM_ASSET_VERSION,
                            in_data->current_time,
                            in_data->time_step,
                            in_data->time_scale,
                            &asset_checkout);
    if (err) {
        out_data->out_flags |= PF_OutFlag_DISPLAY_ERROR_MESSAGE;
        PF_SPRINTF(out_data->return_msg,
                   "Flovart: After Effects could not read the selected Asset Version layer.");
        return err;
    }

    PF_EffectWorld *asset = &asset_checkout.u.ld;
    const double blend = blend_value <= 0.0
        ? 0.0
        : blend_value >= FLOVART_BLEND_MAX
            ? 1.0
            : blend_value / (double)FLOVART_BLEND_MAX;

    const A_Boolean has_pixels = asset->width > 0
        && asset->height > 0;

    if (!has_pixels) {
        out_data->out_flags |= PF_OutFlag_DISPLAY_ERROR_MESSAGE;
        PF_SPRINTF(out_data->return_msg,
                   "Flovart: choose an imported footage layer in Asset Version.");
        err = PF_Err_BAD_CALLBACK_PARAM;
    } else {
        err = Composite8(input, asset, output, blend);
        if (err) {
            out_data->out_flags |= PF_OutFlag_DISPLAY_ERROR_MESSAGE;
            PF_SPRINTF(out_data->return_msg,
                       "Flovart: the selected footage could not be rendered as 8-bit pixels.");
        }
    }

    const PF_Err checkin_err = PF_CHECKIN_PARAM(in_data, &asset_checkout);
    return err ? err : checkin_err;
}

extern "C" FLOVART_DLL_EXPORT PF_Err EffectMain(
    PF_Cmd cmd,
    PF_InData *in_data,
    PF_OutData *out_data,
    PF_ParamDef *params[],
    PF_LayerDef *output,
    void *extra)
{
    switch (cmd) {
    case PF_Cmd_ABOUT:
        return About(out_data);
    case PF_Cmd_GLOBAL_SETUP:
        return GlobalSetup(out_data);
    case PF_Cmd_PARAMS_SETUP:
        return ParamsSetup(in_data, out_data);
    case PF_Cmd_RENDER:
        return Render(in_data, out_data, params, output);
    default:
        return PF_Err_NONE;
    }
}
