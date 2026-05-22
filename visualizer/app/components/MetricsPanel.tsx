"use client";

import { motion } from "framer-motion";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Flag,
  Gauge,
  Layers3,
  Map,
  Package,
  Route,
  Settings2,
  Truck,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import type {
  CustomInferenceMeta,
  MapLayout,
  MapSourceMode,
  MissionPath,
  MissionPhase,
} from "./types";

type MetricsPanelProps = {
  sceneName: string;
  sceneDescription: string;
  sourceMode: MapSourceMode;
  methodLabel: string;
  map: MapLayout | null;
  activePath: MissionPath | null;
  currentStep: number;
  missionPhase: MissionPhase;
  plannerInferenceMeta: CustomInferenceMeta | null;
  status: "idle" | "loading" | "ready" | "error";
};

const PHASE_LABELS: Record<MissionPhase, string> = {
  to_pickup: "To pickup",
  delivering: "Delivering",
  waiting: "Waiting",
  complete: "Complete",
};

function formatFailureReason(reason: MissionPath["failure_reason"]) {
  switch (reason) {
    case "no_valid_route":
      return "No valid route";
    case "mission_order_violation":
      return "Mission order violation";
    case "stuck":
      return "Stuck";
    case "timeout":
      return "Timeout";
    case "collision":
      return "Collision";
    case "dynamic_collision":
      return "Dynamic obstacle collision";
    case "excessive_waiting":
      return "Excessive waiting";
    case "incomplete_delivery":
      return "Incomplete delivery";
    default:
      return "Unknown";
  }
}

type SummaryItem = {
  label: string;
  value: string;
  icon: LucideIcon;
  tone?: "default" | "success" | "warning" | "danger" | "info";
};

export default function MetricsPanel({
  sceneName,
  sceneDescription,
  sourceMode,
  methodLabel,
  map,
  activePath,
  currentStep,
  missionPhase,
  plannerInferenceMeta,
  status,
}: MetricsPanelProps) {
  const cargoLoadedNow = Boolean(
    activePath && activePath.pickup_step >= 0 && currentStep >= activePath.pickup_step,
  );
  const missionCompleteNow = Boolean(
    activePath && activePath.delivery_step >= 0 && currentStep >= activePath.delivery_step,
  );
  const failedPlannerRollout = Boolean(activePath && !activePath.completed_delivery);
  const failureReason = plannerInferenceMeta?.failure_reason ?? activePath?.failure_reason ?? null;
  const statusLabel = missionCompleteNow
    ? "Complete"
    : failedPlannerRollout
      ? "Failed"
      : status === "loading"
        ? "Loading"
        : status === "error"
          ? "Error"
          : activePath
            ? "Running"
            : "Idle";

  const pickupCount = map
    ? (Array.isArray(map.pickups) && map.pickups.length > 0 ? map.pickups.length : map.pickup ? 1 : 0)
    : 0;
  const deliveryCount = map
    ? (Array.isArray(map.deliveries) && map.deliveries.length > 0 ? map.deliveries.length : map.delivery ? 1 : 0)
    : 0;
  const obstacleCount = map?.obstacles?.length ?? 0;
  const penaltyZoneCount = map?.penalty_zones?.length ?? 0;
  const dynamicObstacleCount = map?.dynamic_obstacles?.length ?? 0;
  const sourceLabel = sourceMode === "custom" ? "Custom" : "Preset";
  const pathValue = String(
    plannerInferenceMeta
      ? plannerInferenceMeta.path_length
      : activePath?.path_length ?? "--",
  );
  const rewardValue = String(
    plannerInferenceMeta
      ? plannerInferenceMeta.total_reward
      : activePath?.total_reward ?? "--",
  );
  const failureLabel = failureReason ? formatFailureReason(failureReason) : "None";
  const summaryItems: SummaryItem[] = [
    { label: "Mode", value: sourceLabel, icon: Layers3 },
    { label: "Method", value: methodLabel, icon: Route, tone: "info" },
    {
      label: "Status",
      value: statusLabel,
      icon: statusLabel === "Failed" || statusLabel === "Error" ? AlertTriangle : CheckCircle2,
      tone: statusLabel === "Complete" ? "success" : statusLabel === "Failed" || statusLabel === "Error" ? "danger" : "default",
    },
    {
      label: "Cargo",
      value: activePath ? (cargoLoadedNow ? "Loaded" : "Pending") : "--",
      icon: Package,
      tone: cargoLoadedNow ? "info" : "default",
    },
    {
      label: "Completed",
      value: activePath ? (activePath.completed_delivery ? "Yes" : "No") : "--",
      icon: Flag,
      tone: activePath?.completed_delivery ? "success" : "default",
    },
    { label: "Path", value: pathValue, icon: Route, tone: "info" },
    { label: "Reward", value: rewardValue, icon: Gauge, tone: "default" },
  ];
  const plannerSummary = [
    ["Phase", PHASE_LABELS[missionPhase]],
    ["Pickup step", activePath?.pickup_step != null && activePath.pickup_step >= 0 ? String(activePath.pickup_step) : "--"],
    ["Delivery step", activePath?.delivery_step != null && activePath.delivery_step >= 0 ? String(activePath.delivery_step) : "--"],
    ["Step", activePath ? `${Math.min(currentStep, activePath.path_length)} / ${activePath.path_length}` : "--"],
  ] as const;
  const debugRows = plannerInferenceMeta
    ? [
      ["Checkpoint", plannerInferenceMeta.checkpoint_used],
      ["Planner overrides", String(plannerInferenceMeta.planner_override_count)],
      ["Safety overrides", String(plannerInferenceMeta.safety_override_count)],
      ["DQN actions", String(plannerInferenceMeta.dqn_action_count)],
      ["Wait count", String(plannerInferenceMeta.wait_count)],
      ["Collisions", String(plannerInferenceMeta.collisions)],
      ["Dynamic collisions", String(plannerInferenceMeta.dynamic_collision_count)],
      ["Penalty visits", String(plannerInferenceMeta.penalty_zone_visits)],
    ]
    : [];

  return (
    <motion.aside
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: "easeOut" }}
      className="pointer-events-auto flex w-full max-w-[280px] flex-col overflow-hidden rounded-2xl border border-white/8 bg-[#1c2128] lg:max-h-[calc(100vh-1.5rem)]"
    >
      <div className="border-b border-white/8 px-4 py-3">
        <div className="flex items-center gap-2">
          <Truck className="h-4 w-4 text-[#93c5fd]" />
          <p className="text-[13px] font-semibold text-[#f4f4f5]">Autonomous Delivery Navigation Agent</p>
        </div>
        <p className="mt-1 truncate text-xs text-[#f4f4f5]">{sceneName}</p>
        <p className="truncate text-xs leading-5 text-[#71717a]">{sceneDescription}</p>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3">
        <div className="rounded-xl border border-white/8 bg-[#232933] px-3 py-2.5">
          <div className="space-y-2.5">
            {summaryItems.map((item) => (
              <SummaryRow key={item.label} item={item} />
            ))}
          </div>
          <div className="mt-3 border-t border-white/8 pt-3">
            <KeyValueRow
              label="Failure"
              value={failureLabel}
              icon={AlertTriangle}
              tone={failureReason ? "danger" : "default"}
            />
          </div>
        </div>

        <div className="rounded-xl border border-white/8 bg-[#232933] px-3 py-2.5">
          <div className="flex items-center gap-2">
            <Bot className="h-4 w-4 text-[#93c5fd]" />
            <p className="text-xs font-medium text-[#f4f4f5]">Mission</p>
          </div>
          <div className="mt-2 space-y-2">
            {plannerSummary.map(([label, value]) => (
              <KeyValueRow key={label} label={label} value={value} />
            ))}
          </div>
        </div>

        {map && (
          <div className="rounded-xl border border-white/8 bg-[#232933] px-3 py-2.5">
            <div className="flex items-center gap-2">
              <Map className="h-4 w-4 text-[#a1a1aa]" />
              <p className="text-xs font-medium text-[#f4f4f5]">Map</p>
            </div>
            <div className="mt-2 space-y-2">
              <KeyValueRow label="Size" value={`${map.rows} x ${map.cols}`} />
              <KeyValueRow label="Pickup" value={String(pickupCount)} />
              <KeyValueRow label="Delivery" value={String(deliveryCount)} />
              <KeyValueRow label="Obstacles" value={String(obstacleCount)} />
              <KeyValueRow label="Penalty zones" value={String(penaltyZoneCount)} />
              <KeyValueRow label="Dynamic obstacles" value={String(dynamicObstacleCount)} />
            </div>
          </div>
        )}

        {plannerInferenceMeta && (
          <details className="rounded-xl border border-white/8 bg-[#232933] px-3 py-2.5">
            <summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-medium text-[#f4f4f5]">
              <Settings2 className="h-4 w-4 text-[#a1a1aa]" />
              Advanced
            </summary>
            <div className="mt-3 space-y-2">
              <KeyValueRow label="Planner" value={plannerInferenceMeta.planner_used ? "On" : "--"} />
              <KeyValueRow label="DQN" value={plannerInferenceMeta.dqn_used ? "On" : "--"} />
              {debugRows.map(([label, value]) => (
                <KeyValueRow key={label} label={label} value={value} />
              ))}
            </div>
          </details>
        )}
      </div>
    </motion.aside>
  );
}

