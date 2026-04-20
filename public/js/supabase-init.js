/**
 * Supabase Client Initialization
 * Replaces Firebase Realtime Database for all data operations.
 * Firebase Auth is KEPT — only the database changes.
 */

// Supabase CDN — loaded alongside Firebase
// Using the official Supabase JS client v2
const _SUPABASE_URL = 'https://zrucdzkgrmtwhykvplqs.supabase.co';
const _SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpydWNkemtncm10d2h5a3ZwbHFzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY1ODEwNjEsImV4cCI6MjA5MjE1NzA2MX0.nSJpzPUlIs1phMGRg-SMBbfMqyp9ZQE_p1ioARfHdcs';

// Will be initialized after the Supabase script loads
let supa = null;

function initSupabase() {
    if (typeof supabase !== 'undefined' && supabase.createClient) {
        supa = supabase.createClient(_SUPABASE_URL, _SUPABASE_ANON_KEY);
        console.log('[Supabase] Client initialized');
    } else {
        console.error('[Supabase] Library not loaded yet');
    }
}

// Auto-init when script loads (Supabase CDN should be loaded before this)
if (typeof supabase !== 'undefined') {
    initSupabase();
} else {
    // Retry after a short delay if CDN is still loading
    window.addEventListener('load', () => {
        setTimeout(initSupabase, 100);
    });
}
