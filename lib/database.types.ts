export type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

export interface Database {
  public: {
    Tables: {
      visit_cells: {
        Row: {
          id: string;
          user_id: string;
          h3_index: string;
          first_visited_at: string;
          last_visited_at: string;
          visit_count: number;
        };
        Insert: {
          id?: string;
          user_id: string;
          h3_index: string;
          first_visited_at?: string;
          last_visited_at?: string;
          visit_count?: number;
        };
        Update: {
          last_visited_at?: string;
          visit_count?: number;
        };
        Relationships: [];
      };
      place_photos: {
        Row: {
          id: string;
          user_id: string;
          h3_index: string;
          lat: number;
          lng: number;
          storage_key: string;
          caption: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          h3_index: string;
          lat: number;
          lng: number;
          storage_key: string;
          caption?: string | null;
          created_at?: string;
        };
        Update: {
          caption?: string | null;
        };
        Relationships: [];
      };
      visit_sync_batches: {
        Row: {
          user_id: string;
          client_batch_id: string;
          applied_at: string;
        };
        Insert: {
          user_id: string;
          client_batch_id: string;
          applied_at?: string;
        };
        Update: Record<string, never>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      apply_visit_batch: {
        Args: {
          p_client_batch_id: string;
          p_events: Json;
        };
        Returns: Json;
      };
    };
  };
}