function KeyValueRow({
  label,
  value,
  icon: Icon,
  tone = "default",
}: {
  label: string;
  value: string;
  icon?: LucideIcon;
  tone?: SummaryItem["tone"];
}) {
  const toneClass = getToneClass(tone);
  return (
    <div className="flex items-start justify-between gap-3 text-sm">
      <span className="flex min-w-0 items-center gap-2 text-[#c1c1c9]">
        {Icon ? <Icon className={`h-3.5 w-3.5 ${toneClass.icon}`} /> : null}
        {label}
      </span>
      <span className={`text-right ${toneClass.value}`}>{value}</span>
    </div>
  );
}

function SummaryRow({
  item,
}: {
  item: SummaryItem;
}) {
  const toneClass = getToneClass(item.tone ?? "default");
  const Icon = item.icon;

  return (
    <div className="flex items-start justify-between gap-3 text-sm">
      <span className="flex min-w-0 items-center gap-2 text-[#c1c1c9]">
        <Icon className={`h-3.5 w-3.5 ${toneClass.icon}`} />
        {item.label}
      </span>
      <span className={`text-right ${toneClass.value}`}>{item.value}</span>
    </div>
  );
}

function getToneClass(tone: SummaryItem["tone"]) {
  switch (tone) {
    case "success":
      return { icon: "text-[#86efac]", value: "text-[#86efac]" };
    case "warning":
      return { icon: "text-[#f59e0b]", value: "text-[#f4f4f5]" };
    case "danger":
      return { icon: "text-[#ef4444]", value: "text-[#f4f4f5]" };
    case "info":
      return { icon: "text-[#93c5fd]", value: "text-[#f4f4f5]" };
    default:
      return { icon: "text-[#a1a1aa]", value: "text-[#f4f4f5]" };
  }
}
