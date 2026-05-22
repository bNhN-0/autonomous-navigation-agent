"use client";

import { Html, Line, OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import type { MutableRefObject } from "react";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

import CustomMapPanel from "./CustomMapPanel";
import FloatingPanelToggle from "./FloatingPanelToggle";
import { sameCell, validateCustomMap } from "./customMapValidation";
import DeliveryAgent, { type DeliveryAgentFollowTarget } from "./DeliveryAgent";
import DynamicObstacles from "./DynamicObstacles";
import MetricsPanel from "./MetricsPanel";
import ReplayControls from "./ReplayControls";
import ScenarioSelector from "./ScenarioSelector";
import SceneToolbar from "./SceneToolbar";
import TrackGrid, { gridToWorld } from "./TrackGrid";
import { useCustomMapEditor } from "../hooks/useCustomMapEditor";
import type {
  CellTool,
  CameraMode,
  CustomMapConfig,
  DqnInferenceResponse,
  DqnRollout,
  DynamicObstacleTimelineFrame,
  GridPosition,
  MapLayout,
  MapSourceMode,
  MissionPath,
  MissionPhase,
  PlaybackSpeed,
  ScenarioData,
  ScenarioId,
  ScenarioOption,
} from "./types";
import { SCENARIOS } from "./types";

type LoadStatus = {
  state: "idle" | "loading" | "ready" | "error";
  message?: string;
};

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
const SEGMENT_DURATION_SECONDS = 0.42;

function fetchRequiredJson<T>(path: string) {
  return fetch(path, { cache: "no-store" }).then(async (response) => {
    if (!response.ok) {
      throw new Error(`Missing ${path}`);
    }

    return (await response.json()) as T;
  });
}

function formatScenarioError(scenario: ScenarioOption, error: unknown) {
  const fallback = `Required files for ${scenario.name} were not found under /public/scenarios/${scenario.id}/.`;

  if (error instanceof Error) {
    return `${fallback} ${error.message}`;
  }

  return fallback;
}

function createDefaultCustomMap(): CustomMapConfig {
  return {
    rows: 10,
    cols: 17,
    start: [0, 16],
    pickups: [[9, 0]],
    deliveries: [[1, 16]],
    pickup: [9, 0],
    delivery: [1, 16],
    obstacles: [
      [4, 13],
      [5, 13],
      [6, 7],
      [6, 8],
      [6, 9],
      [6, 10],
      [7, 7],
      [7, 8],
      [7, 9],
      [7, 10],
      [8, 1],
    ],
    penalty_zones: [
      {
        cell: [2, 14],
        penalty: -3,
        label: "Rough Zone",
        severity: "crowded",
        type: "crowded",
      },
      {
        cell: [4, 8],
        penalty: -3,
        label: "Rough Zone",
        severity: "crowded",
        type: "crowded",
      },
    ],
    dynamic_obstacles: [
      {
        id: "person-1",
        label: "Moving Person",
        kind: "person",
        path: [
          [6, 13],
          [7, 13],
          [8, 13],
          [9, 13],
          [8, 13],
          [7, 13],
        ],
        speed: 1,
      },
      {
        id: "person-2",
        label: "Moving Person",
        kind: "person",
        path: [
          [5, 0],
          [5, 1],
          [5, 2],
          [5, 3],
          [5, 4],
          [5, 5],
          [5, 6],
          [5, 5],
          [5, 4],
          [5, 3],
          [5, 2],
          [5, 1],
        ],
        speed: 1,
      },
    ],
  };
}

function createSampleCustomMap(): CustomMapConfig {
  return createDefaultCustomMap();
}

function createPreviewMap(mapConfig: CustomMapConfig): MapLayout {
  return {
    rows: mapConfig.rows,
    cols: mapConfig.cols,
    start: mapConfig.start ?? [-1, -1],
    pickups: mapConfig.pickups,
    deliveries: mapConfig.deliveries,
    pickup: mapConfig.pickup ?? [-1, -1],
    delivery: mapConfig.delivery ?? [-1, -1],
    obstacles: mapConfig.obstacles,
    penalty_zones: mapConfig.penalty_zones,
    dynamic_obstacles: mapConfig.dynamic_obstacles,
  };
}

function toInferencePayload(mapConfig: CustomMapConfig): Record<string, unknown> | null {
  if (!mapConfig.start || mapConfig.pickups.length === 0 || mapConfig.deliveries.length === 0) {
    return null;
  }

  return {
    rows: mapConfig.rows,
    cols: mapConfig.cols,
    start: mapConfig.start,
    pickups: mapConfig.pickups,
    deliveries: mapConfig.deliveries,
    pickup: mapConfig.pickup ?? mapConfig.pickups[0],
    delivery: mapConfig.delivery ?? mapConfig.deliveries[0],
    obstacles: mapConfig.obstacles,
    penalty_zones: mapConfig.penalty_zones.map((zone) => ({
      cell: zone.cell,
      penalty: zone.penalty,
      type: zone.severity,
      label: zone.label,
    })),
    dynamic_obstacles: mapConfig.dynamic_obstacles.map((obstacle) => ({
      id: obstacle.id,
      path: obstacle.path,
      speed: obstacle.speed,
      label: obstacle.label,
      kind: obstacle.kind,
      color: obstacle.color,
    })),
  };
}

function toInferencePayloadFromLayout(map: MapLayout): Record<string, unknown> {
  return {
    rows: map.rows,
    cols: map.cols,
    start: map.start,
    pickups: map.pickups,
    deliveries: map.deliveries,
    pickup: map.pickup,
    delivery: map.delivery,
    obstacles: map.obstacles,
    penalty_zones: (map.penalty_zones ?? []).map((zone) => ({
      cell: zone.cell,
      penalty: zone.penalty,
      type: zone.severity,
      label: zone.label,
    })),
    dynamic_obstacles: (map.dynamic_obstacles ?? []).map((obstacle) => ({
      id: obstacle.id,
      path: obstacle.path,
      speed: obstacle.speed,
      label: obstacle.label,
      kind: obstacle.kind,
      color: obstacle.color,
    })),
  };
}

function deriveMissionPhase(path: MissionPath | null, currentStep: number): MissionPhase {
  if (!path) {
    return "to_pickup";
  }

  const boundedStep = Math.min(currentStep, path.path.length - 1);
  const finalPickupStep = path.pickup_steps?.length
    ? path.pickup_steps[path.pickup_steps.length - 1]
    : path.pickup_step;
  const finalDeliveryStep = path.delivery_steps?.length
    ? path.delivery_steps[path.delivery_steps.length - 1]
    : path.delivery_step;

  if ((path.mission_complete ?? path.completed_delivery) && finalDeliveryStep >= 0 && boundedStep >= finalDeliveryStep) {
    return "complete";
  }

  const previousAction = boundedStep > 0 ? path.actions[boundedStep - 1] : null;
  if (
    previousAction === 4
    || (boundedStep > 0 && sameCell(path.path[boundedStep], path.path[boundedStep - 1]))
  ) {
    return "waiting";
  }

  if (path.reached_pickup && finalPickupStep >= 0 && boundedStep >= finalPickupStep) {
    return "delivering";
  }

  return "to_pickup";
}

function clampVisualProgress(path: MissionPath | null, value: number) {
  if (!path) {
    return 0;
  }

  return THREE.MathUtils.clamp(value, 0, Math.max(path.path.length - 1, 0));
}

function EmptyStage() {
  return (
    <>
      <color attach="background" args={["#161a1f"]} />
      <ambientLight intensity={1.05} />
      <hemisphereLight args={["#f4f4f5", "#313841", 0.92]} />
      <directionalLight position={[7, 10, 6]} intensity={1.15} color="#f4f4f5" />
      <directionalLight position={[-6, 8, -4]} intensity={0.6} color="#dbe5f2" />

      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.08, 0]}>
        <planeGeometry args={[24, 24]} />
        <meshStandardMaterial color="#2a3038" roughness={1} />
      </mesh>

      <OrbitControls enableDamping dampingFactor={0.08} maxPolarAngle={Math.PI / 2.1} />
    </>
  );
}

