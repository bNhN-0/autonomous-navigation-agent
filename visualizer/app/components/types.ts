export type GridPosition = [number, number];

export type ScenarioId =
  | "food_court"
  | "warehouse_cargo"
  | "mall_delivery"
  | "crowded_corridor"
  | "logistics_hub";

export type CameraMode = "orbit" | "top" | "follow";
export type MissionPhase = "to_pickup" | "delivering" | "waiting" | "complete";
export type ActionId = 0 | 1 | 2 | 3 | 4;
export type PlaybackSpeed = 0.5 | 1 | 1.5 | 2;
export type MapSourceMode = "preset" | "custom";
export type CellTool =
  | "road"
  | "obstacle"
  | "rough"
  | "danger"
  | "start"
  | "pickup"
  | "delivery"
  | "clear"
  | "dynamic_path"
  | "clear_dynamic_path";

export type ScenarioOption = {
  id: ScenarioId;
  name: string;
  blurb: string;
  accent: string;
};

export const SCENARIOS: ScenarioOption[] = [
  {
    id: "food_court",
    name: "Food Court Delivery",
    blurb: "Restaurant pickup through tables, queues, and busy indoor lanes.",
    accent: "#38bdf8",
  },
  {
    id: "warehouse_cargo",
    name: "Warehouse Cargo",
    blurb: "Shelf aisles, loading crossings, and a long haul to the dock.",
    accent: "#22c55e",
  },
  {
    id: "mall_delivery",
    name: "Mall Delivery",
    blurb: "Indoor storefront routing with atrium traffic and split corridors.",
    accent: "#f59e0b",
  },
  {
    id: "crowded_corridor",
    name: "Crowded Corridor",
    blurb: "Penalty-heavy hallways that reward safer, cost-aware navigation.",
    accent: "#f97316",
  },
  {
    id: "logistics_hub",
    name: "Logistics Hub",
    blurb: "Depot routing through conveyors, queues, and moving service traffic.",
    accent: "#34d399",
  },
];

export type PenaltyZone = {
  cell: GridPosition;
  penalty: number;
  label: string;
  severity: "crowded" | "danger";
  type?: "crowded" | "danger";
};

export type DynamicObstacle = {
  id: string;
  label?: string;
  kind?: "cart" | "person" | "blocker";
  path: GridPosition[];
  speed: number;
  color?: string;
};

export type DynamicObstacleSnapshot = {
  id: string;
  position: GridPosition;
};

export type DynamicObstacleTimelineFrame = {
  step: number;
  obstacles: DynamicObstacleSnapshot[];
};

export type MapLayout = {
  rows: number;
  cols: number;
  start: GridPosition;
  pickups: GridPosition[];
  deliveries: GridPosition[];
  pickup: GridPosition;
  delivery: GridPosition;
  obstacles: GridPosition[];
  penalty_zones?: PenaltyZone[];
  dynamic_obstacles?: DynamicObstacle[];
  dynamic_cycle_length?: number;
};

export type MissionPath = {
  start: GridPosition;
  pickups: GridPosition[];
  deliveries: GridPosition[];
  pickup: GridPosition;
  delivery: GridPosition;
  path: GridPosition[];
  actions: ActionId[];
  time_phases: number[];
  path_length: number;
  reached_pickup: boolean;
  reached_pickups?: number;
  reached_delivery: boolean;
  completed_deliveries?: number;
  mission_complete?: boolean;
  current_target?: GridPosition | null;
  completed_delivery: boolean;
  total_reward: number;
  pickup_step: number;
  delivery_step: number;
  pickup_steps?: number[];
  delivery_steps?: number[];
  penalty_zone_visits: number;
  collisions: number;
  wait_count: number;
  max_consecutive_wait?: number;
  excessive_wait_count?: number;
  dynamic_collision_count: number;
  timed_out?: boolean;
  failure_reason?:
    | "timeout"
    | "collision"
    | "dynamic_collision"
    | "excessive_waiting"
    | "incomplete_delivery"
    | "no_valid_route"
    | "mission_order_violation"
    | "stuck"
    | null;
};

export type CustomInferenceMeta = {
  checkpoint_used: string;
  method: "planner_guided_dqn";
  used_fallback: boolean;
  planner_used: boolean;
  dqn_used: boolean;
  completed_delivery: boolean;
  reached_pickup: boolean;
  reached_pickups?: number;
  completed_deliveries?: number;
  pickup_step: number;
  delivery_step: number;
  path_length: number;
  total_reward: number;
  failure_reason?: MissionPath["failure_reason"];
  planner_path: GridPosition[];
  dqn_actions: ActionId[];
  planner_override_count: number;
  dqn_action_count: number;
  safety_override_count: number;
  wait_count: number;
  max_consecutive_wait: number;
  excessive_wait_count: number;
  collisions: number;
  dynamic_collision_count: number;
  penalty_zone_visits: number;
  first_20_path_cells: GridPosition[];
};

export type ScenarioData = {
  scenario: ScenarioOption;
  map: MapLayout;
};

export type CustomMapConfig = {
  rows: number;
  cols: number;
  start: GridPosition | null;
  pickups: GridPosition[];
  deliveries: GridPosition[];
  pickup: GridPosition | null;
  delivery: GridPosition | null;
  obstacles: GridPosition[];
  penalty_zones: PenaltyZone[];
  dynamic_obstacles: DynamicObstacle[];
};

export type DqnRollout = MissionPath & {
  method: "planner_guided_dqn";
  planner_used: boolean;
  dqn_used: boolean;
  used_fallback: boolean;
  planner_path: GridPosition[];
  planner_path_to_pickup: GridPosition[];
  planner_path_to_delivery: GridPosition[];
  dqn_actions: ActionId[];
  planner_override_count: number;
  dqn_action_count: number;
  safety_override_count: number;
  dynamic_obstacle_timeline: DynamicObstacleTimelineFrame[];
};

export type DqnInferenceResponse = {
  method: "planner_guided_dqn";
  map: MapLayout;
  rollout: DqnRollout;
  inference_meta: CustomInferenceMeta;
};
