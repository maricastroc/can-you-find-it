import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Camera, PROBLEM_COPY, problemFrom } from "./Camera";

function setCamera(getUserMedia: (() => Promise<MediaStream>) | undefined, secure = true) {
  Object.defineProperty(window, "isSecureContext", { value: secure, configurable: true });
  Object.defineProperty(navigator, "mediaDevices", { value: getUserMedia ? { getUserMedia: vi.fn(getUserMedia) } : undefined, configurable: true });
}

const domError = (name: string) => Object.assign(new Error(name), { name });

beforeEach(() => {
  Object.defineProperty(HTMLMediaElement.prototype, "play", { value: vi.fn(async () => undefined), configurable: true });
});
afterEach(() => cleanup());

describe("problemFrom", () => {
  it.each([
    ["NotAllowedError", "denied"],
    ["SecurityError", "denied"],
    ["NotFoundError", "no_camera"],
    ["OverconstrainedError", "no_camera"],
    ["NotReadableError", "busy"],
    ["SomethingElse", "failed"],
  ])("%s → %s", (name, problem) => {
    expect(problemFrom(domError(name))).toBe(problem);
  });
});

describe("Camera", () => {
  it("without a secure connection it uses the phone's camera app", async () => {
    setCamera(async () => new MediaStream(), false);
    render(<Camera purpose="wide" onCapture={vi.fn()} onCancel={vi.fn()} />);
    expect(await screen.findByText(PROBLEM_COPY.insecure)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open the camera" })).toBeEnabled();
    expect(navigator.mediaDevices!.getUserMedia).not.toHaveBeenCalled();
  });

  it("a blocked permission explains how to recover", async () => {
    setCamera(() => Promise.reject(domError("NotAllowedError")));
    render(<Camera purpose="wide" onCapture={vi.fn()} onCancel={vi.fn()} />);
    expect(await screen.findByText(PROBLEM_COPY.denied)).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(PROBLEM_COPY.denied);
  });

  it("no camera at all offers to choose a photo", async () => {
    setCamera(() => Promise.reject(domError("NotFoundError")));
    render(<Camera purpose="found" onCapture={vi.fn()} onCancel={vi.fn()} />);
    expect(await screen.findByRole("button", { name: "Choose a photo" })).toBeInTheDocument();
  });

  it("a live camera shows a shutter and stops the camera on unmount", async () => {
    const stop = vi.fn();
    const stream = { getTracks: () => [{ stop }] } as unknown as MediaStream;
    setCamera(async () => stream);
    const { unmount } = render(<Camera purpose="wide" onCapture={vi.fn()} onCancel={vi.fn()} />);
    expect(await screen.findByRole("button", { name: "Take the photo" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Camera ready.");
    unmount();
    expect(stop).toHaveBeenCalled();
  });

  it("the player can switch from the live camera to the camera app", async () => {
    const stop = vi.fn();
    setCamera(async () => ({ getTracks: () => [{ stop }] }) as unknown as MediaStream);
    render(<Camera purpose="wide" onCapture={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Use camera app" }));
    expect(await screen.findByRole("button", { name: "Open the camera" })).toBeInTheDocument();
    expect(stop).toHaveBeenCalled();
  });

  it("a picked file is handed over as the photo", async () => {
    setCamera(undefined);
    const onCapture = vi.fn();
    const { container } = render(<Camera purpose="wide" onCapture={onCapture} onCancel={vi.fn()} native />);
    const file = new File(["jpeg-bytes"], "p.jpg", { type: "image/jpeg" });
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
    });
    expect(onCapture).toHaveBeenCalledWith(file);
  });

  it("cancel is always available", async () => {
    setCamera(undefined);
    const onCancel = vi.fn();
    render(<Camera purpose="wide" onCapture={vi.fn()} onCancel={onCancel} native />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalled();
  });
});