function FollowCameraRig({
  map,
  followTargetRef,
}: {
  map: MapLayout;
  followTargetRef: MutableRefObject<DeliveryAgentFollowTarget | null>;
}) {
  const { camera } = useThree();
  const desiredPosition = useRef(new THREE.Vector3());
  const lookAtTarget = useRef(new THREE.Vector3());
  const forwardVector = useRef(new THREE.Vector3());
  const span = Math.max(map.rows, map.cols);
  const backOffset = Math.max(3.7, span * 0.22);
  const upOffset = Math.max(2.5, span * 0.2);

  useFrame((_, delta) => {
    const followTarget = followTargetRef.current;

    if (!followTarget) {
      return;
    }

    forwardVector.current.set(0, 0, 1).applyQuaternion(followTarget.quaternion).normalize();

    desiredPosition.current
      .copy(followTarget.position)
      .addScaledVector(forwardVector.current, -backOffset);
    desiredPosition.current.y += upOffset;

    lookAtTarget.current
      .copy(followTarget.position)
      .addScaledVector(forwardVector.current, 1.25);
    lookAtTarget.current.y += 0.3;

    camera.position.lerp(desiredPosition.current, 1 - Math.exp(-delta * 4.5));
    camera.lookAt(lookAtTarget.current);
  });

  return null;
}

