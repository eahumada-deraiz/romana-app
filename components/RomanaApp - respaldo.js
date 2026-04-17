'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

const DRIVE_URL = 'https://drive.google.com/drive/u/0/folders/1Mc8SEpw_fgO1oOvgvHXTIQDp9xsuKOU6';
const SK = { RECS:'romana-r6', HASH:'romana-h6', GENS:'romana-g6', GEST:'romana-t6' };

function uid(){return Date.now().toString(36)+Math.random().toString(36).slice(2,7)}
function fhash(f){return`${f.name}|${f.size}|${f.lastModified}`}
function now(){return new Date().toLocaleString('es-CL',{timeZone:'America/Santiago'})}

function parseTS(ds,ts){
  if(!ds)return 0;
  const p=ds.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if(!p)return 0;
  let h=0,m=0,s=0;
  if(ts){const t=ts.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);if(t){h=+t[1];m=+t[2];s=+(t[3]||0);}}
  return new Date(+p[3],+p[2]-1,+p[1],h,m,s).getTime();
}
function parseDate(ds){
  if(!ds)return null;
  const p=ds.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if(!p)return null;
  return new Date(+p[3],+p[2]-1,+p[1]);
}
function timeFrom(dt){if(!dt)return'';const m=dt.match(/(\d{1,2}:\d{2}(?::\d{2})?)/);return m?m[1]:'';}
function toB64(file){return new Promise((ok,no)=>{const r=new FileReader();r.onload=()=>ok(r.result.split(',')[1]);r.onerror=()=>no(new Error('Read err'));r.readAsDataURL(file);})}
function loadLS(k,fb){if(typeof window==='undefined')return fb;try{const v=localStorage.getItem(k);return v?JSON.parse(v):fb;}catch{return fb;}}
function saveLS(k,v){if(typeof window==='undefined')return;try{localStorage.setItem(k,JSON.stringify(v));}catch{}}

function inRange(rec,from,to){
  if(!from&&!to)return true;
  if(!rec.extracted?.fecha)return true;
  const d=parseDate(rec.extracted.fecha);
  if(!d)return true;
  if(from&&d<from)return false;
  if(to&&d>to)return false;
  return true;
}

function Badge({s}){
  const cfg={
    procesando:{bg:'#0a1a30',fg:'#5b9bd5',t:'Analizando...'},
    extraido:{bg:'#0a2518',fg:'#52b788',t:'Por confirmar'},
    confirmado:{bg:'#0d2e1c',fg:'#40d68a',t:'Confirmado'},
    editando:{bg:'#2a2200',fg:'#e9c46a',t:'Editando'},
    error:{bg:'#2d0a0a',fg:'#ff6b6b',t:'Error'},
    duplicado:{bg:'#1a1a1a',fg:'#555',t:'Ya ingresado'},
  }[s]||{bg:'#1a1a1a',fg:'#888',t:s};
  return(
    <span style={{display:'inline-flex',alignItems:'center',gap:3,padding:'2px 7px',fontSize:9,fontWeight:600,background:cfg.bg,color:cfg.fg,borderRadius:4,whiteSpace:'nowrap'}}>
      {s==='procesando'&&<span style={{display:'inline-block',width:7,height:7,border:'1.5px solid currentColor',borderTopColor:'transparent',borderRadius:'50%',animation:'spin .8s linear infinite'}}/>}
      {cfg.t}
    </span>
  );
}

