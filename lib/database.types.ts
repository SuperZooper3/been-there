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
      visit_events: {
        Row: {
          id: string;
          user_id: string;
          client_event_id: string;
          h3_index: string;
          visited_at: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          client_event_id: string;
          h3_index: string;
          visited_at: string;
          created_at?: string;
        };
        Update: {
          h3_index?: string;
          visited_at?: string;
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
    };
    Views: Record<string, never>;
    Functions: {
      apply_visit_events_batch: {
        Args: { events: Json };
        Returns: Json;
      };
    };
  };
}
