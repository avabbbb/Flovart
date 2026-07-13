export function edgesPipeline(src, width, height, opts = {}) {
    const tHigh = opts.thresholdHigh ?? 0.7;
    const tLow = opts.thresholdLow ?? 0.4;
    const sigma = opts.blur ?? 1.4;
    const invert = opts.invert ?? true;
    const gray = toGray(src, width, height);
    const blurred = gaussianBlur(gray, width, height, sigma);
    const { mag, dir } = sobel(blurred, width, height);
    const suppressed = nonMaxSuppress(mag, dir, width, height);
    const out = doubleThreshold(suppressed, width, height, tHigh, tLow);
    // Convert back to RGBA, edge pixels = black, background = white (or inverse)
    const rgba = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < width * height; i++) {
        const edge = out[i];
        const v = invert ? (edge ? 0 : 255) : (edge ? 255 : 0);
        rgba[i * 4] = v;
        rgba[i * 4 + 1] = v;
        rgba[i * 4 + 2] = v;
        rgba[i * 4 + 3] = 255;
    }
    return rgba;
}
function toGray(rgba, w, h) {
    const g = new Float32Array(w * h);
    for (let i = 0, j = 0; i < g.length; i++, j += 4) {
        g[i] = 0.299 * rgba[j] + 0.587 * rgba[j + 1] + 0.114 * rgba[j + 2];
    }
    return g;
}
function gaussianBlur(gray, w, h, sigma) {
    const radius = Math.max(1, Math.round(sigma * 3));
    const kernel = new Float32Array(radius * 2 + 1);
    const sum = [0];
    for (let i = -radius; i <= radius; i++) {
        const v = Math.exp(-(i * i) / (2 * sigma * sigma));
        kernel[i + radius] = v;
        sum[0] += v;
    }
    for (let i = 0; i < kernel.length; i++)
        kernel[i] /= sum[0];
    const tmp = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            let acc = 0;
            for (let k = -radius; k <= radius; k++) {
                const sx = Math.min(w - 1, Math.max(0, x + k));
                acc += kernel[k + radius] * gray[y * w + sx];
            }
            tmp[y * w + x] = acc;
        }
    }
    const out = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            let acc = 0;
            for (let k = -radius; k <= radius; k++) {
                const sy = Math.min(h - 1, Math.max(0, y + k));
                acc += kernel[k + radius] * tmp[sy * w + x];
            }
            out[y * w + x] = acc;
        }
    }
    return out;
}
function sobel(gray, w, h) {
    const mag = new Float32Array(w * h);
    const dir = new Float32Array(w * h);
    const gx = new Float32Array(w * h);
    const gy = new Float32Array(w * h);
    for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
            const tl = gray[(y - 1) * w + x - 1];
            const tc = gray[(y - 1) * w + x];
            const tr = gray[(y - 1) * w + x + 1];
            const ml = gray[y * w + x - 1];
            const mr = gray[y * w + x + 1];
            const bl = gray[(y + 1) * w + x - 1];
            const bc = gray[(y + 1) * w + x];
            const br = gray[(y + 1) * w + x + 1];
            const sx = tr + 2 * mr + br - tl - 2 * ml - bl;
            const sy = tl + 2 * tc + tr - bl - 2 * bc - br;
            gx[y * w + x] = sx;
            gy[y * w + x] = sy;
            const m = Math.sqrt(sx * sx + sy * sy);
            mag[y * w + x] = m;
            dir[y * w + x] = Math.atan2(sy, sx);
        }
    }
    return { mag, dir, gx, gy };
}
/** Gradient direction quantized to 0/45/90/135 degrees → NMS along that line. */
function nonMaxSuppress(mag, dir, w, h) {
    const out = new Float32Array(w * h);
    for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
            const idx = y * w + x;
            const m = mag[idx];
            if (m === 0)
                continue;
            const a = Math.PI - dir[idx];
            const ang = a - Math.PI * Math.floor(a / Math.PI);
            let n1 = 0;
            let n2 = 0;
            if (ang < Math.PI / 8 || ang >= 7 * Math.PI / 8) {
                n1 = mag[idx - 1];
                n2 = mag[idx + 1];
            }
            else if (ang < 3 * Math.PI / 8) {
                n1 = mag[(y - 1) * w + x + 1];
                n2 = mag[(y + 1) * w + x - 1];
            }
            else if (ang < 5 * Math.PI / 8) {
                n1 = mag[(y - 1) * w + x];
                n2 = mag[(y + 1) * w + x];
            }
            else {
                n1 = mag[(y - 1) * w + x - 1];
                n2 = mag[(y + 1) * w + x + 1];
            }
            if (m >= n1 && m >= n2)
                out[idx] = m;
            else
                out[idx] = 0;
        }
    }
    return out;
}
function doubleThreshold(suppressed, w, h, tH, tL) {
    let max = 0;
    for (let i = 0; i < suppressed.length; i++)
        if (suppressed[i] > max)
            max = suppressed[i];
    if (max < 1)
        max = 1;
    const out = new Uint8Array(w * h);
    const strong = 255;
    const weak = 80;
    const highTh = max * tH;
    const lowTh = max * tL;
    for (let i = 0; i < suppressed.length; i++) {
        const v = suppressed[i];
        if (v >= highTh)
            out[i] = strong;
        else if (v >= lowTh)
            out[i] = weak;
        else
            out[i] = 0;
    }
    // hysteresis: promote weak → strong if 8-neighbor has strong
    for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
            const idx = y * w + x;
            if (out[idx] !== weak)
                continue;
            let promote = false;
            for (let dy = -1; dy <= 1 && !promote; dy++) {
                for (let dx = -1; dx <= 1 && !promote; dx++) {
                    if (dx === 0 && dy === 0)
                        continue;
                    if (out[(y + dy) * w + x + dx] === strong)
                        promote = true;
                }
            }
            if (promote)
                out[idx] = strong;
            else
                out[idx] = 0;
        }
    }
    return out;
}
