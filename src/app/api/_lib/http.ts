import { RoundError, type ErrorCode } from "@/lib/rounds/service";
import { ModelUnavailableError } from "@/lib/hunt/ollama";

const STATUS: Record<ErrorCode, number> = {
  bad_photo: 400,
  not_found: 404,
  wrong_state: 409,
  model_unavailable: 503,
  timeout: 504,
  internal: 500,
};

export function errorResponse(code: ErrorCode, message: string) {
  return Response.json({ error: { code, message } }, { status: STATUS[code] });
}

export function fromError(e: unknown) {
  if (e instanceof RoundError) return errorResponse(e.code, e.message);
  if (e instanceof ModelUnavailableError) return errorResponse("model_unavailable", e.message);
  if ((e as Error)?.name === "TimeoutError") return errorResponse("timeout", "The model took too long to answer.");
  console.error(e);
  return errorResponse("internal", "Something went wrong.");
}

/** 15 MB is far above a re-encoded phone photo but stops accidents. */
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

export async function readPhoto(request: Request): Promise<Buffer | Response> {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_UPLOAD_BYTES) return errorResponse("bad_photo", "That photo is too large.");
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return errorResponse("bad_photo", "Send the photo as multipart/form-data in a field named 'photo'.");
  }
  const file = form.get("photo");
  if (!(file instanceof Blob) || file.size === 0) return errorResponse("bad_photo", "No photo was sent.");
  if (file.size > MAX_UPLOAD_BYTES) return errorResponse("bad_photo", "That photo is too large.");
  return Buffer.from(await file.arrayBuffer());
}
