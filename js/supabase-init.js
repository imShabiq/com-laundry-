import { createClient } from "https://esm.sh/@supabase/supabase-js@2?bundle";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./supabase-config.js";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
