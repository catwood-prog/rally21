import { supabase } from './supabase';

/** Permanently deletes the signed-in user's account via an edge function
 * (the actual deletion needs the service-role key, which must never be in
 * client code). Cascades to all of their data; circles they created
 * survive for remaining members. */
export async function deleteMyAccount(): Promise<void> {
  const { error } = await supabase.functions.invoke('delete-account', { method: 'POST' });
  if (error) throw error;
}
