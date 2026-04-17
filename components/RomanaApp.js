'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';

// ============================================================
//  CONSTANTES
// ============================================================
const DRIVE_URL = 'https://drive.google.com/drive/u/0/folders/1Mc8SEpw_fgO1oOvgvHXTIQDp9xsuKOU6';
const AUTH_KEY = 'romana-auth-v2';

// ============================================================
//  UTILIDADES
// ============================================================
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function fhash(f) { return `${f.name}|${f.size}|${f.lastModified}`; }
function now() { return new Date().toLocaleString('es-CL', { timeZone: 'America/Santiago' }); }
function todayStr() {
  const d = new Date();
  return String(d.getDate()).padStart(2,'0') + '/' + String(d.getMonth()+1).padStart(2,'0') + '/' + d.getFullYear();
}

function parseDate(ds) {
  if (!ds) return null;
  const p = ds.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (!p) return null;
  return new Date(+p[3], +p[2] - 1, +p[1]);
}
function parseTS(ds, ts) {
  if (!ds) return 0;
  const p = ds.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (!p) return 0;
  let h = 0, m = 0, s = 0;
  if (ts) { const t = ts.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/); if (t) { h = +t[1]; m = +t[2]; s = +(t[3] || 0); } }
  return new Date(+p[3], +p[2] - 1, +p[1], h, m, s).getTime();
}
function timeFrom(dt) { if (!dt) return ''; const m = dt.match(/(\d{1,2}:\d{2}(?::\d{2})?)/); return m ? m[1] : ''; }
function toB64(file) { return new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(r.result.split(',')[1]); r.onerror = () => no(new Error('Read err')); r.readAsDataURL(file); }); }
function loadLS(k, fb) { if (typeof window === 'undefined') return fb; try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fb; } catch { return fb; } }
function saveLS(k, v) { if (typeof window === 'undefined') return; try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }

function inRange(rec, from, to) {
  if (!from && !to) return true;
  const fecha = rec.extracted?.fecha;
  if (!fecha) return true;
  const d = parseDate(fecha);
  if (!d) return true;
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
}

function matchSearch(rec, q) {
  if (!q) return true;
  const low = q.toLowerCase();
  const e = rec.extracted || {};
  const u = rec.uf || {};
  return (
    (e.patente || '').toLowerCase().includes(low) ||
    (e.conductor || '').toLowerCase().includes(low) ||
    (e.informe_n || '').toLowerCase().includes(low) ||
    (u.gen || '').toLowerCase().includes(low) ||
    (u.gest || '').toLowerCase().includes(low) ||
    (e.empresa_raw || '').toLowerCase().includes(low)
  );
}

function groupByDate(records) {
  const groups = {};
  records.forEach(r => {
    const fecha = r.extracted?.fecha || 'Sin fecha';
    if (!groups[fecha]) groups[fecha] = [];
    groups[fecha].push(r);
  });
  return Object.entries(groups).sort(([a], [b]) => {
    const da = parseDate(a), db = parseDate(b);
    if (!da && !db) return 0;
    if (!da) return 1;
    if (!db) return -1;
    return db.getTime() - da.getTime();
  });
}

