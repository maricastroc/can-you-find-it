"use client";

import { useCallback, useEffect, useLayoutEffect, useReducer, useRef } from "react";
import { Camera } from "./Camera";
import { Landing } from "./screens/Landing";
import { Checking, Looking } from "./screens/Looking";
import { Hunt, Rest } from "./screens/Hunt";
import { Verdict } from "./screens/Verdict";
import { Reveal } from "./screens/Reveal";
import { ErrorScreen, Nothing } from "./screens/Messages";
import * as api from "@/lib/client/api";
import { initialState, reducer, type GameState, type Pending } from "@/lib/client/game";
import { savedRoundId, saveRoundId } from "@/lib/client/storage";
import type { Feedback, PublicRound } from "@/lib/rounds/types";

const POLL_MS = 3000;
export const NOTICE_MS = 7000;

function toneOf(state: GameState) {
  const name = state.screen.name;
  if (name === "camera" || name === "looking" || name === "checking") return "night";
  if (name === "hunt" && state.dimmed) return "night";
  return "paper";
}

export function Game({ nativeCamera = false }: { nativeCamera?: boolean }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const stateRef = useRef(state);
  useLayoutEffect(() => {
    stateRef.current = state;
  });

  useEffect(() => {
    const id = savedRoundId();
    if (!id) return;
    api
      .getRound(id)
      .then((round) => {
        if (round.status === "hunting" || round.status === "looking") dispatch({ type: "round", round });
        else saveRoundId(undefined);
      })
      .catch(() => saveRoundId(undefined));
  }, []);

  const status = state.round?.status;
  useEffect(() => {
    if (!state.roundId) return;
    if (!status || status === "looking" || status === "hunting") saveRoundId(state.roundId);
    else saveRoundId(undefined);
  }, [state.roundId, status]);

  const looking = state.screen.name === "looking" && state.roundId && (!status || status === "looking");
  useEffect(() => {
    if (!looking || !state.roundId) return;
    const id = state.roundId;
    const timer = setInterval(() => {
      api
        .getRound(id)
        .then((round) => round.status !== "looking" && dispatch({ type: "round", round }))
        .catch(() => undefined);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [looking, state.roundId]);

  useEffect(() => {
    if (!state.notice) return;
    const t = setTimeout(() => dispatch({ type: "dismiss_notice" }), NOTICE_MS);
    return () => clearTimeout(t);
  }, [state.notice]);

  useEffect(() => {
    if (status === "found") navigator.vibrate?.([24, 60, 24]);
  }, [status]);

  const begin = useCallback(() => {
    void api.warmUp();
    dispatch({ type: "begin" });
  }, []);

  const onWide = useCallback(async (photo: Blob) => {
    dispatch({ type: "wide_captured", preview: URL.createObjectURL(photo) });
    try {
      await api.startRound(photo, (e) => {
        if (e.type === "created") dispatch({ type: "created", id: e.id });
        else if (e.type === "progress") dispatch({ type: "progress", stage: e.stage, attempt: e.attempt });
        else if (e.type === "done") dispatch({ type: "round", round: e.round });
        else dispatch({ type: "failed", code: e.code, message: e.message, during: "look" });
      });
    } catch (e) {
      if (!stateRef.current.roundId) {
        const err = e as api.ApiError;
        dispatch({ type: "failed", code: err.code ?? "internal", message: err.message, during: "look" });
      }
    }
  }, []);

  const onFound = useCallback(async (photo: Blob) => {
    const id = stateRef.current.round?.id;
    if (!id) return;
    dispatch({ type: "found_captured", preview: URL.createObjectURL(photo) });
    try {
      const { verdict, round } = await api.checkFound(id, photo);
      dispatch({ type: "verdict", verdict, round });
    } catch (e) {
      const err = e as api.ApiError;
      dispatch({ type: "failed", code: err.code ?? "internal", message: err.message, during: "check" });
    }
  }, []);

  const act = useCallback(async (what: Pending, call: (id: string) => Promise<PublicRound>) => {
    const id = stateRef.current.round?.id;
    if (!id || stateRef.current.pending) return;
    dispatch({ type: "pending", what });
    try {
      dispatch({ type: "round", round: await call(id) });
    } catch (e) {
      const err = e as api.ApiError;
      if (err.code === "wrong_state") {
        const fresh = await api.getRound(id).catch(() => undefined);
        if (fresh) return dispatch({ type: "round", round: fresh });
      }
      dispatch({ type: "failed", code: err.code ?? "internal", message: err.message, during: "action" });
    }
  }, []);

  const onFeedback = useCallback(async (kind: Feedback["kind"], note?: string) => {
    const id = stateRef.current.round?.id;
    if (id) await api.sendFeedback(id, kind, note);
  }, []);

  const onForget = useCallback(async () => {
    const id = stateRef.current.round?.id;
    if (!id) return;
    await api.forgetRound(id);
    dispatch({ type: "home" });
  }, []);

  const rest = useCallback(() => dispatch({ type: "dim", on: true }), []);
  const hint = useCallback(() => act("hint", api.unlockHint), [act]);

  const retry = useCallback(() => {
    const s = stateRef.current.screen;
    if (s.name !== "error") return;
    if (s.retry === "check") return dispatch({ type: "open_found_camera" });
    if (s.retry === "resume" && stateRef.current.roundId) {
      return void api.getRound(stateRef.current.roundId).then((round) => dispatch({ type: "round", round }));
    }
    if (s.retry === "home") {
      saveRoundId(undefined);
      return dispatch({ type: "home" });
    }
    dispatch({ type: "again" });
  }, []);

  const { screen, round } = state;
  let view: React.ReactNode = null;
  switch (screen.name) {
    case "landing":
      view = <Landing onBegin={begin} />;
      break;
    case "camera":
      view = (
        <Camera
          native={nativeCamera}
          purpose={screen.purpose}
          onCapture={screen.purpose === "wide" ? onWide : onFound}
          onCancel={() => dispatch({ type: "camera_cancel" })}
        />
      );
      break;
    case "looking":
      view = <Looking photo={state.widePreview ?? round?.photoUrl} stage={screen.stage} attempt={screen.attempt} />;
      break;
    case "nothing":
      view = <Nothing onAgain={() => dispatch({ type: "again" })} />;
      break;
    case "hunt":
      view =
        round && state.dimmed ? (
          <Rest clue={round.clue ?? ""} onWake={() => dispatch({ type: "dim", on: false })} />
        ) : round ? (
          <Hunt
            round={round}
            pending={state.pending}
            notice={state.notice}
            onFound={() => dispatch({ type: "open_found_camera" })}
            onHint={hint}
            onGiveUp={() => act("reveal", api.revealRound)}
            onRest={rest}
          />
        ) : null;
      break;
    case "checking":
      view = <Checking photo={state.foundPreview} />;
      break;
    case "verdict":
      view = (
        <Verdict
          verdict={screen.verdict}
          hintsLeft={round?.hintsLeft ?? 0}
          pending={state.pending}
          notice={state.notice}
          onKeepLooking={() => dispatch({ type: "keep_looking" })}
          onHint={hint}
          onInsist={() => act("confirm", api.confirmFound)}
        />
      );
      break;
    case "ended":
      view = round ? (
        <Reveal round={round} foundPreview={state.foundPreview} onAgain={() => dispatch({ type: "again" })} onFeedback={onFeedback} onForget={onForget} />
      ) : null;
      break;
    case "error":
      view = <ErrorScreen code={screen.code} message={screen.message} retry={screen.retry} onRetry={retry} />;
      break;
  }

  return (
    <main className={`game tone-${toneOf(state)}`} data-screen={screen.name} data-dimmed={state.dimmed || undefined}>
      {view}
    </main>
  );
}
