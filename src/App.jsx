import { useState, useEffect, useRef } from "react";

// ─── CONFIG — fill in your keys here ─────────────────────────────────────────
const SUPABASE_URL = "https://YOUR_PROJECT.supabase.co";
const SUPABASE_ANON_KEY = "YOUR_SUPABASE_PUBLISHABLE_KEY";
const ANTHROPIC_API_KEY = "YOUR_ANTHROPIC_API_KEY";
// ─── SUPABASE HELPERS ─────────────────────────────────────────────────────────
async function dbFetch(path, opts = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: {
      "apikey": SUPABASE_ANON_KEY,
      "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
      "Prefer": opts.prefer || "",
      ...(opts.headers || {}),
    },
  });
  if (!res.ok) throw new Error(await res.text());
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function getSops() {
  return await dbFetch("sops?order=created_at.desc&select=*") || [];
}

async function insertSop(sop) {
  return await dbFetch("sops", {
    method: "POST",
    prefer: "return=representation",
    body: JSON.stringify(sop),
  });
}

async function deleteSop(id) {
  return await dbFetch(`sops?id=eq.${id}`, { method: "DELETE" });
}

// ─── CLAUDE HELPERS ───────────────────────────────────────────────────────────
async function callClaude(messages, systemPrompt) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-calls": "true",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      system: systemPrompt,
      messages,
    }),
  });
  const data = await res.json();
  return data.content?.[0]?.text || "";
}

const SOP_SYSTEM = `You are an IT documentation assistant for Lockbaud, an MSP.
Convert the user's raw description into a clean SOP.
Respond ONLY with a JSON object, no markdown, no backticks:
{
  "title": "short action-oriented title",
  "category": "one of: Network, Security, Helpdesk, Cloud, Hardware, Software, Account Management, Other",
  "tags": ["tag1","tag2","tag3"],
  "summary": "1-2 sentence summary",
  "steps": ["Step 1...","Step 2...","Step 3..."],
  "notes": "warnings, edge cases, or tips (empty string if none)"
}`;

const CHAT_SYSTEM = `You are Lockbaud Brain, an internal IT knowledge assistant for Lockbaud MSP.
SOPs in the knowledge base:
{SOPS}
Answer using the SOPs. Reference SOP titles when relevant. Be concise and practical.
If nothing matches, say so and suggest what info would help.`;

const CAT_COLORS = {
  Network:"#185FA5", Security:"#993556", Helpdesk:"#3B6D11",
  Cloud:"#0F6E56", Hardware:"#5F5E5A", Software:"#534AB7",
  "Account Management":"#854F0B", Other:"#888780"
};

const S = {
  wrap: { fontFamily:"sans-serif", maxWidth:820, margin:"0 auto", padding:"1rem" },
  nav: { display:"flex", gap:8, marginBottom:"1.5rem", borderBottom:"1px solid #e5e7eb", paddingBottom:"0.75rem" },
  tab: a => ({ background:a?"#f3f4f6":"transparent", border:"1px solid "+(a?"#d1d5db":"transparent"), borderRadius:8, padding:"6px 14px", fontSize:14, fontWeight:a?500:400, color:a?"#111827":"#6b7280", cursor:"pointer" }),
  card: { background:"#fff", border:"1px solid #e5e7eb", borderRadius:12, padding:"1rem 1.25rem", marginBottom:12 },
  label: { fontSize:12, color:"#6b7280", marginBottom:4, display:"block" },
  textarea: { width:"100%", minHeight:100, resize:"vertical", boxSizing:"border-box", border:"1px solid #d1d5db", borderRadius:8, padding:"8px 10px", fontSize:14, fontFamily:"sans-serif" },
  input: { width:"100%", boxSizing:"border-box", border:"1px solid #d1d5db", borderRadius:8, padding:"8px 10px", fontSize:14 },
  btn: { padding:"8px 18px", borderRadius:8, border:"1px solid #d1d5db", background:"transparent", color:"#111827", cursor:"pointer", fontSize:14, fontWeight:500 },
  btnPrimary: { padding:"8px 18px", borderRadius:8, border:"none", background:"#185FA5", color:"#fff", cursor:"pointer", fontSize:14, fontWeight:500 },
  tag: c => ({ display:"inline-block", background:c+"22", color:c, fontSize:11, padding:"2px 8px", borderRadius:20, marginRight:4, marginBottom:4 }),
  step: { fontSize:14, color:"#111827", marginBottom:8, paddingLeft:12, borderLeft:"2px solid #e5e7eb", lineHeight:1.6 },
  bubble: r => ({ alignSelf:r==="user"?"flex-end":"flex-start", background:r==="user"?"#dbeafe":"#f3f4f6", borderRadius:12, padding:"10px 14px", maxWidth:"80%", fontSize:14, lineHeight:1.6, color:"#111827", whiteSpace:"pre-wrap" }),
  metricRow: { display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:10, marginBottom:16 },
  metric: { background:"#f9fafb", borderRadius:8, padding:"0.75rem 1rem" },
};

