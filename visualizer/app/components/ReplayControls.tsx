"use client";

import { motion } from "framer-motion";
import {
  Camera,
  Layers3,
  MapPinned,
  Pause,
  Play,
  RefreshCw,
  Route,
  TimerReset,
  Users,
} from "lucide-react";
import type { ReactNode } from "react";

import type {
  CameraMode,
  PlaybackSpeed,
} from "./types";

type ReplayControlsProps = {
  cameraMode: CameraMode;
  onCameraModeChange: (mode: CameraMode) => void;
  showPath: boolean;
  onShowPathChange: (value: boolean) => void;
  showPenaltyZones: boolean;
  onShowPenaltyZonesChange: (value: boolean) => void;
  showDynamicObstacles: boolean;
  onShowDynamicObstaclesChange: (value: boolean) => void;
  hasDynamicObstacles: boolean;
  isPlaying: boolean;
  onPlayPause: () => void;
  onRestart: () => void;
  playbackSpeed: PlaybackSpeed;
  onPlaybackSpeedChange: (speed: PlaybackSpeed) => void;
  visualProgress: number;
  maxVisualProgress: number;
  currentStep: number;
  totalSteps: number;
  onSeek: (progress: number) => void;
};

const PLAYBACK_SPEEDS: PlaybackSpeed[] = [0.5, 1, 1.5, 2];

export default function ReplayControls({
  cameraMode,
  onCameraModeChange,
  showPath,
  onShowPathChange,
  showPenaltyZones,
  onShowPenaltyZonesChange,
  showDynamicObstacles,
  onShowDynamicObstaclesChange,
  hasDynamicObstacles,
  isPlaying,
  onPlayPause,
  onRestart,
  playbackSpeed,
  onPlaybackSpeedChange,
  visualProgress,
  maxVisualProgress,
  currentStep,
  totalSteps,
  onSeek,
}: ReplayControlsProps) {
  const sliderMax = Math.max(maxVisualProgress, 0);
  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, delay: 0.04, ease: "easeOut" }}
      className="pointer-events-auto w-full rounded-2xl border border-white/8 bg-[#1c2128]"
    >
      <div className="border-b border-white/8 px-4 py-3">
        <div className="flex items-center gap-2">
          <Play className="h-4 w-4 text-[#93c5fd]" />
          <p className="text-sm font-medium text-[#f4f4f5]">Replay</p>
        </div>
      </div>

      <div className="space-y-4 px-4 py-3">
        <div>
          <p className="mb-2 flex items-center gap-2 text-xs font-medium text-[#c1c1c9]">
            <TimerReset className="h-3.5 w-3.5" />
            Playback
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onPlayPause}
              className="flex items-center gap-2 rounded-xl border border-white/8 bg-[#232933] px-3 py-2 text-xs text-[#f4f4f5]"
            >
              {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
              {isPlaying ? "Pause" : "Play"}
            </button>
            <button
              type="button"
              onClick={onRestart}
              className="flex items-center gap-2 rounded-xl border border-white/8 bg-[#232933] px-3 py-2 text-xs text-[#f4f4f5]"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Restart
            </button>
            <div className="ml-auto flex items-center gap-1">
              {PLAYBACK_SPEEDS.map((speed) => (
                <button
                  key={speed}
                  type="button"
                  onClick={() => onPlaybackSpeedChange(speed)}
                  className={`rounded-lg border px-2 py-1 text-[11px] transition ${
                    playbackSpeed === speed
                      ? "border-white/16 bg-[#2b3340] text-[#f4f4f5]"
                      : "border-white/8 bg-[#232933] text-[#c1c1c9]"
                  }`}
                >
                  {speed}x
                </button>
              ))}
            </div>
          </div>

          <div className="mt-3">
            <input
              type="range"
              min={0}
              max={sliderMax}
              step={0.01}
              value={Math.min(visualProgress, sliderMax)}
              onChange={(event) => onSeek(Number(event.target.value))}
              className="h-1.5 w-full cursor-pointer accent-[#93c5fd]"
            />
            <div className="mt-1 flex items-center justify-between text-[11px] text-[#9b9ba5]">
              <span>Step {Math.min(currentStep, totalSteps)} / {totalSteps}</span>
              <span>{formatSegmentTime(visualProgress)} / {formatSegmentTime(maxVisualProgress)}</span>
            </div>
          </div>
        </div>

        <ControlSection label="View" icon={Camera}>
          <SegmentButton label="Orbit" isActive={cameraMode === "orbit"} onClick={() => onCameraModeChange("orbit")} />
          <SegmentButton label="Top" isActive={cameraMode === "top"} onClick={() => onCameraModeChange("top")} />
          <SegmentButton label="Follow" isActive={cameraMode === "follow"} onClick={() => onCameraModeChange("follow")} />
        </ControlSection>

        <ControlSection label="Layers" icon={Layers3}>
          <ToggleRow label="Route" value={showPath} onClick={() => onShowPathChange(!showPath)} icon={Route} />
          <ToggleRow label="Penalty" value={showPenaltyZones} onClick={() => onShowPenaltyZonesChange(!showPenaltyZones)} icon={MapPinned} />
          <ToggleRow
            label="Dynamic"
            value={showDynamicObstacles}
            onClick={() => onShowDynamicObstaclesChange(!showDynamicObstacles)}
            isDisabled={!hasDynamicObstacles}
            icon={Users}
          />
        </ControlSection>

      </div>
    </motion.section>
  );
}

function ControlSection({
  label,
  icon: Icon,
  children,
}: {
  label: string;
  icon: typeof Camera;
  children: ReactNode;
}) {
  return (
    <div>
      <p className="mb-2 flex items-center gap-2 text-xs font-medium text-[#c1c1c9]">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </p>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

function SegmentButton({
  label,
  isActive,
  onClick,
  isDisabled = false,
}: {
  label: string;
  isActive: boolean;
  onClick: () => void;
  isDisabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isDisabled}
      className={`rounded-xl border px-3 py-1.5 text-xs transition ${
        isDisabled
          ? "cursor-not-allowed border-white/6 bg-[#232933] text-[#9b9ba5]"
          : isActive
            ? "border-white/16 bg-[#2b3340] text-[#f4f4f5]"
            : "border-white/8 bg-[#232933] text-[#c1c1c9] hover:text-[#f4f4f5]"
      }`}
    >
      {label}
    </button>
  );
}

function ToggleRow({
  label,
  value,
  onClick,
  isDisabled = false,
  icon: Icon,
}: {
  label: string;
  value: boolean;
  onClick: () => void;
  isDisabled?: boolean;
  icon: typeof Route;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isDisabled}
      className={`flex w-full items-center justify-between rounded-xl border px-3 py-2 text-sm transition ${
        isDisabled
          ? "cursor-not-allowed border-white/6 bg-[#232933] text-[#9b9ba5]"
          : "border-white/8 bg-[#232933] text-[#f4f4f5]"
      }`}
    >
      <span className="flex items-center gap-2">
        <Icon className="h-3.5 w-3.5 text-[#a1a1aa]" />
        {label}
      </span>
      <span className={value ? "text-[#86efac]" : "text-[#71717a]"}>{value ? "On" : "Off"}</span>
    </button>
  );
}

function formatSegmentTime(segmentValue: number) {
  const seconds = Math.max(segmentValue, 0) * 0.42;
  const wholeSeconds = Math.floor(seconds);
  const remainder = Math.round((seconds - wholeSeconds) * 10);
  return `${wholeSeconds}.${remainder}s`;
}
