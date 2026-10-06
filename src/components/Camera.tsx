"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { captureFrame, prepareForUpload } from "@/lib/client/photo";

export type CameraPurpose = "wide" | "found";

type LiveState =
  | { kind: "starting" }
  | { kind: "live" }
  | { kind: "unavailable"; reason: CameraProblem };

export type CameraProblem = "native" | "insecure" | "unsupported" | "denied" | "no_camera" | "busy" | "failed";

const COPY: Record<CameraPurpose, { kicker: string; line: string; shutter: string }> = {
  wide: { kicker: "Look around", line: "Take one photo of the place in front of you.", shutter: "Take the photo" },
  found: { kicker: "Show me", line: "Get close and take a photo of it.", shutter: "Take the photo" },
};

export const PROBLEM_COPY: Record<CameraProblem, string> = {
  native: "Using your phone's camera app.",
  insecure: "Live camera needs a secure connection, so we'll use your phone's camera app.",
  unsupported: "This browser can't show a live camera, so we'll use your phone's camera app.",
  denied: "Camera access was blocked. You can allow it in your browser settings, or use your phone's camera app.",
  no_camera: "No camera was found on this device. You can pick a photo instead.",
  busy: "Another app is using the camera. Close it and try again, or use your phone's camera app.",
  failed: "The camera didn't start. Use your phone's camera app instead.",
};

export function problemFrom(error: unknown): CameraProblem {
  const name = (error as { name?: string })?.name;
  if (name === "NotAllowedError" || name === "PermissionDeniedError" || name === "SecurityError") return "denied";
  if (name === "NotFoundError" || name === "DevicesNotFoundError" || name === "OverconstrainedError") return "no_camera";
  if (name === "NotReadableError" || name === "TrackStartError" || name === "AbortError") return "busy";
  return "failed";
}

type Props = {
  purpose: CameraPurpose;
  onCapture: (photo: Blob) => void;
  onCancel: () => void;
  native?: boolean;
};

export function Camera({ purpose, onCapture, onCancel, native = false }: Props) {
  const [forceFallback, setForceFallback] = useState(native);
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [live, setLive] = useState<LiveState>({ kind: "starting" });
  const [busy, setBusy] = useState(false);
  const statusId = useId();
  const copy = COPY[purpose];

  useEffect(() => {
    let cancelled = false;
    const stop = () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
    async function start() {
      if (forceFallback) return setLive({ kind: "unavailable", reason: "native" });
      if (!window.isSecureContext) return setLive({ kind: "unavailable", reason: "insecure" });
      if (!navigator.mediaDevices?.getUserMedia) return setLive({ kind: "unavailable", reason: "unsupported" });
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: "environment" }, width: { ideal: 3840 }, height: { ideal: 2160 } },
        });
        if (cancelled) return stream.getTracks().forEach((t) => t.stop());
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await Promise.resolve()
            .then(() => video.play())
            .catch(() => undefined);
        }
        setLive({ kind: "live" });
      } catch (e) {
        if (!cancelled) setLive({ kind: "unavailable", reason: problemFrom(e) });
      }
    }
    start();
    return () => {
      cancelled = true;
      stop();
    };
  }, [forceFallback]);

  const shoot = useCallback(async () => {
    const video = videoRef.current;
    if (!video || busy || !video.videoWidth) return;
    setBusy(true);
    try {
      const photo = await captureFrame(video);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      onCapture(photo);
    } catch {
      setLive({ kind: "unavailable", reason: "failed" });
    } finally {
      setBusy(false);
    }
  }, [busy, onCapture]);

  const onFile = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      setBusy(true);
      try {
        onCapture(await prepareForUpload(file));
      } catch {
        onCapture(file);
      } finally {
        setBusy(false);
      }
    },
    [onCapture],
  );

  return (
    <section className="camera" aria-labelledby={`${statusId}-title`}>
      <video
        ref={videoRef}
        className="camera-video"
        playsInline
        muted
        autoPlay
        aria-hidden="true"
        data-live={live.kind === "live" || undefined}
      />
      <div className="camera-guides" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
      </div>
      <header className="camera-copy">
        <p className="kicker" id={`${statusId}-title`}>
          {copy.kicker}
        </p>
        <p className="camera-line">{copy.line}</p>
      </header>
      <p className={live.kind === "unavailable" ? "camera-problem" : "sr-only"} role="status" id={statusId}>
        {live.kind === "starting" ? "Starting the camera." : live.kind === "live" ? "Camera ready." : PROBLEM_COPY[live.reason]}
      </p>
      <footer className="camera-controls">
        <button type="button" className="btn btn-quiet" onClick={onCancel}>
          Cancel
        </button>
        {live.kind === "live" ? (
          <button type="button" className="shutter" onClick={shoot} disabled={busy} aria-label={copy.shutter}>
            <span aria-hidden="true" />
          </button>
        ) : (
          <button
            type="button"
            className="shutter shutter-native"
            onClick={() => fileRef.current?.click()}
            disabled={busy || live.kind === "starting"}
            aria-label={live.kind === "unavailable" && live.reason === "no_camera" ? "Choose a photo" : "Open the camera"}
          >
            <span aria-hidden="true" />
          </button>
        )}
        {live.kind === "live" ? (
          <button type="button" className="btn btn-quiet camera-switch" onClick={() => setForceFallback(true)}>
            Use camera app
          </button>
        ) : (
          <span className="camera-spacer" aria-hidden="true" />
        )}
      </footer>
      <input
        ref={fileRef}
        className="sr-only"
        type="file"
        accept="image/*"
        capture="environment"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => onFile(e.currentTarget.files?.[0])}
      />
    </section>
  );
}
