"use client";

import { motion } from "framer-motion";
import { Box, PencilRuler, Users } from "lucide-react";
import { useMemo, useState } from "react";

import type { CustomMapEditorController } from "../hooks/useCustomMapEditor";
import CellToolPalette from "./CellToolPalette";
import CustomMapEditor from "./CustomMapEditor";
import DqnInferenceControls from "./DqnInferenceControls";
import type { CustomMapConfig, DynamicObstacle } from "./types";

type CustomMapPanelProps = {
  mapConfig: CustomMapConfig;
  editor: CustomMapEditorController;
  onRunInference: () => void;
  onLoadSampleMap: () => void;
  onResetMap: () => void;
  validationErrors: string[];
  requestError: string | null;
  isRunning: boolean;
  isEditMode: boolean;
  onEditModeChange: (value: boolean) => void;
};

export default function CustomMapPanel({
  mapConfig,
  editor,
  onRunInference,
  onLoadSampleMap,
  onResetMap,
  validationErrors,
  requestError,
  isRunning,
  isEditMode,
  onEditModeChange,
}: CustomMapPanelProps) {
  const [showCanvas, setShowCanvas] = useState(false);
  const canRun = validationErrors.length === 0 && !isRunning;
  const visibleErrors = useMemo(
    () => [...new Set([...validationErrors, ...(requestError ? [requestError] : [])])],
    [requestError, validationErrors],
  );

  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: "easeOut" }}
      className="pointer-events-auto w-full rounded-2xl border border-white/8 bg-[#1c2128]"
    >
      <div className="border-b border-white/8 px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <PencilRuler className="h-4 w-4 text-[#93c5fd]" />
              <p className="text-sm font-medium text-[#f4f4f5]">Custom map</p>
            </div>
            <p className="mt-1 text-xs leading-5 text-[#c1c1c9]">Edit in 3D. Use the 2D grid only for cleanup.</p>
          </div>
          <button
            type="button"
            onClick={() => onEditModeChange(!isEditMode)}
            className={`rounded-xl border px-3 py-2 text-xs transition ${
              isEditMode
                ? "border-white/16 bg-[#2b3340] text-[#f4f4f5]"
                : "border-white/8 bg-[#15191f] text-[#a1a1aa]"
            }`}
          >
            {isEditMode ? "Edit Mode" : "View Mode"}
          </button>
        </div>
      </div>

      <div className="space-y-4 px-4 py-3">
        <div className="grid gap-2 sm:grid-cols-2">
          <FieldSelect label="Rows" value={mapConfig.rows} onChange={editor.handleRowsChange} />
          <FieldSelect label="Cols" value={mapConfig.cols} onChange={editor.handleColsChange} />
        </div>

        <CellToolPalette selectedTool={editor.selectedTool} onToolChange={editor.setSelectedTool} />

        <div className="rounded-xl border border-white/8 bg-[#232933] px-3 py-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-[#f59e0b]" />
                <p className="text-xs font-medium text-[#f4f4f5]">Dynamic obstacles</p>
              </div>
              <p className="mt-1 text-xs leading-5 text-[#a1a1aa]">Add a mover, then draw its path on the scene.</p>
            </div>
            <button
              type="button"
              onClick={editor.handleAddDynamicObstacle}
              className="rounded-xl border border-white/8 bg-[#161a20] px-3 py-2 text-xs text-[#f4f4f5]"
            >
              Add
            </button>
          </div>

          {mapConfig.dynamic_obstacles.length > 0 ? (
            <>
              <div className="mt-3 flex flex-wrap gap-2">
                {mapConfig.dynamic_obstacles.map((obstacle) => {
                  const isActive = obstacle.id === editor.activeDynamicObstacleId;
                  return (
                    <button
                      key={obstacle.id}
                      type="button"
                      onClick={() => {
                        editor.setSelectedDynamicObstacleId(obstacle.id);
                        editor.setEditorMessage(null);
                      }}
                      className={`rounded-xl border px-3 py-1.5 text-xs transition ${
                        isActive
                          ? "border-white/16 bg-[#161a20] text-[#f4f4f5]"
                          : "border-white/8 bg-[#161a20] text-[#a1a1aa]"
                      }`}
                    >
                      {obstacle.label ?? obstacle.id}
                    </button>
                  );
                })}
              </div>

              {editor.activeDynamicObstacle && (
                <>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <FieldInput
                      label="Name"
                      value={editor.activeDynamicObstacle.label ?? ""}
                      onChange={editor.handleDynamicLabelChange}
                    />
                    <FieldSelectText
                      label="Kind"
                      value={editor.activeDynamicObstacle.kind ?? "person"}
                      options={["person", "cart", "blocker"]}
                      onChange={(value) => editor.handleDynamicKindChange(value as NonNullable<DynamicObstacle["kind"]>)}
                    />
                    <FieldSelectText
                      label="Speed"
                      value={String(editor.activeDynamicObstacle.speed)}
                      options={["1", "2", "3"]}
                      onChange={(value) => {
                        editor.updateSelectedDynamicObstacle((obstacle) => ({
                          ...obstacle,
                          speed: Number(value),
                        }));
                      }}
                    />
                    <label className="rounded-xl border border-white/8 bg-[#161a20] px-3 py-2 text-xs text-[#a1a1aa]">
                      <span>Color</span>
                      <input
                        type="color"
                        value={editor.activeDynamicObstacle.color ?? "#ef4444"}
                        onChange={(event) => {
                          editor.updateSelectedDynamicObstacle((obstacle) => ({
                            ...obstacle,
                            color: event.target.value,
                          }));
                        }}
                        className="mt-2 h-9 w-full rounded-lg border border-white/8 bg-transparent"
                      />
                    </label>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={editor.handleClearSelectedPath}
                      className="rounded-xl border border-white/8 bg-[#161a20] px-3 py-2 text-xs text-[#a1a1aa]"
                    >
                      Clear path
                    </button>
                    <button
                      type="button"
                      onClick={editor.handleRemoveSelectedObstacle}
                      className="rounded-xl border border-white/8 bg-[#161a20] px-3 py-2 text-xs text-[#f4f4f5]"
                    >
                      Remove
                    </button>
                  </div>
                </>
              )}
            </>
          ) : (
            <p className="mt-3 text-xs leading-5 text-[#a1a1aa]">
              Add a dynamic obstacle and draw at least two connected path cells.
            </p>
          )}
        </div>

        <div className="rounded-xl border border-white/8 bg-[#15191f]">
          <button
            type="button"
            onClick={() => setShowCanvas((previous) => !previous)}
            className="flex w-full items-center justify-between px-3 py-3 text-left text-xs text-[#c1c1c9]"
          >
            <span className="flex items-center gap-2">
              <Box className="h-3.5 w-3.5" />
              2D map canvas
            </span>
            <span>{showCanvas ? "Hide" : "Show"}</span>
          </button>

          {showCanvas && (
            <div className="border-t border-white/8 px-3 pb-3">
              <CustomMapEditor
                mapConfig={mapConfig}
                selectedTool={editor.selectedTool}
                activeDynamicObstacleId={editor.activeDynamicObstacleId}
                onCellSelect={editor.applyCellTool}
              />
            </div>
          )}
        </div>

        {editor.editorMessage && (
          <div className="rounded-xl border border-white/8 bg-[#2b2115] px-3 py-2 text-xs text-[#f4f4f5]">
            {editor.editorMessage}
          </div>
        )}

        {visibleErrors.length > 0 && (
          <div className="rounded-xl border border-white/8 bg-[#2b191b] px-3 py-2 text-xs text-[#f4f4f5]">
            {visibleErrors.map((error) => (
              <p key={error} className="leading-5">
                {error}
              </p>
            ))}
          </div>
        )}

        <DqnInferenceControls
          isRunning={isRunning}
          canRun={canRun}
          onRun={onRunInference}
          onLoadSample={onLoadSampleMap}
          onReset={onResetMap}
        />
      </div>
    </motion.section>
  );
}

function FieldSelect({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="rounded-xl border border-white/8 bg-[#15191f] px-3 py-2 text-xs text-[#a1a1aa]">
      <span>{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="mt-2 w-full rounded-lg border border-white/8 bg-[#161a20] px-2.5 py-2 text-sm text-[#f4f4f5] outline-none"
      >
        {Array.from({ length: 13 }, (_, index) => index + 8).map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

function FieldInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="rounded-xl border border-white/8 bg-[#161a20] px-3 py-2 text-xs text-[#a1a1aa]">
      <span>{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-2 w-full rounded-lg border border-white/8 bg-[#111418] px-2.5 py-2 text-sm text-[#f4f4f5] outline-none"
      />
    </label>
  );
}

function FieldSelectText({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="rounded-xl border border-white/8 bg-[#161a20] px-3 py-2 text-xs text-[#a1a1aa]">
      <span>{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-2 w-full rounded-lg border border-white/8 bg-[#111418] px-2.5 py-2 text-sm text-[#f4f4f5] outline-none"
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}
