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
        };
        Insert: {
          id?: string;
          user_id: string;
          h3_index: string;
          first_visited_at?: string;
          last_visited_at?: string;
        };
        Update: {
          last_visited_at?: string;
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
    Functions: Record<string, never>;
  };
}