function buildPathSegments(path: MissionPath, map: MapLayout) {
  const finalPickupStep = path.pickup_steps?.length
    ? path.pickup_steps[path.pickup_steps.length - 1]
    : path.pickup_step;
  const pickupIndex = path.reached_pickup ? Math.max(finalPickupStep, 0) : path.path.length - 1;
  const beforePickupCells = path.path.slice(0, pickupIndex + 1);
  const afterPickupCells =
    path.reached_pickup && pickupIndex < path.path.length - 1
      ? path.path.slice(pickupIndex, path.path.length)
      : [];

  return {
    beforePickup: beforePickupCells.map((cell) => {
      const [x, y, z] = gridToWorld(cell, map.rows, map.cols);
      return [x, y + 0.12, z] as [number, number, number];
    }),
    afterPickup: afterPickupCells.map((cell) => {
      const [x, y, z] = gridToWorld(cell, map.rows, map.cols);
      return [x, y + 0.14, z] as [number, number, number];
    }),
  };
}

function buildPlannerSegments(path: DqnRollout, map: MapLayout) {
  const plannerToPickup = path.planner_path_to_pickup.map((cell) => {
    const [x, y, z] = gridToWorld(cell, map.rows, map.cols);
    return [x, y + 0.18, z] as [number, number, number];
  });
  const plannerToDelivery = path.planner_path_to_delivery.map((cell) => {
    const [x, y, z] = gridToWorld(cell, map.rows, map.cols);
    return [x, y + 0.2, z] as [number, number, number];
  });

  return {
    plannerToPickup,
    plannerToDelivery,
  };
}

function RouteLegend({
  map,
}: {
  map: MapLayout;
}) {
  const anchor = useMemo<[number, number, number]>(() => {
    const [x, y, z] = gridToWorld([0, 0], map.rows, map.cols);
    return [x, y + 1.3, z];
  }, [map]);

  return (
    <Html position={anchor} center distanceFactor={14} transform>
      <div className="rounded-lg border border-white/8 bg-[#242b34] px-2.5 py-2 text-[10px] text-[#f4f4f5]">
        <div className="flex items-center gap-2">
          <span className="h-0.5 w-5 bg-[#93c5fd]" />
          <span>Planner route</span>
        </div>
        <div className="mt-1 flex items-center gap-2">
          <span className="h-0.5 w-5 bg-[#86efac]" />
          <span>Executed route</span>
        </div>
      </div>
    </Html>
  );
}

