import { TelemetryPayload } from '../types';

export type TelemetryListener = (data: TelemetryPayload) => void;

class TelemetryService {
  private ws: WebSocket | null = null;
  private listeners: Set<TelemetryListener> = new Set();
  private isConnecting: boolean = false;
  private reconnectTimer: number | null = null;
  private wsUrl: string = 'ws://localhost:8000/ws/telemetry';
  private apiBaseUrl: string = 'http://localhost:8000';

  constructor() {
    if (typeof window !== 'undefined') {
      const host = window.location.hostname || 'localhost';
      this.wsUrl = `ws://${host}:8000/ws/telemetry`;
      this.apiBaseUrl = `http://${host}:8000`;
    }
  }

  public connect(): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    this.isConnecting = true;
    try {
      this.ws = new WebSocket(this.wsUrl);

      this.ws.onopen = () => {
        this.isConnecting = false;
        console.log('Connected to Garuda-Aegis telemetry stream.');
      };

      this.ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data) as TelemetryPayload;
          this.listeners.forEach((listener) => listener(payload));
        } catch (err) {
          console.error('Failed to parse telemetry JSON:', err);
        }
      };

      this.ws.onclose = () => {
        this.isConnecting = false;
        this.ws = null;
        this.scheduleReconnect();
      };

      this.ws.onerror = (err) => {
        console.warn('Telemetry socket error:', err);
        if (this.ws) {
          this.ws.close();
        }
      };
    } catch (err) {
      this.isConnecting = false;
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null) return;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 2000);
  }

  public subscribe(listener: TelemetryListener): () => void {
    this.listeners.add(listener);
    if (!this.ws || this.ws.readyState === WebSocket.CLOSED) {
      this.connect();
    }
    return () => {
      this.listeners.delete(listener);
    };
  }

  public async triggerJammer(params: {
    azimuth_deg: number;
    elevation_deg: number;
    power_w: number;
    frequency_mhz: number;
    bandwidth_mhz: number;
    target_track_id?: string | null;
  }): Promise<any> {
    const res = await fetch(`${this.apiBaseUrl}/api/v1/defense/jam`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    if (!res.ok) throw new Error('Jammer activation request failed.');
    return res.json();
  }

  public async disarmJammer(): Promise<any> {
    const res = await fetch(`${this.apiBaseUrl}/api/v1/defense/disarm`, {
      method: 'POST',
    });
    if (!res.ok) throw new Error('Jammer disarm request failed.');
    return res.json();
  }

  public async resetSimulation(): Promise<any> {
    const res = await fetch(`${this.apiBaseUrl}/api/v1/simulation/reset`, {
      method: 'POST',
    });
    if (!res.ok) throw new Error('Simulation reset request failed.');
    return res.json();
  }

  public async getDossier(targetId: string): Promise<any> {
    const res = await fetch(`${this.apiBaseUrl}/api/v1/forensics/dossier/${targetId}`);
    if (!res.ok) throw new Error(`Failed to retrieve forensic dossier for ${targetId}`);
    return res.json();
  }
}

export const telemetryService = new TelemetryService();