export default function RomanaApp(){
  const[recs,setRecs]=useState([]);
  const[hashes,setHashes]=useState(new Set());
  const[gens,setGens]=useState([]);
  const[gests,setGests]=useState([]);
  const[tab,setTab]=useState('upload');
  const[drag,setDrag]=useState(false);
  const[sel,setSel]=useState(null);
  const[filt,setFilt]=useState('all');
  const[dateFrom,setDateFrom]=useState('');
  const[dateTo,setDateTo]=useState('');
  const[editing,setEditing]=useState(null);
  const[editData,setEditData]=useState({});
  const[loaded,setLoaded]=useState(false);
  const fRef=useRef(null);

  useEffect(()=>{
    setRecs(loadLS(SK.RECS,[]));
    setHashes(new Set(loadLS(SK.HASH,[])));
    setGens(loadLS(SK.GENS,[]));
    setGests(loadLS(SK.GEST,[]));
    setLoaded(true);
  },[]);

  const saveRecs=useCallback(r=>{setRecs(r);saveLS(SK.RECS,r);},[]);
  const saveHash=useCallback(h=>{setHashes(h);saveLS(SK.HASH,[...h]);},[]);
  const saveGens=useCallback(g=>{setGens(g);saveLS(SK.GENS,g);},[]);
  const saveGest=useCallback(g=>{setGests(g);saveLS(SK.GEST,g);},[]);

  const sortR=useCallback(arr=>[...arr].sort((a,b)=>{
    const ta=a.extracted?parseTS(a.extracted.fecha,timeFrom(a.extracted.fecha_hora_entrada)):0;
    const tb=b.extracted?parseTS(b.extracted.fecha,timeFrom(b.extracted.fecha_hora_entrada)):0;
    if(!ta&&!tb)return 0;if(!ta)return 1;if(!tb)return-1;return tb-ta;
  }),[]);

  const handleFiles=useCallback(async files=>{
    const pdfs=Array.from(files).filter(f=>f.type==='application/pdf'||f.name.toLowerCase().endsWith('.pdf'));
    if(!pdfs.length)return;
    let nr=[...recs];const nh=new Set(hashes);
    for(const file of pdfs){
      const h=fhash(file);
      if(nh.has(h)){nr.push({id:uid(),fn:file.name,fh:h,st:'duplicado',extracted:null,uf:null,history:[]});continue;}
      const rec={id:uid(),fn:file.name,fh:h,st:'procesando',extracted:null,uf:null,history:[]};
      nr.push(rec);nh.add(h);
      const b64=await toB64(file);
      (async()=>{
        try{
          const res=await fetch('/api/extract',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pdf_base64:b64})});
          const json=await res.json();
          if(!res.ok||!json.ok)throw new Error(json.error||'Error extrayendo');
          setRecs(prev=>{const u=sortR(prev.map(r=>r.id===rec.id?{...r,st:'extraido',extracted:json.data,uf:{gen:'',gest:'',tipo:'gestor_generador'},history:[],b64:b64}:r));saveLS(SK.RECS,u.map(x=>({...x,b64:undefined})));return u;});
        }catch(err){
          setRecs(prev=>{const u=prev.map(r=>r.id===rec.id?{...r,st:'error',err:err.message}:r);saveLS(SK.RECS,u);return u;});
        }
      })();
    }
    nr=sortR(nr);saveRecs(nr);saveHash(nh);setTab('records');
  },[recs,hashes,sortR,saveRecs,saveHash]);

  const onDrop=useCallback(e=>{e.preventDefault();setDrag(false);handleFiles(e.dataTransfer.files);},[handleFiles]);
  const updUF=useCallback((id,f)=>setRecs(p=>p.map(r=>r.id===id?{...r,uf:{...r.uf,...f}}:r)),[]);

  const doConfirm=useCallback(async id=>{
    const r=recs.find(x=>x.id===id);if(!r?.uf)return;
    if(r.uf.gen&&!gens.includes(r.uf.gen)){const u=[...gens,r.uf.gen];saveGens(u);}
    if(r.uf.gest&&!gests.includes(r.uf.gest)){const u=[...gests,r.uf.gest];saveGest(u);}

    // Send to Google Sheets + Drive
    const ext=r.extracted||{};
    try{
      const payload={
        data:{
          fecha:ext.fecha||'',
          hora_entrada:timeFrom(ext.fecha_hora_entrada),
          hora_salida:timeFrom(ext.fecha_hora_salida),
          informe_n:ext.informe_n||'',
          patente:ext.patente||'',
          conductor:ext.conductor||'',
          generador:r.uf.gen||'',
          gestor:r.uf.gest||'',
          tipo_residuo:ext.observaciones||'',
          peso_bruto_entrada:ext.peso_bruto_entrada||0,
          peso_bruto_salida:ext.peso_bruto_salida||0,
          peso_neto_kg:ext.peso_neto_kg||0,
          empresa_generadora:r.uf.gen||'',
          empresa_gestora:r.uf.gest||'',
        },
        pdf_base64:r.b64||null,
        pdf_nombre:r.fn||'ticket.pdf',
      };
      fetch('/api/registrar',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}).catch(()=>{});
    }catch(e){}

    const u=recs.map(x=>x.id===id?{...x,st:'confirmado',b64:undefined}:x);
    saveRecs(u.map(x=>({...x,b64:undefined})));setRecs(u);setSel(null);setEditing(null);
  },[recs,gens,gests,saveRecs,saveGens,saveGest]);

  const startEdit=useCallback(id=>{
    const r=recs.find(x=>x.id===id);if(!r)return;
    setEditing(id);
    setEditData({fecha:r.extracted?.fecha||'',patente:r.extracted?.patente||'',conductor:r.extracted?.conductor||'',observaciones:r.extracted?.observaciones||'',peso_neto_kg:r.extracted?.peso_neto_kg||0,peso_bruto_entrada:r.extracted?.peso_bruto_entrada||0,peso_bruto_salida:r.extracted?.peso_bruto_salida||0,gen:r.uf?.gen||'',gest:r.uf?.gest||'',tipo:r.uf?.tipo||'gestor_generador'});
  },[recs]);

  const saveEdit=useCallback(id=>{
    const r=recs.find(x=>x.id===id);if(!r)return;
    const changes=[];
    const o=r.extracted||{};const ou=r.uf||{};
    if(editData.fecha!==o.fecha)changes.push(`Fecha: ${o.fecha} → ${editData.fecha}`);
    if(editData.patente!==o.patente)changes.push(`Patente: ${o.patente} → ${editData.patente}`);
    if(editData.conductor!==o.conductor)changes.push(`Conductor: ${o.conductor} → ${editData.conductor}`);
    if(editData.observaciones!==o.observaciones)changes.push(`Tipo residuo: ${o.observaciones} → ${editData.observaciones}`);
    if(+editData.peso_neto_kg!==+o.peso_neto_kg)changes.push(`Peso neto: ${o.peso_neto_kg} → ${editData.peso_neto_kg} kg`);
    if(+editData.peso_bruto_entrada!==+o.peso_bruto_entrada)changes.push(`Bruto ent: ${o.peso_bruto_entrada} → ${editData.peso_bruto_entrada} kg`);
    if(+editData.peso_bruto_salida!==+o.peso_bruto_salida)changes.push(`Bruto sal: ${o.peso_bruto_salida} → ${editData.peso_bruto_salida} kg`);
    if(editData.gen!==ou.gen)changes.push(`Generador: ${ou.gen||'(vacío)'} → ${editData.gen}`);
    if(editData.gest!==ou.gest)changes.push(`Gestor: ${ou.gest||'(vacío)'} → ${editData.gest}`);
    if(!changes.length){setEditing(null);return;}
    const entry={date:now(),changes};
    const newExt={...r.extracted,fecha:editData.fecha,patente:editData.patente,conductor:editData.conductor,observaciones:editData.observaciones,peso_neto_kg:+editData.peso_neto_kg,peso_bruto_entrada:+editData.peso_bruto_entrada,peso_bruto_salida:+editData.peso_bruto_salida};
    const newUf={...r.uf,gen:editData.gen,gest:editData.gest,tipo:editData.tipo};
    if(newUf.gen&&!gens.includes(newUf.gen)){const u=[...gens,newUf.gen];saveGens(u);}
    if(newUf.gest&&!gests.includes(newUf.gest)){const u=[...gests,newUf.gest];saveGest(u);}
    const u=sortR(recs.map(x=>x.id===id?{...x,extracted:newExt,uf:newUf,history:[...(x.history||[]),entry]}:x));
    saveRecs(u);setEditing(null);
  },[recs,editData,gens,gests,sortR,saveRecs,saveGens,saveGest]);

  const del=useCallback(id=>{
    const r=recs.find(x=>x.id===id);const u=recs.filter(x=>x.id!==id);saveRecs(u);
    if(r){const nh=new Set(hashes);nh.delete(r.fh);saveHash(nh);}
    if(sel===id)setSel(null);if(editing===id)setEditing(null);
  },[recs,hashes,sel,editing,saveRecs,saveHash]);

  const reset=useCallback(()=>{if(!confirm('Eliminar TODOS los registros?'))return;saveRecs([]);saveHash(new Set());setSel(null);setEditing(null);},[saveRecs,saveHash]);

  const dfP=dateFrom?new Date(dateFrom+'T00:00:00'):null;
  const dtP=dateTo?new Date(dateTo+'T23:59:59'):null;
  const vis=recs.filter(r=>{if(r.st==='duplicado')return false;if(filt!=='all'&&r.st!==filt)return false;if(!inRange(r,dfP,dtP))return false;return true;});
  const conf=recs.filter(r=>r.st==='confirmado');
  const confR=conf.filter(r=>inRange(r,dfP,dtP));
  const rangeKg=confR.reduce((s,r)=>s+(r.extracted?.peso_neto_kg||0),0);
  const totalKg=conf.reduce((s,r)=>s+(r.extracted?.peso_neto_kg||0),0);
  const pend=recs.filter(r=>r.st==='extraido').length;
  const cur=recs.find(r=>r.id===sel);
  const canC=r=>{if(!r?.uf)return false;const t=r.uf.tipo;if(t==='gestor_generador')return!!(r.uf.gen&&r.uf.gest);if(t==='solo_generador')return!!r.uf.gen;if(t==='solo_gestor')return!!r.uf.gest;return false;};

  const genRank={};const gestRank={};
  confR.forEach(r=>{const kg=r.extracted?.peso_neto_kg||0;if(r.uf?.gen){genRank[r.uf.gen]=(genRank[r.uf.gen]||0)+kg;}if(r.uf?.gest){gestRank[r.uf.gest]=(gestRank[r.uf.gest]||0)+kg;}});
  const genS=Object.entries(genRank).sort((a,b)=>b[1]-a[1]);
  const gestS=Object.entries(gestRank).sort((a,b)=>b[1]-a[1]);
  const mxG=genS[0]?genS[0][1]:1;const mxT=gestS[0]?gestS[0][1]:1;

  if(!loaded)return<div style={{minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center'}}><div style={{color:'#52b788'}}>Cargando...</div></div>;

  const inp={width:'100%',padding:'8px 10px',fontSize:13,background:'rgba(0,0,0,0.3)',border:'1px solid rgba(255,255,255,0.1)',borderRadius:6,color:'#dde8dd',outline:'none',fontFamily:'inherit'};
  const lbl={fontSize:10,color:'#4a6b56',textTransform:'uppercase',letterSpacing:.4,marginBottom:3,fontWeight:600};
  const inpSm={...inp,fontSize:12,padding:'6px 8px'};

  return(
    <div style={{fontFamily:"'DM Sans',sans-serif",background:'linear-gradient(170deg,#070d09,#0d1a12 40%,#12261a)',minHeight:'100vh',color:'#cddccd'}}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,700&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet"/>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}@keyframes fadeUp{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:translateY(0)}}input::placeholder{color:#3a5444}::-webkit-scrollbar{width:5px}::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.05);border-radius:3px}
        @media(max-width:768px){.stats-grid{grid-template-columns:repeat(2,1fr)!important}.records-layout{flex-direction:column!important}.records-list{flex:1!important;max-height:none!important}.detail-panel{position:static!important;max-height:none!important}.info-grid{grid-template-columns:1fr!important}.tipo-btns{flex-direction:column!important}.filter-bar{flex-direction:column!important;align-items:stretch!important}.rankings{grid-template-columns:1fr!important}}`}</style>

      {/* HEADER */}
      <header style={{borderBottom:'1px solid rgba(255,255,255,0.04)',padding:'12px 16px',display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:8}}>
        <div style={{display:'flex',alignItems:'center',gap:10}}>
          <div style={{width:34,height:34,borderRadius:8,background:'linear-gradient(135deg,#2d6a4f,#52b788)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:15,fontWeight:700,color:'#fff'}}>R</div>
          <div><div style={{fontSize:15,fontWeight:700}}>Romana</div><div style={{fontSize:10,color:'#3f5e4c'}}>REGISTRO ROMANA - POLPAICO</div></div>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:6}}>
          <a href={DRIVE_URL} target="_blank" rel="noopener noreferrer" style={{fontSize:10,padding:'5px 10px',background:'rgba(82,183,136,0.06)',color:'#52b788',border:'1px solid rgba(82,183,136,0.12)',borderRadius:5,textDecoration:'none'}}>Carpeta Drive</a>
          <button onClick={reset} style={{fontSize:10,padding:'5px 10px',background:'rgba(255,60,60,0.05)',color:'#ff6b6b',border:'1px solid rgba(255,60,60,0.1)',borderRadius:5,cursor:'pointer'}}>Reset</button>
        </div>
      </header>

      {/* STATS */}
      <div className="stats-grid" style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',borderBottom:'1px solid rgba(255,255,255,0.03)',background:'rgba(0,0,0,0.1)'}}>
        {[{l:'Confirmados',v:conf.length,u:'',c:'#52b788'},{l:'Total general',v:(totalKg/1000).toFixed(3),u:' ton',c:'#40916c'},{l:(dateFrom||dateTo)?'Periodo filtrado':'Periodo',v:(dateFrom||dateTo)?(rangeKg/1000).toFixed(3):'todos',u:(dateFrom||dateTo)?' ton':'',c:'#e9c46a'},{l:'Pendientes',v:pend,u:'',c:pend>0?'#e76f51':'#3f5e4c'}].map((s,i)=>(
          <div key={i} style={{padding:'10px 12px',textAlign:'center'}}>
            <div style={{fontSize:9,color:'#3f5e4c',textTransform:'uppercase',letterSpacing:.4}}>{s.l}</div>
            <div style={{fontSize:17,fontWeight:700,color:s.c,fontFamily:"'JetBrains Mono',monospace",marginTop:2}}>{s.v}{s.u}</div>
          </div>
        ))}
      </div>

      {/* TABS + FILTERS */}
      <div style={{padding:'0 16px',borderBottom:'1px solid rgba(255,255,255,0.03)'}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:6}}>
          <div style={{display:'flex'}}>
            {[{k:'upload',l:'Subir PDFs'},{k:'records',l:`Registros (${vis.length})`},{k:'rankings',l:'Rankings'}].map(t=>(
              <button key={t.k} onClick={()=>setTab(t.k)} style={{padding:'10px 14px',fontSize:12,fontWeight:tab===t.k?700:400,color:tab===t.k?'#52b788':'#3f5e4c',background:'transparent',border:'none',borderBottom:tab===t.k?'2px solid #52b788':'2px solid transparent',cursor:'pointer'}}>{t.l}</button>
            ))}
          </div>
          {(tab==='records'||tab==='rankings')&&(
            <div className="filter-bar" style={{display:'flex',gap:6,alignItems:'center',padding:'6px 0',flexWrap:'wrap'}}>
              <div style={{display:'flex',alignItems:'center',gap:4}}><span style={{fontSize:10,color:'#3f5e4c'}}>Desde</span><input type="date" value={dateFrom} onChange={e=>setDateFrom(e.target.value)} style={{...inpSm,width:'auto',padding:'4px 6px',fontSize:10}}/></div>
              <div style={{display:'flex',alignItems:'center',gap:4}}><span style={{fontSize:10,color:'#3f5e4c'}}>Hasta</span><input type="date" value={dateTo} onChange={e=>setDateTo(e.target.value)} style={{...inpSm,width:'auto',padding:'4px 6px',fontSize:10}}/></div>
              {(dateFrom||dateTo)&&<button onClick={()=>{setDateFrom('');setDateTo('');}} style={{fontSize:9,padding:'3px 8px',background:'rgba(255,255,255,0.05)',color:'#6b8f7b',border:'1px solid rgba(255,255,255,0.08)',borderRadius:4,cursor:'pointer'}}>Limpiar</button>}
              {tab==='records'&&<select value={filt} onChange={e=>setFilt(e.target.value)} style={{...inpSm,width:'auto',padding:'4px 6px',fontSize:10}}><option value="all">Todos</option><option value="extraido">Pendientes</option><option value="confirmado">Confirmados</option><option value="error">Errores</option></select>}
            </div>
          )}
        </div>
      </div>

      <main style={{padding:16,maxWidth:1200,margin:'0 auto'}}>

        {/* UPLOAD */}
        {tab==='upload'&&(
          <div style={{animation:'fadeUp .2s ease'}}>
            <div onDrop={onDrop} onDragOver={e=>{e.preventDefault();setDrag(true);}} onDragLeave={()=>setDrag(false)} onClick={()=>fRef.current?.click()} style={{border:`2px dashed ${drag?'#52b788':'rgba(255,255,255,0.07)'}`,borderRadius:14,padding:'48px 24px',textAlign:'center',cursor:'pointer',background:drag?'rgba(82,183,136,0.04)':'rgba(255,255,255,0.01)',transition:'all .2s'}}>
              <input ref={fRef} type="file" accept=".pdf" multiple onChange={e=>handleFiles(e.target.files)} style={{display:'none'}}/>
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#52b788" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{opacity:.4,marginBottom:12}}><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
              <div style={{fontSize:16,fontWeight:600,marginBottom:4}}>Arrastra tickets de pesaje aqui</div>
              <div style={{fontSize:13,color:'#3f5e4c'}}>o toca para seleccionar archivos PDF</div>
              <div style={{fontSize:11,color:'#2d4a38',marginTop:10}}>Multiples archivos — duplicados se detectan sin gastar API</div>
            </div>
            <div className="info-grid" style={{marginTop:16,display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
              <div style={{background:'rgba(255,255,255,0.015)',border:'1px solid rgba(255,255,255,0.04)',borderRadius:10,padding:'14px 16px'}}>
                <div style={{fontSize:11,fontWeight:700,color:'#52b788',marginBottom:8}}>Como funciona</div>
                <div style={{fontSize:12,color:'#4a6b56',lineHeight:1.8}}>1. Sube PDFs de tickets de pesaje<br/>2. Claude AI extrae los datos automaticamente<br/>3. Asignas Generador y/o Gestor<br/>4. Confirmas y queda listo para planilla<br/><span style={{color:'#e9c46a',fontSize:11}}>Puedes editar registros confirmados. Cada cambio queda en el historial.</span></div>
              </div>
              <div style={{background:'rgba(82,183,136,0.03)',border:'1px solid rgba(82,183,136,0.08)',borderRadius:10,padding:'14px 16px'}}>
                <div style={{fontSize:11,fontWeight:700,color:'#40916c',marginBottom:8}}>Columnas en planilla</div>
                <div style={{fontSize:10,color:'#4a7a5a',fontFamily:"'JetBrains Mono',monospace",lineHeight:1.8}}>A:FECHA B:HORA ENT C:HORA SAL<br/>D:N°INFORME E:PATENTE F:CONDUCTOR<br/>G:GENERADOR H:GESTOR I:TIPO RESIDUO<br/>J:BRUTO ENT K:BRUTO SAL L:NETO KG<br/>M:NETO TON N:EMP.GENERADORA O:EMP.GESTORA</div>
              </div>
            </div>
          </div>
        )}

        {/* RECORDS */}
        {tab==='records'&&(
          <div className="records-layout" style={{display:'flex',gap:14,animation:'fadeUp .2s ease'}}>
            <div className="records-list" style={{flex:sel?'0 0 380px':'1',display:'flex',flexDirection:'column',gap:4,maxHeight:'calc(100vh - 280px)',overflowY:'auto',paddingRight:4}}>
              {vis.length===0&&<div style={{textAlign:'center',padding:30,color:'#3f5e4c',fontSize:12}}>{recs.length===0?'Sin registros. Sube tickets en "Subir PDFs".':'Sin resultados con estos filtros.'}</div>}
              {vis.map(r=>(
                <div key={r.id} onClick={()=>{if(r.st!=='procesando'){setSel(r.id);setEditing(null);}}} style={{background:sel===r.id?'rgba(82,183,136,0.05)':'rgba(255,255,255,0.015)',border:`1px solid ${sel===r.id?'rgba(82,183,136,0.15)':'rgba(255,255,255,0.04)'}`,borderRadius:8,padding:'10px 12px',cursor:r.st==='procesando'?'default':'pointer',transition:'all .12s',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:3,flexWrap:'wrap'}}>
                      <span style={{fontSize:12,fontWeight:600,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{r.extracted?.informe_n?`#${r.extracted.informe_n}`:r.fn}</span>
                      <Badge s={editing===r.id?'editando':r.st}/>
                      {r.history&&r.history.length>0&&<span style={{fontSize:8,color:'#e9c46a',background:'rgba(233,196,106,0.1)',padding:'1px 5px',borderRadius:3}}>editado {r.history.length}x</span>}
                    </div>
                    <div style={{fontSize:10,color:'#4a6b56',display:'flex',gap:10,flexWrap:'wrap'}}>
                      {r.extracted&&<><span>{r.extracted.fecha}</span><span>{r.extracted.patente}</span><span style={{fontFamily:"'JetBrains Mono',monospace",color:'#52b788',fontWeight:600}}>{(r.extracted.peso_neto_kg||0).toLocaleString('es-CL')} kg</span>{r.uf?.gen&&<span style={{color:'#40916c'}}>{r.uf.gen}</span>}{r.uf?.gest&&<span style={{color:'#4a7a5a'}}>{r.uf.gest}</span>}</>}
                      {r.st==='error'&&<span style={{color:'#ff6b6b'}}>{r.err}</span>}
                    </div>
                  </div>
                  <button onClick={e=>{e.stopPropagation();del(r.id);}} style={{background:'none',border:'none',color:'#2d4a38',cursor:'pointer',fontSize:16,padding:'2px 6px',borderRadius:4,flexShrink:0}}>×</button>
                </div>
              ))}
            </div>

            {/* DETAIL */}
            {sel&&cur&&cur.extracted&&(
              <div className="detail-panel" style={{flex:1,background:'rgba(255,255,255,0.015)',border:'1px solid rgba(255,255,255,0.05)',borderRadius:12,padding:16,position:'sticky',top:16,maxHeight:'calc(100vh - 280px)',overflowY:'auto'}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14,flexWrap:'wrap',gap:6}}>
                  <div style={{fontSize:15,fontWeight:700}}>Informe #{cur.extracted.informe_n}</div>
                  <div style={{display:'flex',gap:6,alignItems:'center'}}>
                    <Badge s={editing===cur.id?'editando':cur.st}/>
                    {cur.st==='confirmado'&&editing!==cur.id&&<button onClick={()=>startEdit(cur.id)} style={{fontSize:10,padding:'3px 8px',background:'rgba(233,196,106,0.08)',color:'#e9c46a',border:'1px solid rgba(233,196,106,0.15)',borderRadius:4,cursor:'pointer'}}>Editar</button>}
                    <button onClick={()=>{setSel(null);setEditing(null);}} style={{background:'none',border:'none',color:'#3f5e4c',cursor:'pointer',fontSize:18}}>×</button>
                  </div>
                </div>

                {editing!==cur.id?(
                  <>
                    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'8px 14px',marginBottom:14}}>
                      {[['Fecha',cur.extracted.fecha],['Patente',cur.extracted.patente],['Conductor',cur.extracted.conductor],['Tipo residuo',cur.extracted.observaciones],['Hora entrada',timeFrom(cur.extracted.fecha_hora_entrada)],['Hora salida',timeFrom(cur.extracted.fecha_hora_salida)],['Ticket entrada',cur.extracted.numero_ticket_entrada],['Ticket salida',cur.extracted.numero_ticket_salida],['Bruto entrada',`${(cur.extracted.peso_bruto_entrada||0).toLocaleString('es-CL')} kg`],['Bruto salida',`${(cur.extracted.peso_bruto_salida||0).toLocaleString('es-CL')} kg`]].map(([l,v],i)=>(
                        <div key={i}><div style={lbl}>{l}</div><div style={{fontSize:13,fontWeight:500}}>{v||'—'}</div></div>
                      ))}
                    </div>
                    <div style={{background:'rgba(82,183,136,0.05)',border:'1px solid rgba(82,183,136,0.1)',borderRadius:8,padding:'12px 14px',display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14}}>
                      <div><div style={lbl}>Peso neto</div><div style={{fontSize:22,fontWeight:700,color:'#52b788',fontFamily:"'JetBrains Mono',monospace"}}>{(cur.extracted.peso_neto_kg||0).toLocaleString('es-CL')} kg</div></div>
                      <div style={{textAlign:'right'}}><div style={lbl}>Toneladas</div><div style={{fontSize:18,fontWeight:600,color:'#40916c',fontFamily:"'JetBrains Mono',monospace"}}>{((cur.extracted.peso_neto_kg||0)/1000).toFixed(3)}</div></div>
                    </div>
                    <div style={{background:'rgba(233,196,106,0.04)',border:'1px solid rgba(233,196,106,0.1)',borderRadius:7,padding:'9px 12px',marginBottom:14}}>
                      <div style={{fontSize:9,color:'#b89a3a',textTransform:'uppercase',marginBottom:3}}>Empresa (del PDF)</div>
                      <div style={{fontSize:14,fontWeight:600,color:'#e9c46a'}}>{cur.extracted.empresa_raw}</div>
                      <div style={{fontSize:10,color:'#6a5a2a',marginTop:2}}>Puede contener gestor + generador juntos</div>
                    </div>

                    {cur.st!=='confirmado'&&(
                      <div style={{borderTop:'1px solid rgba(255,255,255,0.04)',paddingTop:14}}>
                        <div style={{fontSize:12,fontWeight:700,color:'#6aaa88',marginBottom:10}}>Asignar generador / gestor</div>
                        <div className="tipo-btns" style={{display:'flex',gap:4,marginBottom:12}}>
                          {[{k:'gestor_generador',l:'Gestor + Generador'},{k:'solo_generador',l:'Solo Generador'},{k:'solo_gestor',l:'Solo Gestor'}].map(o=>(
                            <button key={o.k} onClick={()=>updUF(cur.id,{tipo:o.k})} style={{flex:1,padding:'8px 6px',fontSize:11,fontWeight:cur.uf?.tipo===o.k?700:400,background:cur.uf?.tipo===o.k?'rgba(82,183,136,0.1)':'rgba(255,255,255,0.02)',color:cur.uf?.tipo===o.k?'#52b788':'#3f5e4c',border:`1px solid ${cur.uf?.tipo===o.k?'rgba(82,183,136,0.2)':'rgba(255,255,255,0.04)'}`,borderRadius:6,cursor:'pointer'}}>{o.l}</button>
                          ))}
                        </div>
                        {cur.uf?.tipo!=='solo_gestor'&&<div style={{marginBottom:10}}><div style={lbl}>GENERADOR → Col G + N</div><input list="dlg" value={cur.uf?.gen||''} onChange={e=>updUF(cur.id,{gen:e.target.value.toUpperCase()})} placeholder="Ej: COCA COLA" style={inp}/><datalist id="dlg">{gens.map(g=><option key={g} value={g}/>)}</datalist></div>}
                        {cur.uf?.tipo!=='solo_generador'&&<div style={{marginBottom:14}}><div style={lbl}>GESTOR → Col H + O</div><input list="dlt" value={cur.uf?.gest||''} onChange={e=>updUF(cur.id,{gest:e.target.value.toUpperCase()})} placeholder="Ej: ECORILES" style={inp}/><datalist id="dlt">{gests.map(g=><option key={g} value={g}/>)}</datalist></div>}
                        <button onClick={()=>doConfirm(cur.id)} disabled={!canC(cur)} style={{width:'100%',padding:'12px',fontSize:14,fontWeight:700,background:canC(cur)?'linear-gradient(135deg,#2d6a4f,#40916c)':'rgba(255,255,255,0.03)',color:canC(cur)?'#fff':'#2d4a38',border:'none',borderRadius:8,cursor:canC(cur)?'pointer':'default',opacity:canC(cur)?1:.4}}>Confirmar registro</button>
                      </div>
                    )}

                    {cur.st==='confirmado'&&editing!==cur.id&&(
                      <div style={{background:'rgba(82,183,136,0.06)',borderRadius:8,padding:'12px 16px',textAlign:'center'}}>
                        <div style={{fontSize:13,fontWeight:600,color:'#52b788'}}>Registro confirmado</div>
                        <div style={{fontSize:11,color:'#3f5e4c',marginTop:4}}>{cur.uf?.gen&&`Generador: ${cur.uf.gen}`}{cur.uf?.gen&&cur.uf?.gest&&' — '}{cur.uf?.gest&&`Gestor: ${cur.uf.gest}`}</div>
                      </div>
                    )}
                  </>
                ):(
                  <div style={{animation:'fadeUp .15s ease'}}>
                    <div style={{background:'rgba(233,196,106,0.06)',border:'1px solid rgba(233,196,106,0.12)',borderRadius:8,padding:'8px 12px',marginBottom:14,fontSize:11,color:'#e9c46a'}}>Modo edicion — los cambios quedan en el historial</div>
                    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'8px 12px',marginBottom:14}}>
                      <div><div style={lbl}>Fecha</div><input value={editData.fecha||''} onChange={e=>setEditData(p=>({...p,fecha:e.target.value}))} style={inpSm}/></div>
                      <div><div style={lbl}>Patente</div><input value={editData.patente||''} onChange={e=>setEditData(p=>({...p,patente:e.target.value}))} style={inpSm}/></div>
                      <div><div style={lbl}>Conductor</div><input value={editData.conductor||''} onChange={e=>setEditData(p=>({...p,conductor:e.target.value}))} style={inpSm}/></div>
                      <div><div style={lbl}>Tipo residuo</div><input value={editData.observaciones||''} onChange={e=>setEditData(p=>({...p,observaciones:e.target.value}))} style={inpSm}/></div>
                      <div><div style={lbl}>Peso neto (KG)</div><input type="number" value={editData.peso_neto_kg||0} onChange={e=>setEditData(p=>({...p,peso_neto_kg:e.target.value}))} style={inpSm}/></div>
                      <div><div style={lbl}>Bruto entrada (KG)</div><input type="number" value={editData.peso_bruto_entrada||0} onChange={e=>setEditData(p=>({...p,peso_bruto_entrada:e.target.value}))} style={inpSm}/></div>
                      <div><div style={lbl}>Bruto salida (KG)</div><input type="number" value={editData.peso_bruto_salida||0} onChange={e=>setEditData(p=>({...p,peso_bruto_salida:e.target.value}))} style={inpSm}/></div>
                    </div>
                    <div className="tipo-btns" style={{display:'flex',gap:4,marginBottom:10}}>
                      {[{k:'gestor_generador',l:'Gestor + Generador'},{k:'solo_generador',l:'Solo Generador'},{k:'solo_gestor',l:'Solo Gestor'}].map(o=>(
                        <button key={o.k} onClick={()=>setEditData(p=>({...p,tipo:o.k}))} style={{flex:1,padding:'7px 4px',fontSize:10,fontWeight:editData.tipo===o.k?700:400,background:editData.tipo===o.k?'rgba(82,183,136,0.1)':'rgba(255,255,255,0.02)',color:editData.tipo===o.k?'#52b788':'#3f5e4c',border:`1px solid ${editData.tipo===o.k?'rgba(82,183,136,0.2)':'rgba(255,255,255,0.04)'}`,borderRadius:5,cursor:'pointer'}}>{o.l}</button>
                      ))}
                    </div>
                    {editData.tipo!=='solo_gestor'&&<div style={{marginBottom:8}}><div style={lbl}>GENERADOR</div><input list="dlge" value={editData.gen||''} onChange={e=>setEditData(p=>({...p,gen:e.target.value.toUpperCase()}))} style={inpSm}/><datalist id="dlge">{gens.map(g=><option key={g} value={g}/>)}</datalist></div>}
                    {editData.tipo!=='solo_generador'&&<div style={{marginBottom:12}}><div style={lbl}>GESTOR</div><input list="dlte" value={editData.gest||''} onChange={e=>setEditData(p=>({...p,gest:e.target.value.toUpperCase()}))} style={inpSm}/><datalist id="dlte">{gests.map(g=><option key={g} value={g}/>)}</datalist></div>}
                    <div style={{display:'flex',gap:8}}>
                      <button onClick={()=>saveEdit(cur.id)} style={{flex:1,padding:'10px',fontSize:13,fontWeight:700,background:'linear-gradient(135deg,#2d6a4f,#40916c)',color:'#fff',border:'none',borderRadius:7,cursor:'pointer'}}>Guardar cambios</button>
                      <button onClick={()=>{setEditing(null);setEditData({});}} style={{padding:'10px 16px',fontSize:13,background:'rgba(255,255,255,0.04)',color:'#6b8f7b',border:'1px solid rgba(255,255,255,0.08)',borderRadius:7,cursor:'pointer'}}>Cancelar</button>
                    </div>
                  </div>
                )}

                {cur.history&&cur.history.length>0&&(
                  <div style={{marginTop:14,borderTop:'1px solid rgba(255,255,255,0.04)',paddingTop:12}}>
                    <div style={{fontSize:10,fontWeight:700,color:'#e9c46a',marginBottom:8}}>Historial de ediciones ({cur.history.length})</div>
                    <div style={{maxHeight:160,overflowY:'auto'}}>
                      {[...cur.history].reverse().map((h,i)=>(
                        <div key={i} style={{background:'rgba(233,196,106,0.04)',border:'1px solid rgba(233,196,106,0.08)',borderRadius:6,padding:'8px 10px',marginBottom:6}}>
                          <div style={{fontSize:9,color:'#8a7a3a',marginBottom:4}}>{h.date}</div>
                          {h.changes.map((c,j)=><div key={j} style={{fontSize:10,color:'#c4a84a',lineHeight:1.5}}>{c}</div>)}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* RANKINGS */}
        {tab==='rankings'&&(
          <div style={{animation:'fadeUp .2s ease'}}>
            {(dateFrom||dateTo)&&<div style={{fontSize:11,color:'#6b8f7b',marginBottom:12}}>Periodo: {dateFrom||'inicio'} al {dateTo||'hoy'} — {confR.length} registros, {(rangeKg/1000).toFixed(3)} ton</div>}
            {confR.length===0&&<div style={{textAlign:'center',padding:30,color:'#3f5e4c',fontSize:12}}>Sin registros confirmados{(dateFrom||dateTo)?' en este rango':''} para mostrar rankings.</div>}
            {confR.length>0&&(
              <div className="rankings" style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16}}>
                <div style={{background:'rgba(255,255,255,0.015)',border:'1px solid rgba(255,255,255,0.04)',borderRadius:12,padding:16}}>
                  <div style={{fontSize:13,fontWeight:700,color:'#52b788',marginBottom:14}}>Generadores por toneladas</div>
                  {genS.length===0&&<div style={{fontSize:11,color:'#3f5e4c'}}>Sin datos</div>}
                  {genS.map(([name,kg],i)=>(
                    <div key={name} style={{marginBottom:12}}>
                      <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',marginBottom:4}}>
                        <div style={{display:'flex',alignItems:'center',gap:8}}>
                          <span style={{fontSize:14,fontWeight:700,color:'#52b788',fontFamily:"'JetBrains Mono',monospace",width:22,textAlign:'right'}}>{i+1}</span>
                          <span style={{fontSize:13,fontWeight:600}}>{name}</span>
                        </div>
                        <span style={{fontSize:13,fontWeight:600,color:'#52b788',fontFamily:"'JetBrains Mono',monospace"}}>{(kg/1000).toFixed(3)} ton</span>
                      </div>
                      <div style={{height:8,background:'rgba(255,255,255,0.04)',borderRadius:4,overflow:'hidden'}}>
                        <div style={{height:'100%',width:`${(kg/mxG)*100}%`,background:'linear-gradient(90deg,#2d6a4f,#52b788)',borderRadius:4,transition:'width .3s'}}/>
                      </div>
                      <div style={{fontSize:9,color:'#3f5e4c',marginTop:2}}>{kg.toLocaleString('es-CL')} kg — {confR.filter(r=>r.uf?.gen===name).length} viajes</div>
                    </div>
                  ))}
                </div>
                <div style={{background:'rgba(255,255,255,0.015)',border:'1px solid rgba(255,255,255,0.04)',borderRadius:12,padding:16}}>
                  <div style={{fontSize:13,fontWeight:700,color:'#40916c',marginBottom:14}}>Gestores por toneladas</div>
                  {gestS.length===0&&<div style={{fontSize:11,color:'#3f5e4c'}}>Sin datos</div>}
                  {gestS.map(([name,kg],i)=>(
                    <div key={name} style={{marginBottom:12}}>
                      <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',marginBottom:4}}>
                        <div style={{display:'flex',alignItems:'center',gap:8}}>
                          <span style={{fontSize:14,fontWeight:700,color:'#40916c',fontFamily:"'JetBrains Mono',monospace",width:22,textAlign:'right'}}>{i+1}</span>
                          <span style={{fontSize:13,fontWeight:600}}>{name}</span>
                        </div>
                        <span style={{fontSize:13,fontWeight:600,color:'#40916c',fontFamily:"'JetBrains Mono',monospace"}}>{(kg/1000).toFixed(3)} ton</span>
                      </div>
                      <div style={{height:8,background:'rgba(255,255,255,0.04)',borderRadius:4,overflow:'hidden'}}>
                        <div style={{height:'100%',width:`${(kg/mxT)*100}%`,background:'linear-gradient(90deg,#1a5a3a,#40916c)',borderRadius:4,transition:'width .3s'}}/>
                      </div>
                      <div style={{fontSize:9,color:'#3f5e4c',marginTop:2}}>{kg.toLocaleString('es-CL')} kg — {confR.filter(r=>r.uf?.gest===name).length} viajes</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
