export interface Vector3D {
  x: number;
  y: number;
  z: number;
}

export interface TrackVelocity {
  vx: number;
  vy: number;
  vz: number;
  speed_mps: number;
}

export interface TrackAcceleration {
  ax: number;
  ay: number;
  az: number;
}

export interface FusedTrack {
  track_id: string;
  status: 'TENTATIVE' | 'CONFIRMED' | 'DELETED';
  classification: 'HOSTILE_QUADCOPTER' | 'AVIAN_CLUTTER' | 'UNKNOWN';
  position: Vector3D;
  velocity: TrackVelocity;
  acceleration: TrackAcceleration;
  uncertainty_pos_m: number;
  micro_doppler_hz: number;
  gnss_spoof_flag: boolean;
  ew_status: string;
  link_sinr_db: number;
  packet_loss_pct: number;
  protocol: string;
  missed_scans: number;
  hits_in_window: number;
}

export interface RadarDetection {
  range_m: number;
  az_rad: number;
  el_rad: number;
  doppler_mps: number;
  micro_doppler_hz: number;
  snr_db: number;
  rcs_m2: number;
  target_id?: string | null;
}

export interface RFBearing {
  az_rad: number;
  el_rad: number;
  frequency_mhz: number;
  protocol: string;
  threat_category: string;
  gnss_spoof_flag: boolean;
  spoof_gamma: number;
  cn0_db_hz: number;
  sensor_pos: number[];
  drone_id?: string | null;
}

export interface GroundTruthDrone {
  drone_id: string;
  position: [number, number, number];
  velocity: [number, number, number];
  speed_mps: number;
  link_state: string;
  rcs_mean: number;
  rotor_rpm: number;
  frequency_mhz: number;
  carrier_to_noise_db_hz: number;
  rf_transmitting: boolean;
  spoofed_gnss: [number, number, number] | null;
}

export interface JammerStatus {
  is_active: boolean;
  aim_az_deg: number;
  aim_el_deg: number;
  power_w: number;
  freq_mhz: number;
  target_track_id: string | null;
}

export interface TelemetryPayload {
  timestamp: number;
  frame: number;
  tracks: FusedTrack[];
  ground_truth_drones: GroundTruthDrone[];
  radar_detections: RadarDetection[];
  rf_bearings: RFBearing[];
  jammer_status: JammerStatus;
}

// Retain legacy radio interceptor types for compatibility
export type SpectrumPoint = {
  frequency_mhz: number;
  power_db: number;
};

export type Burst = {
  start_index: number;
  end_index: number;
  peak_power_db: number;
};

export type Threat = {
  protocol: string;
  confidence: number;
  estimated_distance_m: number;
  rssi_dbm: number;
  last_seen: string;
  severity: string;
  reason: string;
  peaks: SpectrumPoint[];
};

export type Scan = {
  captured_at: string;
  center_frequency_mhz: number;
  bandwidth_mhz: number;
  noise_floor_db: number;
  rssi_dbm: number;
  spectrum: number[];
  peaks: SpectrumPoint[];
  bursts: Burst[];
  threats: Threat[];
};