function exportCSV(records) {
  const headers = ['Fecha', 'Hora Entrada', 'Hora Salida', 'N Informe', 'Patente', 'Conductor', 'Generador', 'Gestor', 'Tipo Residuo', 'Bruto Entrada', 'Bruto Salida', 'Neto KG', 'Neto TON', 'Observaciones'];
  const rows = records.map(r => {
    const e = r.extracted || {};
    const u = r.uf || {};
    return [e.fecha, timeFrom(e.fecha_hora_entrada), timeFrom(e.fecha_hora_salida), e.informe_n, e.patente, e.conductor, u.gen, u.gest, e.observaciones, e.peso_bruto_entrada || 0, e.peso_bruto_salida || 0, e.peso_neto_kg || 0, ((e.peso_neto_kg || 0) / 1000).toFixed(3), r.obsOperador || ''];
  });
  const csv = [headers, ...rows].map(row => row.map(c => `"${String(c || '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `romana_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
}

// ============================================================
//  API CALL — Proxy unico
// ============================================================
async function api(payload) {
  try {
    const res = await fetch('/api/romana', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return await res.json();
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ============================================================
//  COMPONENTS
// ============================================================
function Badge({ s }) {
  const cfg = {
    procesando: { bg: '#0a1a30', fg: '#5b9bd5', t: 'Analizando...' },
    extraido: { bg: '#0a2518', fg: '#52b788', t: 'Por confirmar' },
    confirmado: { bg: '#0d2e1c', fg: '#40d68a', t: 'Confirmado' },
    enviando: { bg: '#1a1a00', fg: '#e9c46a', t: 'Enviando...' },
    editando: { bg: '#2a2200', fg: '#e9c46a', t: 'Editando' },
    error: { bg: '#2d0a0a', fg: '#ff6b6b', t: 'Error' },
    envio_error: { bg: '#2d0a0a', fg: '#ff6b6b', t: 'Error envio' },
    duplicado: { bg: '#1a1a1a', fg: '#555', t: 'Ya ingresado' },
  }[s] || { bg: '#1a1a1a', fg: '#888', t: s };
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '2px 7px', fontSize: 9, fontWeight: 600, background: cfg.bg, color: cfg.fg, borderRadius: 4, whiteSpace: 'nowrap' }}>
      {(s === 'procesando' || s === 'enviando') && <span style={{ display: 'inline-block', width: 7, height: 7, border: '1.5px solid currentColor', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin .8s linear infinite' }} />}
      {cfg.t}
    </span>
  );
}

function Toast({ message, type, onClose }) {
  useEffect(() => { const t = setTimeout(onClose, 4000); return () => clearTimeout(t); }, [onClose]);
  const c = { success: '#40d68a', error: '#ff6b6b', info: '#5b9bd5' }[type] || '#5b9bd5';
  return (
    <div style={{ position: 'fixed', bottom: 20, right: 20, zIndex: 9999, background: '#111', border: `1px solid ${c}`, color: c, padding: '10px 18px', borderRadius: 8, fontSize: 12, fontWeight: 600, animation: 'fadeUp .2s ease', boxShadow: '0 4px 20px rgba(0,0,0,0.5)', maxWidth: 380 }}>
      {message}
    </div>
  );
}

// ============================================================
//  LOGIN SCREEN
// ============================================================
function LoginScreen({ onLogin }) {
  const [usuario, setUsuario] = useState('');
  const [clave, setClave] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const doLogin = async () => {
    if (!usuario || !clave) { setError('Ingresa usuario y clave'); return; }
    setLoading(true); setError('');
    const res = await api({ action: 'login', usuario, clave });
    setLoading(false);
    if (res.ok) onLogin({ usuario: res.usuario, rol: res.rol, token: res.token });
    else setError(res.error || 'Error de autenticacion');
  };

  const sInput = { width: '100%', padding: '10px 12px', fontSize: 14, background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, color: '#dde8dd', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' };
  const sLabel = { fontSize: 10, color: '#4a6b56', textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: 600, display: 'block', marginBottom: 4 };

  return (
    <div style={{ fontFamily: "'DM Sans',sans-serif", background: 'linear-gradient(170deg,#070d09,#0d1a12 40%,#12261a)', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#cddccd' }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,700&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet" />
      <div style={{ width: 360, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 16, padding: 32, textAlign: 'center' }}>
        <div style={{ width: 56, height: 56, borderRadius: 14, background: 'linear-gradient(135deg,#2d6a4f,#52b788)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, fontWeight: 700, color: '#fff', margin: '0 auto 20px' }}>R</div>
        <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>Romana</div>
        <div style={{ fontSize: 11, color: '#3f5e4c', marginBottom: 28 }}>Registro de pesaje — Polpaico</div>
        <div style={{ textAlign: 'left', marginBottom: 14 }}>
          <label style={sLabel}>Usuario</label>
          <input value={usuario} onChange={e => setUsuario(e.target.value.toUpperCase())} placeholder="Ej: ADMIN" onKeyDown={e => e.key === 'Enter' && doLogin()} style={sInput} />
        </div>
        <div style={{ textAlign: 'left', marginBottom: 20 }}>
          <label style={sLabel}>Clave</label>
          <input type="password" value={clave} onChange={e => setClave(e.target.value)} placeholder="Ingresa tu clave" onKeyDown={e => e.key === 'Enter' && doLogin()} style={sInput} />
        </div>
        {error && <div style={{ fontSize: 11, color: '#ff6b6b', marginBottom: 12, padding: '6px 10px', background: 'rgba(255,60,60,0.08)', borderRadius: 6 }}>{error}</div>}
        <button onClick={doLogin} disabled={loading} style={{ width: '100%', padding: '12px', fontSize: 14, fontWeight: 700, background: loading ? 'rgba(255,255,255,0.05)' : 'linear-gradient(135deg,#2d6a4f,#40916c)', color: loading ? '#3f5e4c' : '#fff', border: 'none', borderRadius: 8, cursor: loading ? 'default' : 'pointer' }}>
          {loading ? 'Verificando...' : 'Ingresar'}
        </button>
      </div>
    </div>
  );
}

// ============================================================
//  ADMIN PANEL
// ============================================================
function AdminPanel({ currentUser }) {
  const [usuarios, setUsuarios] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [newUsr, setNewUsr] = useState({ usuario: '', clave: '', rol: 'operador' });
  const [editingUsr, setEditingUsr] = useState(null);
  const [editClave, setEditClave] = useState('');
  const [editRol, setEditRol] = useState('');
  const [msg, setMsg] = useState('');

  const cargar = async () => { setLoading(true); const r = await api({ action: 'listar_usuarios' }); if (r.ok) setUsuarios(r.usuarios || []); setLoading(false); };
  useEffect(() => { cargar(); }, []);

  const crear = async () => {
    if (!newUsr.usuario || !newUsr.clave) { setMsg('Usuario y clave obligatorios'); return; }
    const r = await api({ action: 'crear_usuario', ...newUsr });
    if (r.ok) { setMsg('Usuario creado'); setShowNew(false); setNewUsr({ usuario: '', clave: '', rol: 'operador' }); cargar(); }
    else setMsg(r.error || 'Error');
  };

  const guardarEdit = async (usr) => {
    const p = { action: 'editar_usuario', usuario: usr };
    if (editClave) p.clave = editClave;
    if (editRol) p.rol = editRol;
    const r = await api(p);
    if (r.ok) { setMsg('Actualizado'); setEditingUsr(null); cargar(); }
    else setMsg(r.error || 'Error');
  };

  const toggleActivo = async (usr, activo) => { const r = await api({ action: 'editar_usuario', usuario: usr, activo: !activo }); if (r.ok) cargar(); };
  const eliminar = async (usr) => { if (!confirm(`Eliminar ${usr}?`)) return; const r = await api({ action: 'eliminar_usuario', usuario: usr }); if (r.ok) cargar(); };

  const sLbl = { fontSize: 10, color: '#4a6b56', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 3, fontWeight: 600 };
  const sInp = { width: '100%', padding: '7px 9px', fontSize: 12, background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, color: '#dde8dd', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' };
  const sChip = { fontSize: 10, padding: '5px 12px', background: 'rgba(82,183,136,0.06)', color: '#52b788', border: '1px solid rgba(82,183,136,0.12)', borderRadius: 5, cursor: 'pointer', fontFamily: 'inherit' };
  const sMini = { fontSize: 9, padding: '3px 8px', background: 'rgba(255,255,255,0.03)', color: '#6b8f7b', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 4, cursor: 'pointer', fontFamily: 'inherit' };

  return (
    <div style={{ animation: 'fadeUp .2s ease' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ fontSize: 15, fontWeight: 700 }}>Administracion de usuarios</div>
        <button onClick={() => setShowNew(!showNew)} style={{ ...sChip, background: showNew ? 'rgba(255,60,60,0.08)' : undefined, color: showNew ? '#ff6b6b' : '#52b788' }}>{showNew ? 'Cancelar' : '+ Nuevo usuario'}</button>
      </div>
      {msg && <div style={{ fontSize: 11, color: '#e9c46a', padding: '6px 10px', background: 'rgba(233,196,106,0.06)', borderRadius: 6, marginBottom: 12 }}>{msg} <button onClick={() => setMsg('')} style={{ background: 'none', border: 'none', color: '#e9c46a', cursor: 'pointer', marginLeft: 8 }}>x</button></div>}

      {showNew && (
        <div style={{ background: 'rgba(82,183,136,0.03)', border: '1px solid rgba(82,183,136,0.08)', borderRadius: 10, padding: 16, marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#52b788', marginBottom: 12 }}>Nuevo usuario</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
            <div><div style={sLbl}>Nombre</div><input value={newUsr.usuario} onChange={e => setNewUsr(p => ({ ...p, usuario: e.target.value }))} style={sInp} /></div>
            <div><div style={sLbl}>Clave</div><input type="password" value={newUsr.clave} onChange={e => setNewUsr(p => ({ ...p, clave: e.target.value }))} style={sInp} /></div>
            <div><div style={sLbl}>Rol</div><select value={newUsr.rol} onChange={e => setNewUsr(p => ({ ...p, rol: e.target.value }))} style={sInp}><option value="operador">Operador</option><option value="administrador">Administrador</option></select></div>
          </div>
          <button onClick={crear} style={{ marginTop: 12, padding: '8px 20px', fontSize: 12, fontWeight: 700, background: 'linear-gradient(135deg,#2d6a4f,#40916c)', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}>Crear</button>
        </div>
      )}

      {loading ? <div style={{ textAlign: 'center', padding: 30, color: '#3f5e4c', fontSize: 12 }}>Cargando...</div> : (
        <div style={{ background: 'rgba(255,255,255,0.015)', border: '1px solid rgba(255,255,255,0.04)', borderRadius: 10, overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr auto', padding: '8px 12px', background: 'rgba(82,183,136,0.06)', fontSize: 10, fontWeight: 700, color: '#52b788', textTransform: 'uppercase' }}>
            <div>Usuario</div><div>Rol</div><div>Creado</div><div>Ultimo acceso</div><div>Acciones</div>
          </div>
          {usuarios.map(u => (
            <div key={u.usuario}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr auto', padding: '10px 12px', borderBottom: '1px solid rgba(255,255,255,0.03)', alignItems: 'center', opacity: u.activo ? 1 : 0.4 }}>
                <div style={{ fontSize: 12, fontWeight: 600 }}>{u.usuario}</div>
                <div><span style={{ padding: '2px 6px', borderRadius: 4, fontSize: 9, fontWeight: 600, background: u.rol === 'administrador' ? 'rgba(233,196,106,0.1)' : 'rgba(82,183,136,0.1)', color: u.rol === 'administrador' ? '#e9c46a' : '#52b788' }}>{u.rol}</span></div>
                <div style={{ fontSize: 10, color: '#4a6b56' }}>{u.creado}</div>
                <div style={{ fontSize: 10, color: '#4a6b56' }}>{u.ultimoAcceso || '—'}</div>
                <div style={{ display: 'flex', gap: 4 }}>
                  <button onClick={() => { setEditingUsr(editingUsr === u.usuario ? null : u.usuario); setEditClave(''); setEditRol(u.rol); }} style={sMini}>Editar</button>
                  <button onClick={() => toggleActivo(u.usuario, u.activo)} style={{ ...sMini, color: u.activo ? '#ff6b6b' : '#52b788' }}>{u.activo ? 'Desact.' : 'Activar'}</button>
                  {u.usuario !== currentUser && <button onClick={() => eliminar(u.usuario)} style={{ ...sMini, color: '#ff6b6b' }}>X</button>}
                </div>
              </div>
              {editingUsr === u.usuario && (
                <div style={{ padding: '10px 12px 14px', background: 'rgba(233,196,106,0.03)', display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                  <div><div style={sLbl}>Nueva clave (vacio = no cambiar)</div><input type="password" value={editClave} onChange={e => setEditClave(e.target.value)} style={{ ...sInp, width: 180 }} /></div>
                  <div><div style={sLbl}>Rol</div><select value={editRol} onChange={e => setEditRol(e.target.value)} style={{ ...sInp, width: 140 }}><option value="operador">Operador</option><option value="administrador">Administrador</option></select></div>
                  <button onClick={() => guardarEdit(u.usuario)} style={{ padding: '7px 14px', fontSize: 11, fontWeight: 700, background: '#2d6a4f', color: '#fff', border: 'none', borderRadius: 5, cursor: 'pointer' }}>Guardar</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================
//  MAIN APP
// ============================================================
export default function RomanaApp() {
  // Auth
  const [auth, setAuth] = useState(null);
  const [authLoaded, setAuthLoaded] = useState(false);

  // Data — viene de Sheets
  const [recs, setRecs] = useState([]);
  const [gens, setGens] = useState([]);
  const [gests, setGests] = useState([]);
  const [dataLoading, setDataLoading] = useState(false);
  const [dataLoaded, setDataLoaded] = useState(false);

  // UI
  const [tab, setTab] = useState('upload');
  const [drag, setDrag] = useState(false);
  const [sel, setSel] = useState(null);
  const [filt, setFilt] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [editing, setEditing] = useState(null);
  const [editData, setEditData] = useState({});
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(new Set());
  const [bulkSending, setBulkSending] = useState(false);
  const [toast, setToast] = useState(null);
  const [obsInput, setObsInput] = useState('');
  const [processedHashes, setProcessedHashes] = useState(new Set());
  const fRef = useRef(null);

  // ---- AUTH ----
  useEffect(() => {
    const saved = loadLS(AUTH_KEY, null);
    if (saved) setAuth(saved);
    setAuthLoaded(true);
  }, []);

  const handleLogin = useCallback((data) => { setAuth(data); saveLS(AUTH_KEY, data); }, []);
  const handleLogout = useCallback(() => { setAuth(null); saveLS(AUTH_KEY, null); setDataLoaded(false); }, []);

  // ---- CARGAR DATOS DESDE SHEETS ----
  const cargarDatos = useCallback(async () => {
    setDataLoading(true);
    const [colaRes, listasRes] = await Promise.all([
      api({ action: 'romana_cargar' }),
      api({ action: 'romana_listas' }),
    ]);
    if (colaRes.ok) {
      setRecs(colaRes.registros || []);
      // Build hash set from loaded records
      const hashes = new Set();
      (colaRes.registros || []).forEach(r => {
        if (r.fn) hashes.add(r.fn); // Use filename as duplicate check
      });
      setProcessedHashes(hashes);
    }
    if (listasRes.ok) {
      setGens(listasRes.generadores || []);
      setGests(listasRes.gestores || []);
    }
    setDataLoading(false);
    setDataLoaded(true);
  }, []);

  useEffect(() => { if (auth) cargarDatos(); }, [auth, cargarDatos]);

  // ---- SORT ----
  const sortR = useCallback(arr => [...arr].sort((a, b) => {
    const ta = a.extracted ? parseTS(a.extracted.fecha, timeFrom(a.extracted.fecha_hora_entrada)) : 0;
    const tb = b.extracted ? parseTS(b.extracted.fecha, timeFrom(b.extracted.fecha_hora_entrada)) : 0;
    if (!ta && !tb) return 0; if (!ta) return 1; if (!tb) return -1; return tb - ta;
  }), []);

  // ---- FILE HANDLING ----
  const handleFiles = useCallback(async files => {
    const pdfs = Array.from(files).filter(f => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'));
    if (!pdfs.length) return;

    for (const file of pdfs) {
      const h = fhash(file);
      // Check duplicates by filename
      if (processedHashes.has(file.name)) {
        setToast({ message: `${file.name} ya fue procesado`, type: 'info' });
        continue;
      }

      const id = uid();
      // Add to local state immediately as "procesando"
      const tempRec = { id, fn: file.name, st: 'procesando', extracted: null, uf: { gen: '', gest: '', tipo: 'gestor_generador' } };
      setRecs(prev => sortR([...prev, tempRec]));
      setProcessedHashes(prev => new Set([...prev, file.name]));

      // Extract with Claude
      const b64 = await toB64(file);
      try {
        const res = await fetch('/api/extract', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pdf_base64: b64 }) });
        const json = await res.json();
        if (!res.ok || !json.ok) throw new Error(json.error || 'Error extrayendo');

        // Save to Sheets (ROMANA_COLA)
        const saveRes = await api({
          action: 'romana_guardar',
          id: id,
          fn: file.name,
          st: 'extraido',
          extracted: json.data,
          generador: '',
          gestor: '',
          tipo: 'gestor_generador',
          operador: auth?.usuario || '',
        });

        // Update local state
        setRecs(prev => sortR(prev.map(r => r.id === id ? {
          ...r, st: 'extraido', extracted: json.data,
          uf: { gen: '', gest: '', tipo: 'gestor_generador' },
          _b64: b64, // Keep temporarily for confirm
        } : r)));

      } catch (err) {
        setRecs(prev => prev.map(r => r.id === id ? { ...r, st: 'error', err: err.message } : r));
        setToast({ message: `Error extrayendo ${file.name}: ${err.message}`, type: 'error' });
      }
    }
    setTab('records');
  }, [processedHashes, sortR, auth]);

  const onDrop = useCallback(e => { e.preventDefault(); setDrag(false); handleFiles(e.dataTransfer.files); }, [handleFiles]);
  const updUF = useCallback((id, f) => setRecs(p => p.map(r => r.id === id ? { ...r, uf: { ...r.uf, ...f } } : r)), []);

  // ---- SAVE ASSIGNMENT TO SHEETS ----
  const saveAssignment = useCallback(async (rec) => {
    await api({
      action: 'romana_guardar',
      id: rec.id,
      fn: rec.fn,
      st: rec.st,
      extracted: rec.extracted,
      generador: rec.uf?.gen || '',
      gestor: rec.uf?.gest || '',
      tipo: rec.uf?.tipo || 'gestor_generador',
      operador: auth?.usuario || '',
    });
  }, [auth]);

  // Debounced save when generador/gestor changes
  const saveTimeoutRef = useRef({});
  const debouncedSave = useCallback((rec) => {
    if (saveTimeoutRef.current[rec.id]) clearTimeout(saveTimeoutRef.current[rec.id]);
    saveTimeoutRef.current[rec.id] = setTimeout(() => { saveAssignment(rec); }, 1000);
  }, [saveAssignment]);

  const updUFAndSave = useCallback((id, f) => {
    setRecs(p => {
      const updated = p.map(r => r.id === id ? { ...r, uf: { ...r.uf, ...f } } : r);
      const rec = updated.find(r => r.id === id);
      if (rec && rec.st === 'extraido') debouncedSave(rec);
      return updated;
    });
  }, [debouncedSave]);

  // ---- CONFIRM SINGLE ----
  const doConfirm = useCallback(async (id, obs) => {
    const r = recs.find(x => x.id === id); if (!r?.uf) return;

    // Update gens/gests lists
    if (r.uf.gen && !gens.includes(r.uf.gen)) setGens(p => [...p, r.uf.gen]);
    if (r.uf.gest && !gests.includes(r.uf.gest)) setGests(p => [...p, r.uf.gest]);

    setRecs(prev => prev.map(x => x.id === id ? { ...x, st: 'enviando' } : x));

    try {
      const ext = r.extracted || {};
      const result = await api({
        action: 'romana_confirmar',
        id: r.id,
        obsOperador: obs || '',
        data: {
          fecha: ext.fecha || '',
          hora_entrada: timeFrom(ext.fecha_hora_entrada),
          hora_salida: timeFrom(ext.fecha_hora_salida),
          informe_n: ext.informe_n || '',
          patente: ext.patente || '',
          conductor: ext.conductor || '',
          generador: r.uf.gen || '',
          gestor: r.uf.gest || '',
          tipo_residuo: ext.observaciones || '',
          peso_bruto_entrada: ext.peso_bruto_entrada || 0,
          peso_bruto_salida: ext.peso_bruto_salida || 0,
          peso_neto_kg: ext.peso_neto_kg || 0,
          empresa_generadora: r.uf.gen || '',
          empresa_gestora: r.uf.gest || '',
        },
        pdf_base64: r._b64 || null,
        pdf_nombre: r.fn || 'ticket.pdf',
      });

      if (result.ok) {
        setRecs(prev => prev.map(x => x.id === id ? { ...x, st: 'confirmado', _b64: undefined, obsOperador: obs || '' } : x));
        setToast({ message: `Registro ${ext.informe_n || r.fn} confirmado`, type: 'success' });
      } else {
        throw new Error(result.error || 'Error al confirmar');
      }
    } catch (err) {
      setRecs(prev => prev.map(x => x.id === id ? { ...x, st: 'envio_error', err: err.message } : x));
      setToast({ message: `Error: ${err.message}`, type: 'error' });
    }
    setSel(null); setEditing(null); setObsInput('');
  }, [recs, gens, gests]);

  // ---- CONFIRM BULK ----
  const doBulkConfirm = useCallback(async () => {
    if (selected.size === 0) return;
    setBulkSending(true);
    let ok = 0, fail = 0;
    for (const id of [...selected]) {
      const r = recs.find(x => x.id === id);
      if (!r || r.st !== 'extraido') continue;
      const canConfirm = r.uf?.tipo === 'gestor_generador' ? !!(r.uf.gen && r.uf.gest) : r.uf?.tipo === 'solo_generador' ? !!r.uf.gen : r.uf?.tipo === 'solo_gestor' ? !!r.uf.gest : false;
      if (!canConfirm) { fail++; continue; }

      setRecs(prev => prev.map(x => x.id === id ? { ...x, st: 'enviando' } : x));
      try {
        const ext = r.extracted || {};
        const result = await api({
          action: 'romana_confirmar', id: r.id, obsOperador: '',
          data: { fecha: ext.fecha || '', hora_entrada: timeFrom(ext.fecha_hora_entrada), hora_salida: timeFrom(ext.fecha_hora_salida), informe_n: ext.informe_n || '', patente: ext.patente || '', conductor: ext.conductor || '', generador: r.uf.gen || '', gestor: r.uf.gest || '', tipo_residuo: ext.observaciones || '', peso_bruto_entrada: ext.peso_bruto_entrada || 0, peso_bruto_salida: ext.peso_bruto_salida || 0, peso_neto_kg: ext.peso_neto_kg || 0, empresa_generadora: r.uf.gen || '', empresa_gestora: r.uf.gest || '' },
          pdf_base64: r._b64 || null, pdf_nombre: r.fn || 'ticket.pdf',
        });
        if (result.ok) { setRecs(prev => prev.map(x => x.id === id ? { ...x, st: 'confirmado', _b64: undefined } : x)); ok++; }
        else throw new Error(result.error);
      } catch (err) {
        setRecs(prev => prev.map(x => x.id === id ? { ...x, st: 'envio_error', err: err.message } : x));
        fail++;
      }
    }
    setBulkSending(false);
    setSelected(new Set());
    setToast({ message: `Masivo: ${ok} ok${fail ? `, ${fail} con error` : ''}`, type: fail ? 'error' : 'success' });
  }, [selected, recs]);

  // ---- RETRY ----
  const retryRecord = useCallback((id) => {
    setRecs(prev => prev.map(x => x.id === id ? { ...x, st: 'extraido', err: undefined } : x));
  }, []);

  // ---- DELETE ----
  const del = useCallback(async (id) => {
    setRecs(prev => prev.filter(x => x.id !== id));
    setSelected(prev => { const n = new Set(prev); n.delete(id); return n; });
    if (sel === id) setSel(null);
    // Delete from Sheets too
    api({ action: 'romana_eliminar', id });
  }, [sel]);

  // ---- RESET (admin only) ----
  const reset = useCallback(async () => {
    if (auth?.rol !== 'administrador') return;
    const clave = prompt('Ingresa tu clave de admin para confirmar:');
    if (!clave) return;
    const loginRes = await api({ action: 'login', usuario: auth.usuario, clave });
    if (!loginRes.ok) { setToast({ message: 'Clave incorrecta', type: 'error' }); return; }
    await api({ action: 'romana_reset' });
    setRecs([]); setSel(null); setSelected(new Set());
    setToast({ message: 'Reset completado', type: 'info' });
  }, [auth]);

  // ---- EDIT ----
  const startEdit = useCallback(id => {
    const r = recs.find(x => x.id === id); if (!r) return;
    setEditing(id);
    setEditData({ fecha: r.extracted?.fecha || '', patente: r.extracted?.patente || '', conductor: r.extracted?.conductor || '', observaciones: r.extracted?.observaciones || '', peso_neto_kg: r.extracted?.peso_neto_kg || 0, peso_bruto_entrada: r.extracted?.peso_bruto_entrada || 0, peso_bruto_salida: r.extracted?.peso_bruto_salida || 0, gen: r.uf?.gen || '', gest: r.uf?.gest || '', tipo: r.uf?.tipo || 'gestor_generador' });
  }, [recs]);

  const saveEdit = useCallback(async (id) => {
    const r = recs.find(x => x.id === id); if (!r) return;
    const o = r.extracted || {}; const ou = r.uf || {};
    const changes = [];
    if (editData.fecha !== o.fecha) changes.push(`Fecha: ${o.fecha} -> ${editData.fecha}`);
    if (editData.patente !== o.patente) changes.push(`Patente: ${o.patente} -> ${editData.patente}`);
    if (editData.conductor !== o.conductor) changes.push(`Conductor: ${o.conductor} -> ${editData.conductor}`);
    if (+editData.peso_neto_kg !== +o.peso_neto_kg) changes.push(`Peso: ${o.peso_neto_kg} -> ${editData.peso_neto_kg}`);
    if (editData.gen !== ou.gen) changes.push(`Gen: ${ou.gen} -> ${editData.gen}`);
    if (editData.gest !== ou.gest) changes.push(`Gest: ${ou.gest} -> ${editData.gest}`);
    if (!changes.length) { setEditing(null); return; }

    const newExt = { ...r.extracted, fecha: editData.fecha, patente: editData.patente, conductor: editData.conductor, observaciones: editData.observaciones, peso_neto_kg: +editData.peso_neto_kg, peso_bruto_entrada: +editData.peso_bruto_entrada, peso_bruto_salida: +editData.peso_bruto_salida };
    const newUf = { gen: editData.gen, gest: editData.gest, tipo: editData.tipo };
    const newHistory = [...(r.history || []), { date: now(), changes, operador: auth?.usuario || '' }];

    setRecs(prev => sortR(prev.map(x => x.id === id ? { ...x, extracted: newExt, uf: newUf, history: newHistory } : x)));
    setEditing(null);

    // Save to Sheets
    await api({ action: 'romana_guardar', id, fn: r.fn, st: r.st, extracted: newExt, generador: newUf.gen, gestor: newUf.gest, tipo: newUf.tipo, operador: auth?.usuario || '' });
    setToast({ message: 'Cambios guardados', type: 'success' });
  }, [recs, editData, auth, sortR]);

  // ---- TOGGLE SELECT ----
  const toggleSelect = useCallback((id, e) => { e.stopPropagation(); setSelected(p => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; }); }, []);

  // ---- COMPUTED ----
  const dfP = dateFrom ? new Date(dateFrom + 'T00:00:00') : null;
  const dtP = dateTo ? new Date(dateTo + 'T23:59:59') : null;
  const vis = recs.filter(r => { if (r.st === 'duplicado') return false; if (filt !== 'all' && r.st !== filt) return false; return inRange(r, dfP, dtP) && matchSearch(r, search); });
  const conf = recs.filter(r => r.st === 'confirmado');
  const confR = conf.filter(r => inRange(r, dfP, dtP) && matchSearch(r, search));
  const rangeKg = confR.reduce((s, r) => s + (r.extracted?.peso_neto_kg || 0), 0);
  const totalKg = conf.reduce((s, r) => s + (r.extracted?.peso_neto_kg || 0), 0);
  const pend = recs.filter(r => r.st === 'extraido').length;
  const errors = recs.filter(r => r.st === 'error' || r.st === 'envio_error').length;
  const cur = recs.find(r => r.id === sel);
  const canC = r => { if (!r?.uf) return false; const t = r.uf.tipo; if (t === 'gestor_generador') return !!(r.uf.gen && r.uf.gest); if (t === 'solo_generador') return !!r.uf.gen; if (t === 'solo_gestor') return !!r.uf.gest; return false; };

  const hoy = todayStr();
  const todayRecs = conf.filter(r => r.extracted?.fecha === hoy);
  const todayKg = todayRecs.reduce((s, r) => s + (r.extracted?.peso_neto_kg || 0), 0);

  const genRank = {}; const gestRank = {};
  confR.forEach(r => { const kg = r.extracted?.peso_neto_kg || 0; if (r.uf?.gen) genRank[r.uf.gen] = (genRank[r.uf.gen] || 0) + kg; if (r.uf?.gest) gestRank[r.uf.gest] = (gestRank[r.uf.gest] || 0) + kg; });
  const genS = Object.entries(genRank).sort((a, b) => b[1] - a[1]);
  const gestS = Object.entries(gestRank).sort((a, b) => b[1] - a[1]);
  const mxG = genS[0] ? genS[0][1] : 1; const mxT = gestS[0] ? gestS[0][1] : 1;
  const grouped = useMemo(() => groupByDate(vis), [vis]);

  // ---- RENDER ----
  if (!authLoaded) return <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#070d09' }}><div style={{ color: '#52b788' }}>Cargando...</div></div>;
  if (!auth) return <LoginScreen onLogin={handleLogin} />;
  if (!dataLoaded) return <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#070d09', flexDirection: 'column', gap: 8 }}><div style={{ width: 14, height: 14, border: '2px solid #52b788', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin .8s linear infinite' }} /><div style={{ color: '#52b788', fontSize: 12 }}>Cargando registros...</div><style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style></div>;

  const inp = { width: '100%', padding: '8px 10px', fontSize: 13, background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, color: '#dde8dd', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' };
  const lbl = { fontSize: 10, color: '#4a6b56', textTransform: 'uppercase', letterSpacing: .4, marginBottom: 3, fontWeight: 600 };
  const inpSm = { ...inp, fontSize: 12, padding: '6px 8px' };
  const chipBtn = { fontSize: 10, padding: '5px 12px', background: 'rgba(82,183,136,0.06)', color: '#52b788', border: '1px solid rgba(82,183,136,0.12)', borderRadius: 5, cursor: 'pointer', fontFamily: 'inherit' };

  return (
    <div style={{ fontFamily: "'DM Sans',sans-serif", background: 'linear-gradient(170deg,#070d09,#0d1a12 40%,#12261a)', minHeight: '100vh', color: '#cddccd' }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,700&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet" />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}@keyframes fadeUp{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:translateY(0)}}input::placeholder{color:#3a5444}::-webkit-scrollbar{width:5px}::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.05);border-radius:3px}
        @media(max-width:768px){.stats-grid{grid-template-columns:repeat(2,1fr)!important}.records-layout{flex-direction:column!important}.records-list{flex:1!important;max-height:none!important}.detail-panel{position:static!important;max-height:none!important}.info-grid{grid-template-columns:1fr!important}.tipo-btns{flex-direction:column!important}.filter-bar{flex-direction:column!important;align-items:stretch!important}.rankings{grid-template-columns:1fr!important}}`}</style>

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      {/* HEADER */}
      <header style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 34, height: 34, borderRadius: 8, background: 'linear-gradient(135deg,#2d6a4f,#52b788)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, fontWeight: 700, color: '#fff' }}>R</div>
          <div><div style={{ fontSize: 15, fontWeight: 700 }}>Romana</div><div style={{ fontSize: 10, color: '#3f5e4c' }}>REGISTRO ROMANA - POLPAICO</div></div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          {todayRecs.length > 0 && <div style={{ fontSize: 10, padding: '4px 10px', background: 'rgba(233,196,106,0.06)', border: '1px solid rgba(233,196,106,0.1)', borderRadius: 5, color: '#e9c46a' }}>Hoy: {todayRecs.length} ticket{todayRecs.length > 1 ? 's' : ''}, {(todayKg / 1000).toFixed(1)} ton</div>}
          <div style={{ fontSize: 10, padding: '4px 10px', background: 'rgba(82,183,136,0.04)', borderRadius: 5, color: '#4a6b56' }}>{auth.usuario} <span style={{ fontSize: 8, color: auth.rol === 'administrador' ? '#e9c46a' : '#3f5e4c' }}>({auth.rol})</span></div>
          <button onClick={cargarDatos} disabled={dataLoading} style={{ ...chipBtn, opacity: dataLoading ? 0.5 : 1 }}>{dataLoading ? 'Sync...' : 'Sync'}</button>
          <a href={DRIVE_URL} target="_blank" rel="noopener noreferrer" style={{ fontSize: 10, padding: '5px 10px', background: 'rgba(82,183,136,0.06)', color: '#52b788', border: '1px solid rgba(82,183,136,0.12)', borderRadius: 5, textDecoration: 'none' }}>Drive</a>
          {auth.rol === 'administrador' && <button onClick={reset} style={{ fontSize: 10, padding: '5px 10px', background: 'rgba(255,60,60,0.05)', color: '#ff6b6b', border: '1px solid rgba(255,60,60,0.1)', borderRadius: 5, cursor: 'pointer', fontFamily: 'inherit' }}>Reset</button>}
          <button onClick={handleLogout} style={{ fontSize: 10, padding: '5px 10px', background: 'rgba(255,255,255,0.03)', color: '#6b8f7b', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 5, cursor: 'pointer', fontFamily: 'inherit' }}>Salir</button>
        </div>
      </header>

      {/* STATS */}
      <div className="stats-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', borderBottom: '1px solid rgba(255,255,255,0.03)', background: 'rgba(0,0,0,0.1)' }}>
        {[{ l: 'Confirmados', v: conf.length, c: '#52b788' }, { l: 'Total', v: (totalKg / 1000).toFixed(3), u: ' ton', c: '#40916c' }, { l: dateFrom || dateTo ? 'Filtrado' : 'Periodo', v: dateFrom || dateTo ? (rangeKg / 1000).toFixed(3) : 'todos', u: dateFrom || dateTo ? ' ton' : '', c: '#e9c46a' }, { l: 'Pendientes', v: pend, c: pend > 0 ? '#e76f51' : '#3f5e4c' }, { l: 'Errores', v: errors, c: errors > 0 ? '#ff6b6b' : '#3f5e4c' }].map((s, i) => (
          <div key={i} style={{ padding: '10px 12px', textAlign: 'center' }}>
            <div style={{ fontSize: 9, color: '#3f5e4c', textTransform: 'uppercase', letterSpacing: .4 }}>{s.l}</div>
            <div style={{ fontSize: 17, fontWeight: 700, color: s.c, fontFamily: "'JetBrains Mono',monospace", marginTop: 2 }}>{s.v}{s.u || ''}</div>
          </div>
        ))}
      </div>

      {/* TABS + FILTERS */}
      <div style={{ padding: '0 16px', borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
          <div style={{ display: 'flex' }}>
            {[{ k: 'upload', l: 'Subir PDFs' }, { k: 'records', l: `Registros (${vis.length})` }, { k: 'rankings', l: 'Rankings' }, ...(auth.rol === 'administrador' ? [{ k: 'admin', l: 'Admin' }] : [])].map(t => (
              <button key={t.k} onClick={() => setTab(t.k)} style={{ padding: '10px 14px', fontSize: 12, fontWeight: tab === t.k ? 700 : 400, color: tab === t.k ? '#52b788' : '#3f5e4c', background: 'transparent', border: 'none', borderBottom: tab === t.k ? '2px solid #52b788' : '2px solid transparent', cursor: 'pointer', fontFamily: 'inherit' }}>{t.l}</button>
            ))}
          </div>
          {(tab === 'records' || tab === 'rankings') && (
            <div className="filter-bar" style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '6px 0', flexWrap: 'wrap' }}>
              <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar patente, empresa..." style={{ ...inpSm, width: 180, padding: '5px 8px', fontSize: 10 }} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ fontSize: 10, color: '#3f5e4c' }}>Desde</span><input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ ...inpSm, width: 'auto', padding: '4px 6px', fontSize: 10 }} /></div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ fontSize: 10, color: '#3f5e4c' }}>Hasta</span><input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={{ ...inpSm, width: 'auto', padding: '4px 6px', fontSize: 10 }} /></div>
              {(dateFrom || dateTo || search) && <button onClick={() => { setDateFrom(''); setDateTo(''); setSearch(''); }} style={{ fontSize: 9, padding: '3px 8px', background: 'rgba(255,255,255,0.05)', color: '#6b8f7b', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 4, cursor: 'pointer', fontFamily: 'inherit' }}>Limpiar</button>}
              {tab === 'records' && <select value={filt} onChange={e => setFilt(e.target.value)} style={{ ...inpSm, width: 'auto', padding: '4px 6px', fontSize: 10 }}><option value="all">Todos</option><option value="extraido">Pendientes</option><option value="confirmado">Confirmados</option><option value="error">Errores</option></select>}
              {tab === 'records' && conf.length > 0 && <button onClick={() => exportCSV(confR)} style={chipBtn}>CSV</button>}
            </div>
          )}
        </div>
      </div>

      <main style={{ padding: 16, maxWidth: 1200, margin: '0 auto' }}>

        {/* UPLOAD TAB */}
        {tab === 'upload' && (
          <div style={{ animation: 'fadeUp .2s ease' }}>
            <div onDrop={onDrop} onDragOver={e => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onClick={() => fRef.current?.click()} style={{ border: `2px dashed ${drag ? '#52b788' : 'rgba(255,255,255,0.07)'}`, borderRadius: 14, padding: '48px 24px', textAlign: 'center', cursor: 'pointer', background: drag ? 'rgba(82,183,136,0.04)' : 'rgba(255,255,255,0.01)', transition: 'all .2s' }}>
              <input ref={fRef} type="file" accept=".pdf" multiple onChange={e => handleFiles(e.target.files)} style={{ display: 'none' }} />
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#52b788" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: .4, marginBottom: 12 }}><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
              <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>Arrastra tickets de pesaje aqui</div>
              <div style={{ fontSize: 13, color: '#3f5e4c' }}>o toca para seleccionar archivos PDF</div>
              <div style={{ fontSize: 11, color: '#2d4a38', marginTop: 10 }}>Los datos se sincronizan entre dispositivos</div>
            </div>
            <div className="info-grid" style={{ marginTop: 16, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div style={{ background: 'rgba(255,255,255,0.015)', border: '1px solid rgba(255,255,255,0.04)', borderRadius: 10, padding: '14px 16px' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#52b788', marginBottom: 8 }}>Como funciona</div>
                <div style={{ fontSize: 12, color: '#4a6b56', lineHeight: 1.8 }}>1. Sube PDFs de tickets de pesaje<br />2. Claude AI extrae los datos<br />3. Asignas Generador y/o Gestor<br />4. Confirmas y se envia a Google Sheets<br /><span style={{ color: '#e9c46a', fontSize: 11 }}>Todo se sincroniza — accede desde cualquier dispositivo.</span></div>
              </div>
              <div style={{ background: 'rgba(82,183,136,0.03)', border: '1px solid rgba(82,183,136,0.08)', borderRadius: 10, padding: '14px 16px' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#40916c', marginBottom: 8 }}>Mejoras v2</div>
                <div style={{ fontSize: 12, color: '#4a7a5a', lineHeight: 1.8 }}>Login con usuarios y roles<br />Datos sincronizados entre dispositivos<br />Confirmacion masiva de tickets<br />Busqueda rapida por patente/empresa<br />Exportar registros a CSV<br />Panel de admin para gestionar usuarios</div>
              </div>
            </div>
          </div>
        )}

        {/* RECORDS TAB */}
        {tab === 'records' && (
          <div style={{ animation: 'fadeUp .2s ease' }}>
            {selected.size > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', marginBottom: 12, background: 'rgba(82,183,136,0.05)', border: '1px solid rgba(82,183,136,0.12)', borderRadius: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: '#52b788' }}>{selected.size} seleccionados</span>
                <button onClick={doBulkConfirm} disabled={bulkSending} style={{ padding: '6px 14px', fontSize: 11, fontWeight: 700, background: bulkSending ? 'rgba(255,255,255,0.05)' : 'linear-gradient(135deg,#2d6a4f,#40916c)', color: bulkSending ? '#3f5e4c' : '#fff', border: 'none', borderRadius: 6, cursor: bulkSending ? 'default' : 'pointer', fontFamily: 'inherit' }}>{bulkSending ? 'Enviando...' : 'Confirmar seleccionados'}</button>
                <button onClick={() => setSelected(new Set())} style={chipBtn}>Deseleccionar</button>
                <button onClick={() => { const ids = vis.filter(r => r.st === 'extraido').map(r => r.id); setSelected(new Set(ids)); }} style={chipBtn}>Todos pendientes</button>
              </div>
            )}

            <div className="records-layout" style={{ display: 'flex', gap: 14 }}>
              <div className="records-list" style={{ flex: sel ? '0 0 400px' : '1', display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 'calc(100vh - 320px)', overflowY: 'auto', paddingRight: 4 }}>
                {vis.length === 0 && <div style={{ textAlign: 'center', padding: 30, color: '#3f5e4c', fontSize: 12 }}>{recs.length === 0 ? 'Sin registros. Sube tickets en "Subir PDFs".' : 'Sin resultados.'}</div>}
                {grouped.map(([fecha, items]) => (
                  <div key={fecha}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 8px 4px', marginTop: 8 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: fecha === hoy ? '#e9c46a' : '#52b788' }}>{fecha === hoy ? `HOY — ${fecha}` : fecha}</div>
                      <div style={{ fontSize: 9, color: '#4a6b56' }}>{items.length} ticket{items.length > 1 ? 's' : ''} — {(items.reduce((s, r) => s + (r.extracted?.peso_neto_kg || 0), 0) / 1000).toFixed(3)} ton</div>
                    </div>
                    {items.map(r => (
                      <div key={r.id} onClick={() => { if (r.st !== 'procesando') { setSel(r.id); setEditing(null); setObsInput(''); } }} style={{ background: sel === r.id ? 'rgba(82,183,136,0.05)' : 'rgba(255,255,255,0.015)', border: `1px solid ${sel === r.id ? 'rgba(82,183,136,0.15)' : selected.has(r.id) ? 'rgba(233,196,106,0.2)' : 'rgba(255,255,255,0.04)'}`, borderRadius: 8, padding: '10px 12px', cursor: r.st === 'procesando' ? 'default' : 'pointer', transition: 'all .12s', display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 }}>
                        {r.st === 'extraido' && <input type="checkbox" checked={selected.has(r.id)} onChange={e => toggleSelect(r.id, e)} onClick={e => e.stopPropagation()} style={{ marginRight: 8, accentColor: '#52b788' }} />}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3, flexWrap: 'wrap' }}>
                            <span style={{ fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.extracted?.informe_n ? `#${r.extracted.informe_n}` : r.fn}</span>
                            <Badge s={editing === r.id ? 'editando' : r.st} />
                          </div>
                          <div style={{ fontSize: 10, color: '#4a6b56', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                            {r.extracted && <><span>{r.extracted.patente}</span><span style={{ fontFamily: "'JetBrains Mono',monospace", color: '#52b788', fontWeight: 600 }}>{(r.extracted.peso_neto_kg || 0).toLocaleString('es-CL')} kg</span>{r.uf?.gen && <span style={{ color: '#40916c' }}>{r.uf.gen}</span>}</>}
                            {(r.st === 'error' || r.st === 'envio_error') && <span style={{ color: '#ff6b6b' }}>{r.err}</span>}
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                          {(r.st === 'error' || r.st === 'envio_error') && <button onClick={e => { e.stopPropagation(); retryRecord(r.id); }} style={{ fontSize: 9, padding: '3px 8px', background: 'rgba(233,196,106,0.08)', color: '#e9c46a', border: '1px solid rgba(233,196,106,0.15)', borderRadius: 4, cursor: 'pointer', fontFamily: 'inherit' }}>Reintentar</button>}
                          <button onClick={e => { e.stopPropagation(); del(r.id); }} style={{ background: 'none', border: 'none', color: '#2d4a38', cursor: 'pointer', fontSize: 16, padding: '2px 6px' }}>x</button>
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>

              {/* DETAIL PANEL */}
              {sel && cur && cur.extracted && (
                <div className="detail-panel" style={{ flex: 1, background: 'rgba(255,255,255,0.015)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: 12, padding: 16, position: 'sticky', top: 16, maxHeight: 'calc(100vh - 280px)', overflowY: 'auto' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 6 }}>
                    <div style={{ fontSize: 15, fontWeight: 700 }}>Informe #{cur.extracted.informe_n}</div>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <Badge s={editing === cur.id ? 'editando' : cur.st} />
                      {cur.st === 'confirmado' && editing !== cur.id && <button onClick={() => startEdit(cur.id)} style={{ fontSize: 10, padding: '3px 8px', background: 'rgba(233,196,106,0.08)', color: '#e9c46a', border: '1px solid rgba(233,196,106,0.15)', borderRadius: 4, cursor: 'pointer', fontFamily: 'inherit' }}>Editar</button>}
                      <button onClick={() => { setSel(null); setEditing(null); }} style={{ background: 'none', border: 'none', color: '#3f5e4c', cursor: 'pointer', fontSize: 18 }}>x</button>
                    </div>
                  </div>

                  {editing !== cur.id ? (
                    <>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 14px', marginBottom: 14 }}>
                        {[['Fecha', cur.extracted.fecha], ['Patente', cur.extracted.patente], ['Conductor', cur.extracted.conductor], ['Tipo residuo', cur.extracted.observaciones], ['Hora entrada', timeFrom(cur.extracted.fecha_hora_entrada)], ['Hora salida', timeFrom(cur.extracted.fecha_hora_salida)], ['Bruto entrada', `${(cur.extracted.peso_bruto_entrada || 0).toLocaleString('es-CL')} kg`], ['Bruto salida', `${(cur.extracted.peso_bruto_salida || 0).toLocaleString('es-CL')} kg`]].map(([l, v], i) => (
                          <div key={i}><div style={lbl}>{l}</div><div style={{ fontSize: 13, fontWeight: 500 }}>{v || '—'}</div></div>
                        ))}
                      </div>
                      <div style={{ background: 'rgba(82,183,136,0.05)', border: '1px solid rgba(82,183,136,0.1)', borderRadius: 8, padding: '12px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                        <div><div style={lbl}>Peso neto</div><div style={{ fontSize: 22, fontWeight: 700, color: '#52b788', fontFamily: "'JetBrains Mono',monospace" }}>{(cur.extracted.peso_neto_kg || 0).toLocaleString('es-CL')} kg</div></div>
                        <div style={{ textAlign: 'right' }}><div style={lbl}>Toneladas</div><div style={{ fontSize: 18, fontWeight: 600, color: '#40916c', fontFamily: "'JetBrains Mono',monospace" }}>{((cur.extracted.peso_neto_kg || 0) / 1000).toFixed(3)}</div></div>
                      </div>
                      {cur.extracted.empresa_raw && <div style={{ background: 'rgba(233,196,106,0.04)', border: '1px solid rgba(233,196,106,0.1)', borderRadius: 7, padding: '9px 12px', marginBottom: 14 }}><div style={{ fontSize: 9, color: '#b89a3a', textTransform: 'uppercase', marginBottom: 3 }}>Empresa (del PDF)</div><div style={{ fontSize: 14, fontWeight: 600, color: '#e9c46a' }}>{cur.extracted.empresa_raw}</div></div>}

                      {cur.st !== 'confirmado' && cur.st !== 'enviando' && (
                        <div style={{ borderTop: '1px solid rgba(255,255,255,0.04)', paddingTop: 14 }}>
                          <div style={{ fontSize: 12, fontWeight: 700, color: '#6aaa88', marginBottom: 10 }}>Asignar generador / gestor</div>
                          <div className="tipo-btns" style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
                            {[{ k: 'gestor_generador', l: 'Gestor + Generador' }, { k: 'solo_generador', l: 'Solo Generador' }, { k: 'solo_gestor', l: 'Solo Gestor' }].map(o => (
                              <button key={o.k} onClick={() => updUFAndSave(cur.id, { tipo: o.k })} style={{ flex: 1, padding: '8px 6px', fontSize: 11, fontWeight: cur.uf?.tipo === o.k ? 700 : 400, background: cur.uf?.tipo === o.k ? 'rgba(82,183,136,0.1)' : 'rgba(255,255,255,0.02)', color: cur.uf?.tipo === o.k ? '#52b788' : '#3f5e4c', border: `1px solid ${cur.uf?.tipo === o.k ? 'rgba(82,183,136,0.2)' : 'rgba(255,255,255,0.04)'}`, borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit' }}>{o.l}</button>
                            ))}
                          </div>
                          {cur.uf?.tipo !== 'solo_gestor' && <div style={{ marginBottom: 10 }}><div style={lbl}>GENERADOR</div><input list="dlg" value={cur.uf?.gen || ''} onChange={e => updUFAndSave(cur.id, { gen: e.target.value.toUpperCase() })} placeholder="Ej: COCA COLA" style={inp} /><datalist id="dlg">{gens.map(g => <option key={g} value={g} />)}</datalist></div>}
                          {cur.uf?.tipo !== 'solo_generador' && <div style={{ marginBottom: 14 }}><div style={lbl}>GESTOR</div><input list="dlt" value={cur.uf?.gest || ''} onChange={e => updUFAndSave(cur.id, { gest: e.target.value.toUpperCase() })} placeholder="Ej: ECORILES" style={inp} /><datalist id="dlt">{gests.map(g => <option key={g} value={g} />)}</datalist></div>}
                          <div style={{ marginBottom: 14 }}><div style={lbl}>Observaciones del operador (opcional)</div><input value={obsInput} onChange={e => setObsInput(e.target.value)} placeholder="Ej: Carga parcial, segundo viaje..." style={inp} /></div>
                          <button onClick={() => doConfirm(cur.id, obsInput)} disabled={!canC(cur)} style={{ width: '100%', padding: '12px', fontSize: 14, fontWeight: 700, background: canC(cur) ? 'linear-gradient(135deg,#2d6a4f,#40916c)' : 'rgba(255,255,255,0.03)', color: canC(cur) ? '#fff' : '#2d4a38', border: 'none', borderRadius: 8, cursor: canC(cur) ? 'pointer' : 'default', opacity: canC(cur) ? 1 : .4 }}>Confirmar y enviar a Sheets</button>
                        </div>
                      )}

                      {cur.st === 'enviando' && <div style={{ background: 'rgba(233,196,106,0.06)', borderRadius: 8, padding: '14px 16px', textAlign: 'center' }}><div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}><span style={{ display: 'inline-block', width: 14, height: 14, border: '2px solid #e9c46a', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin .8s linear infinite' }} /><span style={{ fontSize: 13, fontWeight: 600, color: '#e9c46a' }}>Enviando a Google Sheets...</span></div></div>}

                      {cur.st === 'confirmado' && editing !== cur.id && <div style={{ background: 'rgba(82,183,136,0.06)', borderRadius: 8, padding: '12px 16px', textAlign: 'center' }}><div style={{ fontSize: 13, fontWeight: 600, color: '#52b788' }}>Registro confirmado y enviado</div><div style={{ fontSize: 11, color: '#3f5e4c', marginTop: 4 }}>{cur.uf?.gen && `Gen: ${cur.uf.gen}`}{cur.uf?.gen && cur.uf?.gest && ' — '}{cur.uf?.gest && `Gest: ${cur.uf.gest}`}</div>{cur.obsOperador && <div style={{ fontSize: 10, color: '#6a5a2a', marginTop: 4 }}>Obs: {cur.obsOperador}</div>}</div>}

                      {cur.st === 'envio_error' && <div style={{ background: 'rgba(255,60,60,0.06)', borderRadius: 8, padding: '12px 16px', textAlign: 'center' }}><div style={{ fontSize: 13, fontWeight: 600, color: '#ff6b6b' }}>Error al enviar: {cur.err}</div><button onClick={() => retryRecord(cur.id)} style={{ marginTop: 8, ...chipBtn, color: '#e9c46a' }}>Reintentar</button></div>}
                    </>
                  ) : (
                    /* EDIT MODE */
                    <div style={{ animation: 'fadeUp .15s ease' }}>
                      <div style={{ background: 'rgba(233,196,106,0.06)', border: '1px solid rgba(233,196,106,0.12)', borderRadius: 8, padding: '8px 12px', marginBottom: 14, fontSize: 11, color: '#e9c46a' }}>Modo edicion</div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 12px', marginBottom: 14 }}>
                        {[['Fecha', 'fecha'], ['Patente', 'patente'], ['Conductor', 'conductor'], ['Tipo residuo', 'observaciones']].map(([l, k]) => (
                          <div key={k}><div style={lbl}>{l}</div><input value={editData[k] || ''} onChange={e => setEditData(p => ({ ...p, [k]: e.target.value }))} style={inpSm} /></div>
                        ))}
                        {[['Peso neto KG', 'peso_neto_kg'], ['Bruto entrada', 'peso_bruto_entrada'], ['Bruto salida', 'peso_bruto_salida']].map(([l, k]) => (
                          <div key={k}><div style={lbl}>{l}</div><input type="number" value={editData[k] || 0} onChange={e => setEditData(p => ({ ...p, [k]: e.target.value }))} style={inpSm} /></div>
                        ))}
                      </div>
                      <div className="tipo-btns" style={{ display: 'flex', gap: 4, marginBottom: 10 }}>
                        {[{ k: 'gestor_generador', l: 'G+G' }, { k: 'solo_generador', l: 'Solo Gen' }, { k: 'solo_gestor', l: 'Solo Gest' }].map(o => (
                          <button key={o.k} onClick={() => setEditData(p => ({ ...p, tipo: o.k }))} style={{ flex: 1, padding: '7px 4px', fontSize: 10, fontWeight: editData.tipo === o.k ? 700 : 400, background: editData.tipo === o.k ? 'rgba(82,183,136,0.1)' : 'rgba(255,255,255,0.02)', color: editData.tipo === o.k ? '#52b788' : '#3f5e4c', border: `1px solid ${editData.tipo === o.k ? 'rgba(82,183,136,0.2)' : 'rgba(255,255,255,0.04)'}`, borderRadius: 5, cursor: 'pointer', fontFamily: 'inherit' }}>{o.l}</button>
                        ))}
                      </div>
                      {editData.tipo !== 'solo_gestor' && <div style={{ marginBottom: 8 }}><div style={lbl}>GENERADOR</div><input list="dlge" value={editData.gen || ''} onChange={e => setEditData(p => ({ ...p, gen: e.target.value.toUpperCase() }))} style={inpSm} /><datalist id="dlge">{gens.map(g => <option key={g} value={g} />)}</datalist></div>}
                      {editData.tipo !== 'solo_generador' && <div style={{ marginBottom: 12 }}><div style={lbl}>GESTOR</div><input list="dlte" value={editData.gest || ''} onChange={e => setEditData(p => ({ ...p, gest: e.target.value.toUpperCase() }))} style={inpSm} /><datalist id="dlte">{gests.map(g => <option key={g} value={g} />)}</datalist></div>}
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button onClick={() => saveEdit(cur.id)} style={{ flex: 1, padding: '10px', fontSize: 13, fontWeight: 700, background: 'linear-gradient(135deg,#2d6a4f,#40916c)', color: '#fff', border: 'none', borderRadius: 7, cursor: 'pointer' }}>Guardar</button>
                        <button onClick={() => { setEditing(null); setEditData({}); }} style={{ padding: '10px 16px', fontSize: 13, background: 'rgba(255,255,255,0.04)', color: '#6b8f7b', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 7, cursor: 'pointer', fontFamily: 'inherit' }}>Cancelar</button>
                      </div>
                    </div>
                  )}

                  {cur.history && cur.history.length > 0 && (
                    <div style={{ marginTop: 14, borderTop: '1px solid rgba(255,255,255,0.04)', paddingTop: 12 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: '#e9c46a', marginBottom: 8 }}>Historial ({cur.history.length})</div>
                      <div style={{ maxHeight: 140, overflowY: 'auto' }}>
                        {[...cur.history].reverse().map((h, i) => (
                          <div key={i} style={{ background: 'rgba(233,196,106,0.04)', border: '1px solid rgba(233,196,106,0.08)', borderRadius: 6, padding: '8px 10px', marginBottom: 6 }}>
                            <div style={{ fontSize: 9, color: '#8a7a3a', marginBottom: 4 }}>{h.date}{h.operador && ` — ${h.operador}`}</div>
                            {h.changes.map((c, j) => <div key={j} style={{ fontSize: 10, color: '#c4a84a', lineHeight: 1.5 }}>{c}</div>)}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* RANKINGS TAB */}
        {tab === 'rankings' && (
          <div style={{ animation: 'fadeUp .2s ease' }}>
            {(dateFrom || dateTo) && <div style={{ fontSize: 11, color: '#6b8f7b', marginBottom: 12 }}>Periodo: {dateFrom || 'inicio'} al {dateTo || 'hoy'} — {confR.length} registros, {(rangeKg / 1000).toFixed(3)} ton</div>}
            {confR.length === 0 && <div style={{ textAlign: 'center', padding: 30, color: '#3f5e4c', fontSize: 12 }}>Sin datos para rankings.</div>}
            {confR.length > 0 && (
              <div className="rankings" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                {[{ title: 'Generadores', data: genS, color: '#52b788', mx: mxG, filterKey: 'gen' }, { title: 'Gestores', data: gestS, color: '#40916c', mx: mxT, filterKey: 'gest' }].map(section => (
                  <div key={section.title} style={{ background: 'rgba(255,255,255,0.015)', border: '1px solid rgba(255,255,255,0.04)', borderRadius: 12, padding: 16 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: section.color, marginBottom: 14 }}>{section.title} por toneladas</div>
                    {section.data.map(([name, kg], i) => {
                      const tickets = confR.filter(r => r.uf?.[section.filterKey] === name).length;
                      return (
                        <div key={name} style={{ marginBottom: 12 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span style={{ fontSize: 14, fontWeight: 700, color: section.color, fontFamily: "'JetBrains Mono',monospace", width: 22, textAlign: 'right' }}>{i + 1}</span><span style={{ fontSize: 13, fontWeight: 600 }}>{name}</span></div>
                            <span style={{ fontSize: 13, fontWeight: 600, color: section.color, fontFamily: "'JetBrains Mono',monospace" }}>{(kg / 1000).toFixed(3)} ton</span>
                          </div>
                          <div style={{ height: 8, background: 'rgba(255,255,255,0.04)', borderRadius: 4, overflow: 'hidden' }}><div style={{ height: '100%', width: `${(kg / section.mx) * 100}%`, background: `linear-gradient(90deg,${section.color}88,${section.color})`, borderRadius: 4, transition: 'width .3s' }} /></div>
                          <div style={{ fontSize: 9, color: '#3f5e4c', marginTop: 2 }}>{kg.toLocaleString('es-CL')} kg — {tickets} ticket{tickets !== 1 ? 's' : ''}{tickets > 0 ? ` — ${(kg / tickets / 1000).toFixed(2)} ton/ticket` : ''}</div>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ADMIN TAB */}
        {tab === 'admin' && auth.rol === 'administrador' && <AdminPanel currentUser={auth.usuario} />}
      </main>
    </div>
  );
}