function SceneStage({
  map,
  activePath,
  activeTimeline,
  showPath,
  showPenaltyZones,
  showDynamicObstacles,
  cameraMode,
  visualProgress,
  editorMode,
  selectedTool,
  activeDynamicObstacleId,
  onEditCell,
}: {
  map: MapLayout;
  activePath: MissionPath | null;
  activeTimeline: DynamicObstacleTimelineFrame[] | null;
  showPath: boolean;
  showPenaltyZones: boolean;
  showDynamicObstacles: boolean;
  cameraMode: CameraMode;
  visualProgress: number;
  editorMode: boolean;
  selectedTool?: CellTool;
  activeDynamicObstacleId?: string | null;
  onEditCell?: (cell: GridPosition) => void;
}) {
  const followTargetRef = useRef<DeliveryAgentFollowTarget | null>({
    position: new THREE.Vector3(),
    quaternion: new THREE.Quaternion(),
  });
  const span = Math.max(map.rows, map.cols);
  const pathSegments = useMemo(
    () => (activePath ? buildPathSegments(activePath, map) : null),
    [activePath, map],
  );
  const plannerSegments = useMemo(
    () => (
      activePath && "planner_path_to_pickup" in activePath
        ? buildPlannerSegments(activePath as DqnRollout, map)
        : null
    ),
    [activePath, map],
  );
  const agentPath = activePath?.path ?? [map.start];

  return (
    <>
      <color attach="background" args={["#161a1f"]} />
      <ambientLight intensity={1.05} />
      <hemisphereLight args={["#f4f4f5", "#343c45", 0.95]} />

      <directionalLight
        position={[7, 12, 6]}
        intensity={1.15}
        color="#f4f4f5"
      />
      <directionalLight position={[-8, 9, -6]} intensity={0.7} color="#dbe5f2" />
      <pointLight position={[span * 0.35, 4.5, -span * 0.25]} intensity={7.5} color="#f4f4f5" />

      <TrackGrid
        map={map}
        showPenaltyZones={showPenaltyZones}
        editorMode={editorMode}
        selectedTool={selectedTool}
        activeDynamicObstacleId={activeDynamicObstacleId}
        onCellSelect={onEditCell}
      />

      {showDynamicObstacles && map.dynamic_obstacles?.length ? (
        <DynamicObstacles
          map={map}
          timeline={activeTimeline}
          visualProgress={visualProgress}
        />
      ) : null}

      {showPath && activePath && "planner_path_to_pickup" in activePath && (
        <RouteLegend map={map} />
      )}

      {showPath && plannerSegments?.plannerToPickup.length && plannerSegments.plannerToPickup.length > 1 && (
        <Line
          points={plannerSegments.plannerToPickup}
          color="#93c5fd"
          lineWidth={1.1}
          dashed
          dashScale={2}
          dashSize={0.25}
          gapSize={0.18}
          transparent
          opacity={0.55}
        />
      )}

      {showPath && plannerSegments?.plannerToDelivery.length && plannerSegments.plannerToDelivery.length > 1 && (
        <Line
          points={plannerSegments.plannerToDelivery}
          color="#86efac"
          lineWidth={1.1}
          dashed
          dashScale={2}
          dashSize={0.25}
          gapSize={0.18}
          transparent
          opacity={0.55}
        />
      )}

      {showPath && activePath && pathSegments?.beforePickup.length && pathSegments.beforePickup.length > 1 && (
        <Line
          points={pathSegments.beforePickup}
          color="#93c5fd"
          lineWidth={2.8}
          transparent
          opacity={0.92}
        />
      )}

      {showPath && activePath && pathSegments?.afterPickup.length && pathSegments.afterPickup.length > 1 && (
        <Line
          points={pathSegments.afterPickup}
          color="#86efac"
          lineWidth={2.8}
          transparent
          opacity={0.92}
        />
      )}

      <DeliveryAgent
        map={map}
        path={agentPath}
        visualProgress={visualProgress}
        pickupStep={activePath?.pickup_steps?.length ? activePath.pickup_steps[activePath.pickup_steps.length - 1] : (activePath?.pickup_step ?? -1)}
        deliveryStep={activePath?.delivery_step ?? -1}
        followTargetRef={followTargetRef}
      />

      {cameraMode === "follow" && (
        <FollowCameraRig map={map} followTargetRef={followTargetRef} />
      )}

      <OrbitControls
        enabled={cameraMode !== "follow"}
        enableDamping
        dampingFactor={0.08}
        enablePan={false}
        enableRotate={cameraMode !== "top"}
        maxPolarAngle={cameraMode === "top" ? 0.08 : Math.PI / 2.08}
        minPolarAngle={cameraMode === "top" ? 0.02 : 0}
        minDistance={Math.max(6, span * 0.55)}
        maxDistance={Math.max(28, span * 2.6)}
        target={
          cameraMode === "top"
            ? ([0, 0, 0] as [number, number, number])
            : ([0, 0.25, 0] as [number, number, number])
        }
      />
    </>
  );
}

function getCameraSettings(map: MapLayout | null, cameraMode: CameraMode) {
  if (!map) {
    return {
      position: [7, 9, 8] as [number, number, number],
      fov: 42,
    };
  }

  const span = Math.max(map.rows, map.cols);
  const offset = span * 0.94 + 3.6;

  if (cameraMode === "top") {
    return {
      position: [0, span * 2.1 + 6, 0.01] as [number, number, number],
      fov: 36,
    };
  }

  if (cameraMode === "follow") {
    return {
      position: [span * 0.35 + 3.5, span * 0.62 + 3.2, span * 0.25 + 2.8] as [
        number,
        number,
        number,
      ],
      fov: 48,
    };
  }

  return {
    position: [
      map.cols * 0.18 + offset,
      span * 1.2 + 3.4,
      map.rows * 0.2 + offset,
    ] as [number, number, number],
    fov: 42,
  };
}