export default function LockbaudBrain() {
  const [sops, setSops] = useState([]);
  const [view, setView] = useState("capture");
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [dbLoading, setDbLoading] = useState(true);
  const [dbError, setDbError] = useState(null);
  const [preview, setPreview] = useState(null);
  const [search, setSearch] = useState("");
  const [selectedSop, setSelectedSop] = useState(null);
  const [chatHistory, setChatHistory] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [author, setAuthor] = useState(() => localStorage.getItem("lb_author") || "");
  const [authorInput, setAuthorInput] = useState("");
  const chatEndRef = useRef(null);

  useEffect(() => { loadSops(); }, []);
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior:"smooth" }); }, [chatHistory]);

  async function loadSops() {
    setDbLoading(true); setDbError(null);
    try { setSops(await getSops()); }
    catch { setDbError("Could not connect to database. Check your Supabase config."); }
    setDbLoading(false);
  }

  function setAndSaveAuthor(name) {
    setAuthor(name);
    localStorage.setItem("lb_author", name);
  }

  async function handleGenerate() {
    if (!input.trim()) return;
    setLoading(true); setPreview(null);
    try {
      const raw = await callClaude([{ role:"user", content:input }], SOP_SYSTEM);
      const parsed = JSON.parse(raw.replace(/```json|```/g,"").trim());
      setPreview({ ...parsed });
    } catch { setPreview({ error:true }); }
    setLoading(false);
  }

  async function handleSave() {
    if (!preview || preview.error) return;
    try {
      await insertSop({ title:preview.title, category:preview.category, tags:preview.tags, summary:preview.summary, steps:preview.steps, notes:preview.notes, author:author||"unknown", created_at:new Date().toISOString() });
      await loadSops();
      setPreview(null); setInput(""); setView("library");
    } catch { alert("Save failed. Check Supabase config."); }
  }

  async function handleDelete(id) {
    try {
      await deleteSop(id);
      setSops(s => s.filter(x => x.id !== id));
      if (selectedSop?.id === id) setSelectedSop(null);
    } catch { alert("Delete failed."); }
  }

  const filtered = sops.filter(s => {
    const q = search.toLowerCase();
    return !q || s.title?.toLowerCase().includes(q) || s.tags?.some(t => t.includes(q)) || s.category?.toLowerCase().includes(q) || s.summary?.toLowerCase().includes(q);
  });

  async function handleChat() {
    if (!chatInput.trim()) return;
    const hist = [...chatHistory, { role:"user", content:chatInput }];
    setChatHistory(hist); setChatInput(""); setChatLoading(true);
    const ctx = sops.length ? JSON.stringify(sops.map(s => ({ title:s.title, category:s.category, tags:s.tags, summary:s.summary, steps:s.steps, notes:s.notes }))) : "No SOPs yet.";
    try {
      const reply = await callClaude(hist, CHAT_SYSTEM.replace("{SOPS}", ctx));
      setChatHistory([...hist, { role:"assistant", content:reply }]);
    } catch {
      setChatHistory([...hist, { role:"assistant", content:"API error. Try again." }]);
    }
    setChatLoading(false);
  }

  if (!author) return (
    <div style={{ maxWidth:400, margin:"2rem auto", fontFamily:"sans-serif" }}>
      <p style={{ fontSize:20, fontWeight:500, margin:"0 0 4px" }}>Lockbaud Brain</p>
      <p style={{ fontSize:13, color:"#6b7280", margin:"0 0 1.5rem" }}>Who are you? This helps tag your SOPs.</p>
      <input style={S.input} type="text" placeholder="Your name or initials" value={authorInput} onChange={e => setAuthorInput(e.target.value)} onKeyDown={e => e.key==="Enter" && authorInput.trim() && setAndSaveAuthor(authorInput.trim())} />
      <button style={{ ...S.btnPrimary, marginTop:10 }} onClick={() => authorInput.trim() && setAndSaveAuthor(authorInput.trim())}>Enter</button>
    </div>
  );

  const cats = [...new Set(sops.map(s => s.category))];

  return (
    <div style={S.wrap}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-end", marginBottom:"1.25rem" }}>
        <div>
          <p style={{ fontSize:20, fontWeight:500, margin:0 }}>Lockbaud Brain</p>
          <p style={{ fontSize:13, color:"#6b7280", margin:"2px 0 0" }}>Signed in as {author} · <span style={{ cursor:"pointer", textDecoration:"underline" }} onClick={() => setAndSaveAuthor("")}>switch</span></p>
        </div>
        <button style={S.btn} onClick={loadSops}>↻ Refresh</button>
      </div>

      <div style={S.nav}>
        {["capture","library","chat"].map(v => (
          <button key={v} style={S.tab(view===v)} onClick={() => { setView(v); setPreview(null); setSelectedSop(null); }}>
            {v==="capture"?"Capture SOP":v==="library"?`Library (${sops.length})`:"Ask Brain"}
          </button>
        ))}
      </div>

      {dbError && <div style={{ ...S.card, color:"#dc2626", fontSize:14 }}>{dbError}</div>}

      {view==="capture" && (
        <div>
          <div style={S.card}>
            <label style={S.label}>Describe what you just did — messy is fine</label>
            <textarea style={S.textarea} value={input} onChange={e => setInput(e.target.value)} placeholder="e.g. Client couldn't connect to mapped drives after password change. Logged in via Syncro, cleared cached credentials in Credential Manager, re-mapped drives. All good after reboot." />
            <div style={{ marginTop:10, display:"flex", gap:8 }}>
              <button style={S.btnPrimary} onClick={handleGenerate} disabled={loading||!input.trim()}>{loading?"Generating...":"Generate SOP →"}</button>
              {input && <button style={S.btn} onClick={() => { setInput(""); setPreview(null); }}>Clear</button>}
            </div>
          </div>
          {preview && !preview.error && (
            <div style={{ ...S.card, borderColor:"#3b82f6" }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:12 }}>
                <div>
                  <p style={{ margin:0, fontWeight:500, fontSize:16 }}>{preview.title}</p>
                  <span style={S.tag(CAT_COLORS[preview.category]||"#888")}>{preview.category}</span>
                </div>
                <div style={{ display:"flex", gap:8 }}>
                  <button style={S.btnPrimary} onClick={handleSave}>Save to Library</button>
                  <button style={S.btn} onClick={() => setPreview(null)}>Discard</button>
                </div>
              </div>
              <p style={{ fontSize:14, color:"#6b7280", marginBottom:12 }}>{preview.summary}</p>
              <div style={{ marginBottom:10 }}>{preview.tags?.map(t => <span key={t} style={S.tag("#5F5E5A")}>#{t}</span>)}</div>
              <p style={{ fontSize:12, fontWeight:500, color:"#6b7280", marginBottom:8 }}>STEPS</p>
              {preview.steps?.map((step,i) => <div key={i} style={S.step}><span style={{ color:"#9ca3af", marginRight:8 }}>{i+1}.</span>{step}</div>)}
              {preview.notes && <div style={{ marginTop:12, padding:"8px 12px", background:"#fffbeb", borderRadius:8, fontSize:13, color:"#92400e" }}>Note: {preview.notes}</div>}
            </div>
          )}
          {preview?.error && <div style={{ ...S.card, color:"#dc2626", fontSize:14 }}>Could not parse response. Try again.</div>}
        </div>
      )}

      {view==="library" && (
        <div>
          <div style={S.metricRow}>
            <div style={S.metric}><p style={{ fontSize:12, color:"#6b7280", margin:"0 0 2px" }}>Total SOPs</p><p style={{ fontSize:22, fontWeight:500, margin:0 }}>{sops.length}</p></div>
            <div style={S.metric}><p style={{ fontSize:12, color:"#6b7280", margin:"0 0 2px" }}>Categories</p><p style={{ fontSize:22, fontWeight:500, margin:0 }}>{cats.length}</p></div>
            <div style={S.metric}><p style={{ fontSize:12, color:"#6b7280", margin:"0 0 2px" }}>Your SOPs</p><p style={{ fontSize:22, fontWeight:500, margin:0 }}>{sops.filter(s=>s.author===author).length}</p></div>
          </div>
          <div style={{ display:"flex", gap:16 }}>
            <div style={{ width:selectedSop?260:"100%", flexShrink:0 }}>
              <input style={{ ...S.input, marginBottom:12 }} type="text" placeholder="Search keyword, tag, category..." value={search} onChange={e => setSearch(e.target.value)} />
              {dbLoading && <p style={{ fontSize:14, color:"#6b7280" }}>Loading...</p>}
              {!dbLoading && filtered.length===0 && <div style={{ ...S.card, textAlign:"center", color:"#6b7280", fontSize:14, padding:"2rem" }}>No SOPs yet.</div>}
              {filtered.map(sop => (
                <div key={sop.id} style={{ ...S.card, cursor:"pointer", borderColor:selectedSop?.id===sop.id?"#3b82f6":"#e5e7eb" }} onClick={() => setSelectedSop(sop)}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
                    <p style={{ margin:0, fontWeight:500, fontSize:14 }}>{sop.title}</p>
                    <span style={S.tag(CAT_COLORS[sop.category]||"#888")}>{sop.category}</span>
                  </div>
                  <p style={{ fontSize:13, color:"#6b7280", margin:"4px 0 6px" }}>{sop.summary}</p>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                    <div>{sop.tags?.map(t => <span key={t} style={S.tag("#888780")}>#{t}</span>)}</div>
                    <span style={{ fontSize:11, color:"#9ca3af" }}>{sop.author}</span>
                  </div>
                </div>
              ))}
            </div>
            {selectedSop && (
              <div style={{ flex:1 }}>
                <div style={S.card}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:12 }}>
                    <div>
                      <p style={{ margin:0, fontWeight:500, fontSize:16 }}>{selectedSop.title}</p>
                      <span style={S.tag(CAT_COLORS[selectedSop.category]||"#888")}>{selectedSop.category}</span>
                    </div>
                    <div style={{ display:"flex", gap:8 }}>
                      {selectedSop.author===author && <button style={{ ...S.btn, color:"#dc2626", borderColor:"#fca5a5" }} onClick={() => handleDelete(selectedSop.id)}>Delete</button>}
                      <button style={S.btn} onClick={() => setSelectedSop(null)}>✕</button>
                    </div>
                  </div>
                  <p style={{ fontSize:14, color:"#6b7280", marginBottom:12 }}>{selectedSop.summary}</p>
                  <div style={{ marginBottom:12 }}>{selectedSop.tags?.map(t => <span key={t} style={S.tag("#5F5E5A")}>#{t}</span>)}</div>
                  <p style={{ fontSize:12, fontWeight:500, color:"#6b7280", marginBottom:8 }}>STEPS</p>
                  {selectedSop.steps?.map((step,i) => <div key={i} style={S.step}><span style={{ color:"#9ca3af", marginRight:8 }}>{i+1}.</span>{step}</div>)}
                  {selectedSop.notes && <div style={{ marginTop:12, padding:"8px 12px", background:"#fffbeb", borderRadius:8, fontSize:13, color:"#92400e" }}>Note: {selectedSop.notes}</div>}
                  <p style={{ fontSize:12, color:"#9ca3af", marginTop:16 }}>By {selectedSop.author} · {new Date(selectedSop.created_at).toLocaleDateString()}</p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {view==="chat" && (
        <div>
          <div style={{ ...S.card, minHeight:320, display:"flex", flexDirection:"column", gap:10 }}>
            {chatHistory.length===0 && (
              <p style={{ fontSize:14, color:"#6b7280", textAlign:"center", margin:"auto" }}>
                {sops.length===0?"Add some SOPs first, then come back to ask questions.":`${sops.length} SOP${sops.length!==1?"s":""} loaded — ask anything.`}
              </p>
            )}
            {chatHistory.map((m,i) => <div key={i} style={{ display:"flex", flexDirection:"column" }}><div style={S.bubble(m.role)}>{m.content}</div></div>)}
            {chatLoading && <div style={{ ...S.bubble("assistant"), color:"#6b7280" }}>Thinking...</div>}
            <div ref={chatEndRef} />
          </div>
          <div style={{ display:"flex", gap:8, marginTop:8 }}>
            <input style={{ ...S.input, flex:1 }} type="text" placeholder="Ask about a procedure, client issue, tool..." value={chatInput} onChange={e => setChatInput(e.target.value)} onKeyDown={e => e.key==="Enter"&&!chatLoading&&handleChat()} />
            <button style={S.btnPrimary} onClick={handleChat} disabled={chatLoading||!chatInput.trim()}>Send</button>
          </div>
        </div>
      )}
    </div>
  );
}
