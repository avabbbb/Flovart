// R2 上传 API：预签名 → 前端直传 → confirm
import { api, HUB_BASE_URL } from './hubClient';

export interface PresignResult {
  key: string;
  putUrl: string;
  publicUrl: string;
  expiresAt: number;
}

export const uploadApi = {
  presign: (body: { filename: string; contentType: string; purpose: string }) =>
    api.post<PresignResult>(HUB_BASE_URL, '/uploads/presign', body),
  confirm: (key: string) =>
    api.post<{ key: string; url: string }>(HUB_BASE_URL, '/uploads/confirm', { key }),
};

// uploadFileToR2：拿到 presign 结果后用 fetch PUT 直传字节流到 R2
export async function uploadFileToR2(
  file: File | Blob,
  filename: string,
  contentType: string,
  purpose: string,
): Promise<{ key: string; publicUrl: string }> {
  const pre = await uploadApi.presign({ filename, contentType, purpose });
  const putRes = await fetch(pre.putUrl, {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    body: file,
  });
  if (!putRes.ok) {
    throw new Error(`上传到 R2 失败 (${putRes.status})`);
  }
  const confirmed = await uploadApi.confirm(pre.key);
  return { key: confirmed.key, publicUrl: confirmed.url || pre.publicUrl };
}