export default function NavigationScene() {
  const [sourceMode, setSourceMode] = useState<MapSourceMode>("preset");
  const [activeScenarioId, setActiveScenarioId] = useState<ScenarioId>("food_court");
  const [cameraMode, setCameraMode] = useState<CameraMode>("orbit");
  const [showPath, setShowPath] = useState(true);
  const [showPenaltyZones, setShowPenaltyZones] = useState(true);
  const [showDynamicObstacles, setShowDynamicObstacles] = useState(true);
  const [visualProgress, setVisualProgress] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const [playbackSpeed, setPlaybackSpeed] = useState<PlaybackSpeed>(1);
  const [animationKey, setAnimationKey] = useState(0);
  const [presetData, setPresetData] = useState<ScenarioData | null>(null);
  const [presetStatus, setPresetStatus] = useState<LoadStatus>({ state: "loading" });
  const [presetPlannerRuns, setPresetPlannerRuns] = useState<Partial<Record<ScenarioId, DqnInferenceResponse>>>({});
  const [activePresetPlannerReplay, setActivePresetPlannerReplay] = useState<DqnInferenceResponse | null>(null);
  const [presetPlannerStatus, setPresetPlannerStatus] = useState<LoadStatus>({ state: "idle" });
  const [customMap, setCustomMap] = useState<CustomMapConfig>(createDefaultCustomMap());
  const [customResponse, setCustomResponse] = useState<DqnInferenceResponse | null>(null);
  const [customStatus, setCustomStatus] = useState<LoadStatus>({ state: "idle" });
  const [showLeftPanel, setShowLeftPanel] = useState(true);
  const [showRightPanel, setShowRightPanel] = useState(true);
  const [sceneFocusMode, setSceneFocusMode] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const requestVersionRef = useRef(0);
  const presetPlannerRequestVersionRef = useRef(0);
  const activeScenario =
    SCENARIOS.find(({ id }) => id === activeScenarioId) ?? SCENARIOS[0];

  const resetPlaybackForNewPath = useCallback(() => {
    setVisualProgress(0);
    setIsPlaying(true);
    setAnimationKey((value) => value + 1);
  }, []);

  const handleCustomMapChange = (nextMap: CustomMapConfig) => {
    setCustomMap(nextMap);
    setCustomResponse(null);
    resetPlaybackForNewPath();
    setCustomStatus({ state: "idle" });
  };
  const customEditor = useCustomMapEditor(customMap, handleCustomMapChange);

  useEffect(() => {
    if (sourceMode !== "preset") {
      return;
    }

    const requestVersion = requestVersionRef.current + 1;
    requestVersionRef.current = requestVersion;
    let cancelled = false;

    async function loadScenario() {
      const basePath = `/scenarios/${activeScenario.id}`;
      setPresetStatus({ state: "loading" });

      try {
        const map = await fetchRequiredJson<MapLayout>(`${basePath}/map_layout.json`);

        if (cancelled || requestVersionRef.current !== requestVersion) {
          return;
        }

        setPresetData({
          scenario: activeScenario,
          map,
        });
        setVisualProgress(0);
        setIsPlaying(true);
        setAnimationKey((value) => value + 1);
        setPresetStatus({ state: "ready" });
      } catch (error) {
        if (cancelled || requestVersionRef.current !== requestVersion) {
          return;
        }

        setPresetStatus({
          state: "error",
          message: formatScenarioError(activeScenario, error),
        });
      }
    }

    loadScenario();

    return () => {
      cancelled = true;
    };
  }, [activeScenario, sourceMode]);

  const customValidationErrors = useMemo(
    () => validateCustomMap(customMap),
    [customMap],
  );
  const previewMap = useMemo(() => createPreviewMap(customMap), [customMap]);
  const presetPlannerResult = useMemo(
    () => presetPlannerRuns[activeScenarioId] ?? null,
    [activeScenarioId, presetPlannerRuns],
  );
  const resolvedPresetPlannerReplay = activePresetPlannerReplay ?? presetPlannerResult;

  const activePath = sourceMode === "preset"
    ? resolvedPresetPlannerReplay?.rollout ?? null
    : customResponse?.rollout ?? null;
  const activeTimeline = sourceMode === "preset"
    ? resolvedPresetPlannerReplay?.rollout.dynamic_obstacle_timeline ?? null
    : customResponse?.rollout.dynamic_obstacle_timeline ?? null;
  const activeMap = sourceMode === "preset"
    ? (resolvedPresetPlannerReplay?.map ?? presetData?.map ?? null)
    : (customResponse?.map ?? previewMap);
  const activeStatus = sourceMode === "preset"
    ? (
      presetPlannerStatus.state !== "idle"
        ? presetPlannerStatus
        : presetStatus
    )
    : customStatus;
  const maxVisualProgress = Math.max((activePath?.path.length ?? 1) - 1, 0);
  const currentStep = Math.min(
    Math.floor(clampVisualProgress(activePath, visualProgress)),
    Math.max((activePath?.path.length ?? 1) - 1, 0),
  );
  const missionPhase = deriveMissionPhase(activePath, currentStep);
  const cameraSettings = getCameraSettings(activeMap, cameraMode);
  const sceneName = sourceMode === "preset"
    ? presetData?.scenario.name ?? activeScenario.name
    : (customResponse ? "Custom Map Replay" : "Custom Map");
  const sceneDescription = sourceMode === "preset"
    ? presetData?.scenario.blurb ?? activeScenario.blurb
    : "";
  const methodLabel = sourceMode === "preset"
    ? "Planner-Guided DQN"
    : "Planner-Guided DQN";
  const canRunCustomInference = customValidationErrors.length === 0 && customStatus.state !== "loading";
  const activePlannerInferenceMeta = sourceMode === "preset"
    ? resolvedPresetPlannerReplay?.inference_meta ?? null
    : customResponse?.inference_meta ?? null;

  useEffect(() => {
    if (!activePath || !isPlaying || maxVisualProgress <= 0) {
      return;
    }

    let animationFrameId = 0;
    let previousTimestamp: number | null = null;

    const tick = (timestamp: number) => {
      if (previousTimestamp === null) {
        previousTimestamp = timestamp;
      }

      const deltaSeconds = (timestamp - previousTimestamp) / 1000;
      previousTimestamp = timestamp;

      setVisualProgress((previous) => {
        const next = Math.min(
          previous + (deltaSeconds * playbackSpeed) / SEGMENT_DURATION_SECONDS,
          maxVisualProgress,
        );
        if (next >= maxVisualProgress) {
          setIsPlaying(false);
        }
        return next;
      });

      animationFrameId = window.requestAnimationFrame(tick);
    };

    animationFrameId = window.requestAnimationFrame(tick);

    return () => {
      window.cancelAnimationFrame(animationFrameId);
    };
  }, [activePath, isPlaying, maxVisualProgress, playbackSpeed]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTyping = target && (
        target.tagName === "INPUT"
        || target.tagName === "TEXTAREA"
        || target.tagName === "SELECT"
        || target.isContentEditable
      );

      if (isTyping) {
        return;
      }

      if (event.key === "Escape") {
        if (sceneFocusMode) {
          setSceneFocusMode(false);
          return;
        }
        if (isEditMode) {
          setIsEditMode(false);
        }
        return;
      }

      if (event.key.toLowerCase() === "f") {
        event.preventDefault();
        setSceneFocusMode((previous) => !previous);
        return;
      }

      if (event.key.toLowerCase() === "i") {
        event.preventDefault();
        setShowLeftPanel((previous) => !previous);
        return;
      }

      if (event.key.toLowerCase() === "e") {
        event.preventDefault();
        setShowRightPanel((previous) => !previous);
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.cursor = "";
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isEditMode, sceneFocusMode]);

  const handleScenarioChange = (scenarioId: ScenarioId) => {
    const cachedPlannerReplay = presetPlannerRuns[scenarioId] ?? null;
    setActiveScenarioId(scenarioId);
    if (cachedPlannerReplay) {
      setActivePresetPlannerReplay(cachedPlannerReplay);
      setPresetPlannerStatus({ state: "ready" });
      resetPlaybackForNewPath();
      return;
    }

    setActivePresetPlannerReplay(null);
    resetPlaybackForNewPath();
    setPresetPlannerStatus({ state: "idle" });
  };

  const handleRunDqnInference = async () => {
    const payload = toInferencePayload(customMap);
    if (!payload) {
      setCustomStatus({
        state: "error",
        message: "Start, pickup, and delivery must be placed before DQN inference.",
      });
      return;
    }

    setCustomStatus({ state: "loading" });

    try {
      const response = await fetch(`${API_BASE_URL}/api/infer-custom-map`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorBody = (await response.json().catch(() => null)) as { detail?: string } | null;
        throw new Error(errorBody?.detail ?? "Planner-Guided DQN inference failed.");
      }

      const result = (await response.json()) as DqnInferenceResponse;
      setCustomResponse(result);
      resetPlaybackForNewPath();
      setCustomStatus({ state: "ready" });
      setSourceMode("custom");
    } catch (error) {
      setCustomStatus({
        state: "error",
        message: error instanceof Error ? error.message : "Planner-Guided DQN inference failed.",
      });
    }
  };

  const runPresetPlannerInference = useCallback(async (
    scenarioId: ScenarioId,
    presetMap: MapLayout,
  ) => {
    const requestVersion = presetPlannerRequestVersionRef.current + 1;
    presetPlannerRequestVersionRef.current = requestVersion;
    setPresetPlannerStatus({ state: "loading" });
    setActivePresetPlannerReplay(null);

    try {
      const response = await fetch(`${API_BASE_URL}/api/infer-custom-map`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(toInferencePayloadFromLayout(presetMap)),
      });

      if (!response.ok) {
        const errorBody = (await response.json().catch(() => null)) as { detail?: string } | null;
        throw new Error(errorBody?.detail ?? "Planner-Guided DQN preset inference failed.");
      }

      const result = (await response.json()) as DqnInferenceResponse;
      if (presetPlannerRequestVersionRef.current !== requestVersion) {
        return;
      }

      setPresetPlannerRuns((previous) => ({
        ...previous,
        [scenarioId]: result,
      }));
      if (activeScenarioId === scenarioId && sourceMode === "preset") {
        setActivePresetPlannerReplay(result);
        resetPlaybackForNewPath();
      }
      setPresetPlannerStatus({ state: "ready" });
    } catch (error) {
      if (presetPlannerRequestVersionRef.current !== requestVersion) {
        return;
      }

      setPresetPlannerStatus({
        state: "error",
        message: error instanceof Error ? error.message : "Planner-Guided DQN preset inference failed.",
      });
    }
  }, [activeScenarioId, resetPlaybackForNewPath, sourceMode]);

  useEffect(() => {
    if (
      sourceMode !== "preset"
      || !presetData?.map
      || presetPlannerRuns[activeScenarioId]
    ) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void runPresetPlannerInference(activeScenarioId, presetData.map);
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [
    activeScenarioId,
    presetData,
    presetPlannerRuns,
    runPresetPlannerInference,
    sourceMode,
  ]);

  const handlePlayPause = () => {
    if (visualProgress >= maxVisualProgress && maxVisualProgress > 0) {
      setVisualProgress(0);
      setIsPlaying(true);
      return;
    }

    setIsPlaying((previous) => !previous);
  };

  const handleRestart = () => {
    setVisualProgress(0);
    setIsPlaying(true);
  };

  const handleSeek = (progress: number) => {
    setVisualProgress(clampVisualProgress(activePath, progress));
  };

  return (
    <section className="relative min-h-screen w-full bg-[#15181c]">
      <div className="flex min-h-screen flex-col gap-3 p-3 lg:flex-row">
        {showLeftPanel && !sceneFocusMode && (
          <div className="order-2 w-full lg:order-1 lg:max-h-[calc(100vh-1.5rem)] lg:w-[280px] lg:max-w-[280px] lg:overflow-y-auto">
            <MetricsPanel
              sceneName={sceneName}
              sceneDescription={sceneDescription}
              sourceMode={sourceMode}
              methodLabel={methodLabel}
              map={activeMap}
              activePath={activePath}
              currentStep={currentStep}
              missionPhase={missionPhase}
              plannerInferenceMeta={activePlannerInferenceMeta}
              status={activeStatus.state}
            />
          </div>
        )}

        <div className={`order-1 flex min-h-[58vh] flex-1 flex-col overflow-hidden rounded-2xl border border-white/8 bg-[#161a1f] ${sceneFocusMode ? "lg:min-h-[calc(100vh-1.5rem)]" : "lg:order-2 lg:min-h-[calc(100vh-1.5rem)]"}`}>
          <div className="relative flex-1">
            <FloatingPanelToggle
              showLeftPanel={showLeftPanel}
              showRightPanel={showRightPanel}
              sceneFocusMode={sceneFocusMode}
              onToggleLeftPanel={() => setShowLeftPanel((previous) => !previous)}
              onToggleRightPanel={() => setShowRightPanel((previous) => !previous)}
              onToggleSceneFocus={() => setSceneFocusMode((previous) => !previous)}
            />

            <SceneToolbar
              sourceMode={sourceMode}
              isEditMode={isEditMode}
              selectedTool={customEditor.selectedTool}
              onSelectedToolChange={customEditor.setSelectedTool}
              onToggleEditMode={() => setIsEditMode((previous) => !previous)}
              onRunInference={handleRunDqnInference}
              onLoadSampleMap={() => handleCustomMapChange(createSampleCustomMap())}
              onResetMap={() => handleCustomMapChange(createDefaultCustomMap())}
              canRunInference={canRunCustomInference}
              isRunningInference={customStatus.state === "loading"}
            />

            <Canvas
              key={`${sourceMode}-${sourceMode === "preset" ? activeScenarioId : "custom"}-${cameraMode}`}
              shadows={false}
              dpr={[1, 2]}
              camera={cameraSettings}
              className="h-full w-full"
            >
              <Suspense fallback={null}>
                {activeMap ? (
                  <SceneStage
                    key={`${sourceMode}-planner-guided-${animationKey}`}
                    map={activeMap}
                    activePath={activePath}
                    activeTimeline={activeTimeline}
                    showPath={showPath}
                    showPenaltyZones={showPenaltyZones}
                    showDynamicObstacles={showDynamicObstacles}
                    cameraMode={cameraMode}
                    visualProgress={visualProgress}
                    editorMode={sourceMode === "custom" && isEditMode}
                    selectedTool={customEditor.selectedTool}
                    activeDynamicObstacleId={customEditor.activeDynamicObstacleId}
                    onEditCell={sourceMode === "custom" ? customEditor.applyCellTool : undefined}
                  />
                ) : (
                  <EmptyStage />
                )}
              </Suspense>
            </Canvas>
          </div>
        </div>

        {showRightPanel && !sceneFocusMode && (
          <div className="order-3 flex w-full min-h-0 flex-col gap-3 lg:max-h-[calc(100vh-1.5rem)] lg:w-[340px] lg:max-w-[340px] lg:overflow-y-auto">
            <div className="pointer-events-auto flex rounded-2xl border border-white/8 bg-[#1c2128] p-1">
              {[
                { id: "preset" as MapSourceMode, label: "Preset" },
                { id: "custom" as MapSourceMode, label: "Custom" },
              ].map((mode) => (
                <button
                  key={mode.id}
                  type="button"
                  onClick={() => {
                    setSourceMode(mode.id);
                    setVisualProgress(0);
                    setIsPlaying(true);
                    if (mode.id !== "custom") {
                      setIsEditMode(false);
                    }
                  }}
                  className={`flex-1 rounded-xl px-3 py-2 text-sm transition ${
                    sourceMode === mode.id
                      ? "bg-[#2b3340] text-[#f4f4f5]"
                      : "text-[#c1c1c9]"
                  }`}
                >
                  {mode.label}
                </button>
              ))}
            </div>

            {sourceMode === "preset" ? (
              <>
                <ScenarioSelector
                  scenarios={SCENARIOS}
                  activeScenarioId={activeScenarioId}
                  onScenarioChange={handleScenarioChange}
                  isLoading={presetStatus.state === "loading"}
                />

                <ReplayControls
                  cameraMode={cameraMode}
                  onCameraModeChange={setCameraMode}
                  showPath={showPath}
                  onShowPathChange={setShowPath}
                  showPenaltyZones={showPenaltyZones}
                  onShowPenaltyZonesChange={setShowPenaltyZones}
                  showDynamicObstacles={showDynamicObstacles}
                  onShowDynamicObstaclesChange={setShowDynamicObstacles}
                  hasDynamicObstacles={(presetData?.map.dynamic_obstacles?.length ?? 0) > 0}
                  isPlaying={isPlaying}
                  onPlayPause={handlePlayPause}
                  onRestart={handleRestart}
                  playbackSpeed={playbackSpeed}
                  onPlaybackSpeedChange={setPlaybackSpeed}
                  visualProgress={visualProgress}
                  maxVisualProgress={maxVisualProgress}
                  currentStep={currentStep}
                  totalSteps={activePath?.path_length ?? 0}
                  onSeek={handleSeek}
                />

                {activeStatus.state !== "ready" && (
                  <div className="pointer-events-auto rounded-2xl border border-white/8 bg-[#1c2128] px-4 py-3 text-sm leading-6 text-[#c1c1c9]">
                    {activeStatus.state === "loading"
                      ? "Running Planner-Guided DQN on the preset scenario..."
                      : activeStatus.message}
                  </div>
                )}
              </>
            ) : (
              <>
                <CustomMapPanel
                  mapConfig={customMap}
                  editor={customEditor}
                  onRunInference={handleRunDqnInference}
                  onLoadSampleMap={() => handleCustomMapChange(createSampleCustomMap())}
                  onResetMap={() => handleCustomMapChange(createDefaultCustomMap())}
                  validationErrors={customValidationErrors}
                  requestError={customStatus.state === "error" ? customStatus.message ?? null : null}
                  isRunning={customStatus.state === "loading"}
                  isEditMode={isEditMode}
                  onEditModeChange={setIsEditMode}
                />

                <ReplayControls
                  cameraMode={cameraMode}
                  onCameraModeChange={setCameraMode}
                  showPath={showPath}
                  onShowPathChange={setShowPath}
                  showPenaltyZones={showPenaltyZones}
                  onShowPenaltyZonesChange={setShowPenaltyZones}
                  showDynamicObstacles={showDynamicObstacles}
                  onShowDynamicObstaclesChange={setShowDynamicObstacles}
                  hasDynamicObstacles={(activeMap?.dynamic_obstacles?.length ?? 0) > 0}
                  isPlaying={isPlaying}
                  onPlayPause={handlePlayPause}
                  onRestart={handleRestart}
                  playbackSpeed={playbackSpeed}
                  onPlaybackSpeedChange={setPlaybackSpeed}
                  visualProgress={visualProgress}
                  maxVisualProgress={maxVisualProgress}
                  currentStep={currentStep}
                  totalSteps={activePath?.path_length ?? 0}
                  onSeek={handleSeek}
                />
              </>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
