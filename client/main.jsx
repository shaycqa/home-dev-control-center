import React, { useState, useEffect, useRef, useCallback } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  FolderGit2,
  Radio,
  Files,
  TerminalSquare,
  Layers,
  Waypoints,
  ScrollText,
  Container,
  Server,
  Settings,
  ChevronRight,
  Plus,
  ExternalLink,
  Play,
  Square,
  RotateCw,
  Copy,
  Star,
  Search,
  ShieldCheck,
  Menu,
  Power,
  ArrowUpRight,
  Command,
  HardDrive,
  Cpu,
  MemoryStick,
  Thermometer,
  Wifi,
  X,
  Maximize,
  Minimize,
  Keyboard,
  LogOut,
} from "lucide-react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { Filemanager, WillowDark } from "@svar-ui/react-filemanager";
import "@svar-ui/react-filemanager/all.css";
import { EditorView, basicSetup } from "codemirror";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import "./style.css";
import "./filemanager-icons.css";
let csrf = "";
async function api(url, body) {
  const res = await fetch("/api" + url, {
    method: body === undefined ? "GET" : "POST",
    headers:
      body === undefined
        ? {}
        : { "Content-Type": "application/json", "X-CSRF-Token": csrf },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}
const bytes = (n) =>
  n == null
    ? "Unavailable"
    : n >= 1024 ** 3
      ? (n / 1024 ** 3).toFixed(1) + " GB"
      : n >= 1024 ** 2
        ? (n / 1024 ** 2).toFixed(0) + " MB"
        : n >= 1024
          ? (n / 1024).toFixed(1) + " KB"
          : Math.round(n) + " B";
const duration = (n) =>
  n < 60
    ? Math.round(n) + "s"
    : n < 3600
      ? Math.floor(n / 60) + "m"
      : n < 86400
        ? Math.floor(n / 3600) + "h " + Math.floor((n % 3600) / 60) + "m"
        : Math.floor(n / 86400) + "d " + Math.floor((n % 86400) / 3600) + "h";
const pct = (a, b) => (b ? (a / b) * 100 : 0);
const routes = [
  ["Dashboard", Activity],
  ["Projects", FolderGit2],
  ["Servers", Radio],
  ["Files", Files],
  ["Terminal", TerminalSquare],
  ["Sessions", Layers],
  ["Processes", Waypoints],
  ["Logs", ScrollText],
  ["Docker", Container],
  ["System", Server],
  ["Settings", Settings],
];
function Button({ children, onClick, kind = "", ...props }) {
  return (
    <button className={"btn " + kind} onClick={onClick} {...props}>
      {children}
    </button>
  );
}
function Badge({ children, kind = "" }) {
  return <span className={"badge " + kind}>{children}</span>;
}
function Empty({ children }) {
  return <div className="empty">{children}</div>;
}
function App() {
  const [unlocked, setUnlocked] = useState(false),
    [key, setKey] = useState(""),
    [error, setError] = useState(""),
    [state, setState] = useState(null),
    [view, setView] = useState("Dashboard"),
    [connected, setConnected] = useState(false),
    [notice, setNotice] = useState(""),
    [fileRoot, setFileRoot] = useState(""),
    [tabs, setTabs] = useState(() => {
      try {
        const t = JSON.parse(localStorage.getItem("hdc-tabs") || "[]");
        return Array.isArray(t) ? t : [];
      } catch {
        return [];
      }
    }),
    [active, setActive] = useState(null),
    [log, setLog] = useState({}),
    [detail, setDetail] = useState(null),
    [history, setHistory] = useState([]),
    [menu, setMenu] = useState(false);
  useEffect(() => {
    api("/session")
      .then((s) => {
        csrf = s.csrf;
        setUnlocked(true);
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (!unlocked) return;
    let stopped = false;
    api("/state")
      .then((s) => {
        if (!stopped) {
          setState(s);
          setFileRoot(s.config.roots[0]);
        }
      })
      .catch((e) => setError(e.message));
    const events = new EventSource("/api/events");
    events.onopen = () => setConnected(true);
    events.onerror = () => {
      setConnected(false);
      fetch("/api/session")
        .then((r) => {
          if (r.status === 401) {
            csrf = "";
            setUnlocked(false);
          }
        })
        .catch(() => {});
    };
    events.onmessage = (e) => {
      const s = JSON.parse(e.data);
      if (s.loading) return;
      setState((old) => (old?.config ? { ...old, ...s } : old));
      setHistory((h) => [...h.slice(-29), s.metrics?.cpu || 0]);
    };
    return () => {
      stopped = true;
      events.close();
    };
  }, [unlocked]);
  useEffect(() => {
    try {
      localStorage.setItem("hdc-tabs", JSON.stringify(tabs));
    } catch {}
  }, [tabs]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 6000);
    return () => clearTimeout(t);
  }, [notice]);
  async function act(fn) {
    try {
      return await fn();
    } catch (e) {
      setNotice(e.message);
    }
  }
  async function login(e) {
    e.preventDefault();
    try {
      const s = await api("/login", { key });
      csrf = s.csrf;
      setKey("");
      setUnlocked(true);
      setError("");
    } catch (e) {
      setError(e.message);
    }
  }
  function navigate(v) {
    setView(v);
    setMenu(false);
  }
  async function terminal(cwd, session) {
    const s =
      session ||
      (await api("/sessions", {
        cwd: cwd || state.config.roots[0],
        project: state.projects?.find((p) => p.path === cwd)?.path,
      }));
    setTabs((t) => (t.some((x) => x.id === s.id) ? t : [...t, s]));
    setActive(s.id);
    navigate("Terminal");
    return s;
  }
  function logs(params) {
    setLog(params);
    navigate("Logs");
  }
  async function openServer(s) {
    const w = window.open("about:blank", "_blank");
    try {
      const result = await api(`/process/${s.pid}/expose`, {
        start: s.start,
        port: s.port,
      });
      if (w) {
        w.opener = null;
        w.location = result.url;
      } else setNotice("Open URL: " + result.url);
    } catch (e) {
      w?.close();
      throw e;
    }
  }
  async function processAction(p, action) {
    if (
      !confirm(
        `${action === "kill" ? "Force kill" : action} ${p.name} (PID ${p.pid})?`,
      )
    )
      return;
    await api(`/process/${p.pid}/${action}`, { start: p.start, confirm: true });
    setNotice(`Process ${action} requested`);
  }
  async function runPreset(p) {
    if (p.confirm && !confirm(`Run ${p.label}?\n${p.command}`)) return;
    const useCurrent = p.target === "current" && active;
    const s = await api(`/presets/${p.id}/run`, {
      cwd:
        state.sessions?.find((s) => s.id === active)?.cwd ||
        fileRoot ||
        state.config.roots[0],
      session: useCurrent ? active : undefined,
      confirm: true,
    });
    await terminal(null, s);
  }
  const m = state?.metrics,
    projects = state?.projects || [],
    servers = state?.servers || [],
    sessions = state?.sessions || [];
  const actions = {
    act,
    terminal,
    logs,
    openServer,
    processAction,
    files: (p) => {
      setFileRoot(p);
      navigate("Files");
    },
    details: setDetail,
    navigate,
  };
  if (!unlocked)
    return (
      <main className="unlock">
        <div className="unlock-card">
          <div className="brand-symbol">
            <TerminalSquare />
          </div>
          <Badge kind="good">
            <ShieldCheck size={12} /> Private tailnet
          </Badge>
          <h1>
            Your machine.
            <br />
            Within reach.
          </h1>
          <p>Home Dev Control Center</p>
          <form onSubmit={login}>
            <label>
              Access key
              <input
                type="password"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                autoComplete="current-password"
                required
                placeholder="Enter your local access key"
              />
            </label>
            <Button kind="primary" type="submit">
              Unlock control center <ArrowUpRight size={16} />
            </Button>
          </form>
          {error && <p className="error">{error}</p>}
          <small>
            Tailscale identity + secure session
            <br />
            Only authorized devices can connect.
          </small>
        </div>
      </main>
    );
  return (
    <div className="shell">
      <aside className={menu ? "sidebar shown" : "sidebar"}>
        <div className="brand">
          <div className="brand-symbol">
            <TerminalSquare size={21} />
          </div>
          <div>
            Home Dev<span>CONTROL CENTER</span>
          </div>
        </div>
        <div className="nav-label">WORKSPACE</div>
        <nav>
          {routes.map(([v, Icon]) => (
            <button
              key={v}
              aria-label={v}
              className={view === v ? "nav-item active" : "nav-item"}
              onClick={() => navigate(v)}
            >
              <Icon size={18} />
              {v}
              {v === "Servers" && <span>{servers.length}</span>}
              {v === "Sessions" && <span>{sessions.length}</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <ShieldCheck size={16} />
          <div>
            Private connection<small>Tailscale · encrypted</small>
          </div>
          <span className="dot good" />
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <button
            className="mobile-menu icon-btn"
            aria-label="Navigation"
            onClick={() => setMenu(!menu)}
          >
            <Menu size={22} />
          </button>
          <div className="crumb">
            Workspace <ChevronRight size={14} />
            <strong>{view}</strong>
          </div>
          <div className="connection">
            <span className={"dot " + (connected ? "good" : "warn")} />
            {connected ? "Live" : "Reconnecting"}
            <span className="divider" />
            <ShieldCheck size={14} />
            <span className="tailnet-label">TAILNET</span>
          </div>
        </header>
        <main className="content">
          <div className="page-heading">
            <div>
              <div className="eyebrow">HOME DEV CONTROL CENTER</div>
              <h1>{view === "Dashboard" ? "Machine overview" : view}</h1>
              <p>
                {view === "Dashboard"
                  ? "Your development workspace, wherever you are."
                  : descriptions[view]}
              </p>
            </div>
            <Button kind="primary" onClick={() => act(() => terminal())}>
              <Plus size={16} /> New terminal
            </Button>
          </div>
          {!m ? (
            <Empty>Reading live machine state…</Empty>
          ) : (
            <>
              {view === "Dashboard" && (
                <>
                  <div className="health-banner">
                    <div
                      className={
                        "health-icon " +
                        (state.alerts?.some((a) => a.level === "critical")
                          ? "danger"
                          : state.alerts?.length
                            ? "warn"
                            : "good")
                      }
                    >
                      <Activity size={22} />
                    </div>
                    <div>
                      <strong>
                        {state.alerts?.some((a) => a.level === "critical")
                          ? "Machine needs attention"
                          : state.alerts?.length
                            ? "Running with warnings"
                            : "All systems healthy"}
                      </strong>
                      <span>
                        {m.hostname} <span className="muted">/</span> Linux
                        <span className="muted">/</span> Up {duration(m.uptime)}
                      </span>
                    </div>
                    <Badge
                      kind={
                        state.alerts?.some((a) => a.level === "critical")
                          ? "danger"
                          : state.alerts?.length
                            ? "warn"
                            : "good"
                      }
                    >
                      {state.alerts?.length
                        ? `${state.alerts.length} alert${state.alerts.length === 1 ? "" : "s"}`
                        : "Operational"}
                    </Badge>
                  </div>
                  {state.alerts?.map((a, i) => (
                    <div key={i} className={"alert " + a.level}>
                      {a.message}
                    </div>
                  ))}
                  <div className="metric-grid">
                    <Metric
                      title="CPU usage"
                      icon={Cpu}
                      value={
                        m.cpu === null ? "Sampling…" : m.cpu.toFixed(1) + "%"
                      }
                      sub={`${m.cores} logical cores · load ${m.load[0].toFixed(2)}`}
                      percent={m.cpu}
                      threshold={state.config.thresholds.cpu}
                      history={history}
                    />
                    <Metric
                      title="Memory"
                      icon={MemoryStick}
                      value={bytes(m.memory.used)}
                      sub={`of ${bytes(m.memory.total)} · ${pct(m.memory.used, m.memory.total).toFixed(0)}% used`}
                      percent={pct(m.memory.used, m.memory.total)}
                      threshold={state.config.thresholds.ram}
                    />
                    <Metric
                      title="CPU temperature"
                      icon={Thermometer}
                      value={
                        cpuTemperature(m) === null
                          ? "Unavailable"
                          : cpuTemperature(m) + "°C"
                      }
                      sub={
                        cpuTemperature(m) === null
                          ? "No CPU sensor available"
                          : "Live hardware sensor"
                      }
                      percent={cpuTemperature(m)}
                      threshold={state.config.thresholds.temperature}
                    />
                    <Metric
                      title="Disk usage"
                      icon={HardDrive}
                      value={pct(m.disk.used, m.disk.total).toFixed(0) + "%"}
                      sub={`${bytes(m.disk.available)} available of ${bytes(m.disk.total)}`}
                      percent={pct(m.disk.used, m.disk.total)}
                      threshold={state.config.thresholds.disk}
                    />
                  </div>
                  <div className="section-top">
                    <h2>Quick actions</h2>
                    <button
                      className="text-btn"
                      onClick={() => navigate("Settings")}
                    >
                      Customize <ChevronRight size={14} />
                    </button>
                  </div>
                  <div className="quick-grid">
                    {[
                      [TerminalSquare, "New terminal", () => terminal()],
                      [FolderGit2, "Open project", () => navigate("Projects")],
                      [Files, "Browse files", () => navigate("Files")],
                      [Layers, "Resume session", () => navigate("Sessions")],
                    ].map(([I, label, fn]) => (
                      <button
                        className="quick"
                        key={label}
                        onClick={() => act(fn)}
                      >
                        <I size={20} />
                        <span>{label}</span>
                        <ArrowUpRight size={15} />
                      </button>
                    ))}
                  </div>
                  <div className="favorite-row">
                    {state.presets
                      ?.filter((p) => state.config.favorites.includes(p.id))
                      .map((p) => (
                        <Button
                          key={p.id}
                          onClick={() => act(() => runPreset(p))}
                        >
                          <Star size={13} />
                          {p.label}
                        </Button>
                      ))}
                  </div>
                  <div className="dashboard-columns">
                    <section className="panel">
                      <div className="panel-heading">
                        <h2>
                          <Radio size={18} /> Development servers{" "}
                          <Badge>{servers.length}</Badge>
                        </h2>
                        <button
                          className="text-btn"
                          onClick={() => navigate("Servers")}
                        >
                          View all <ArrowUpRight size={14} />
                        </button>
                      </div>
                      {servers.length ? (
                        servers
                          .slice(0, 4)
                          .map((s) => (
                            <ServerCard key={s.id} s={s} actions={actions} />
                          ))
                      ) : (
                        <Empty>
                          No development servers running.
                          <br />
                          <button
                            className="text-btn"
                            onClick={() => navigate("Projects")}
                          >
                            Start one from a project <ArrowUpRight size={14} />
                          </button>
                        </Empty>
                      )}
                      <div className="panel-note">
                        <span className="dot good" /> Automatically discovers
                        servers started anywhere
                      </div>
                    </section>
                    <section className="panel">
                      <div className="panel-heading">
                        <h2>
                          <Layers size={18} /> Active sessions
                        </h2>
                        <button
                          className="text-btn"
                          onClick={() => navigate("Sessions")}
                        >
                          View all <ArrowUpRight size={14} />
                        </button>
                      </div>
                      {sessions.slice(0, 4).map((s) => (
                        <SessionRow key={s.id} s={s} actions={actions} />
                      ))}
                      {!sessions.length && (
                        <Empty>No persistent sessions yet.</Empty>
                      )}
                      <div className="panel-note">
                        tmux sessions keep running when you disconnect
                      </div>
                    </section>
                  </div>
                  <div className="dashboard-columns">
                    <section className="panel">
                      <div className="panel-heading">
                        <h2>Resource activity</h2>
                        <Badge>Live</Badge>
                      </div>
                      {state.processes
                        .slice()
                        .sort((a, b) => b.cpu - a.cpu)
                        .slice(0, 5)
                        .map((p) => (
                          <div className="resource-row" key={p.pid}>
                            <div className="mini-icon">
                              <Command size={16} />
                            </div>
                            <div>
                              <strong>{p.name}</strong>
                              <small>
                                PID {p.pid} · {p.user}
                              </small>
                            </div>
                            <div className="resource-values">
                              <strong>
                                {p.cpu.toFixed(1)}% <small>CPU</small>
                              </strong>
                              <span>{bytes(p.memory)}</span>
                            </div>
                          </div>
                        ))}
                    </section>
                    <section className="panel">
                      <div className="panel-heading">
                        <h2>Active projects</h2>
                        <button
                          className="text-btn"
                          onClick={() => navigate("Projects")}
                        >
                          All projects <ArrowUpRight size={14} />
                        </button>
                      </div>
                      {projects
                        .filter(
                          (p) =>
                            p.processes.length ||
                            sessions.some((s) => s.cwd?.startsWith(p.path)),
                        )
                        .slice(0, 4)
                        .map((p) => (
                          <div className="resource-row" key={p.path}>
                            <FolderGit2 size={20} />
                            <div>
                              <strong>{p.name}</strong>
                              <small>{p.branch || p.framework}</small>
                            </div>
                            <Button onClick={() => act(() => terminal(p.path))}>
                              <TerminalSquare size={15} />
                            </Button>
                          </div>
                        ))}
                      {!projects.some((p) => p.processes.length) && (
                        <Empty>
                          {projects.length} projects discovered.
                          <br />
                          Open a project to begin working.
                        </Empty>
                      )}
                    </section>
                  </div>
                </>
              )}
              {view === "Dashboard" && (
                <section className="panel">
                  <div className="panel-heading">
                    <h2>
                      <MemoryStick size={18} /> Top memory consumers
                    </h2>
                    <button
                      className="text-btn"
                      onClick={() => navigate("Processes")}
                    >
                      Processes <ArrowUpRight size={14} />
                    </button>
                  </div>
                  {state.processes
                    .slice()
                    .sort((a, b) => b.memory - a.memory)
                    .slice(0, 4)
                    .map((p) => (
                      <div className="resource-row" key={p.pid}>
                        <div className="mini-icon">
                          <Command size={16} />
                        </div>
                        <div>
                          <strong>{p.name}</strong>
                          <small>
                            PID {p.pid} · {p.user}
                          </small>
                        </div>
                        <strong>{bytes(p.memory)}</strong>
                      </div>
                    ))}
                </section>
              )}
              {view === "Servers" && (
                <div className="card-list">
                  {servers.map((s) => (
                    <ServerCard key={s.id} s={s} actions={actions} expanded />
                  ))}
                  {!servers.length && (
                    <Empty>
                      No local development servers detected. Start a project
                      command or use a terminal.
                    </Empty>
                  )}
                </div>
              )}
              {view === "Projects" && (
                <Projects
                  projects={projects}
                  actions={actions}
                  sessions={sessions}
                  logSources={state.logSources || []}
                />
              )}
              {view === "Files" && (
                <FileBrowser
                  root={fileRoot}
                  setRoot={setFileRoot}
                  roots={state.config.roots}
                  actions={actions}
                />
              )}
              {view === "Sessions" && (
                <>
                  <div className="panel">
                    {sessions.map((s) => (
                      <SessionRow key={s.id} s={s} actions={actions} expanded />
                    ))}
                    {!sessions.length && (
                      <Empty>
                        Create a terminal to start a persistent session.
                      </Empty>
                    )}
                  </div>
                  <AgentList state={state} actions={actions} />
                </>
              )}
              {view === "Processes" && (
                <Processes state={state} actions={actions} />
              )}
              {view === "Logs" && (
                <LogViewer
                  target={log}
                  setTarget={setLog}
                  state={state}
                  act={act}
                />
              )}
              {view === "Docker" && <Docker state={state} actions={actions} />}
              {view === "System" && <System state={state} act={act} />}
              {view === "Settings" && (
                <SettingsView
                  state={state}
                  act={act}
                  onConfig={(config) => setState((s) => ({ ...s, config }))}
                  onPreset={(p) =>
                    setState((s) => ({ ...s, presets: [...s.presets, p] }))
                  }
                />
              )}
            </>
          )}
          <div style={{ display: view === "Terminal" ? "block" : "none" }}>
            <div className="terminal-tabs">
              {tabs.map((s) => (
                <button
                  key={s.id}
                  className={active === s.id ? "selected" : ""}
                  onClick={() => setActive(s.id)}
                >
                  <TerminalSquare size={14} />
                  {sessions.find((x) => x.id === s.id)?.name || s.name}
                  <span
                    onClick={(e) => {
                      e.stopPropagation();
                      setTabs((t) => t.filter((x) => x.id !== s.id));
                      if (active === s.id) setActive(null);
                    }}
                    aria-label="Close terminal tab"
                  >
                    ×
                  </span>
                </button>
              ))}
              <Button onClick={() => act(() => terminal())}>
                <Plus size={16} />
              </Button>
            </div>
            {active ? (
              <TerminalPanel
                id={active}
                visible={view === "Terminal"}
                shortcuts={state?.config?.shortcuts || []}
                act={act}
              />
            ) : (
              <Empty>
                Select or create a terminal. Closing a tab detaches; its tmux
                session keeps running.
              </Empty>
            )}
            <div className="section-top">
              <h2>One-tap commands</h2>
              <span className="muted">Output opens in a real terminal</span>
            </div>
            <QuickCommands
              presets={state?.presets || []}
              projects={projects}
              cwd={sessions.find((s) => s.id === active)?.cwd || fileRoot}
              act={act}
              runPreset={runPreset}
              terminal={terminal}
            />
          </div>
          <footer className="page-footer">
            <span>
              <ShieldCheck size={13} /> Private by design · {m?.hostname}
            </span>
            <span>
              {state?.time
                ? new Date(state.time).toLocaleTimeString()
                : "Connecting"}
            </span>
          </footer>
        </main>
      </div>
      <nav className="bottom-nav">
        {routes
          .filter(([v]) =>
            ["Dashboard", "Projects", "Files", "Terminal", "Sessions"].includes(
              v,
            ),
          )
          .map(([v, I]) => (
            <button
              key={v}
              className={view === v ? "active" : ""}
              onClick={() => navigate(v)}
            >
              <I size={21} />
              <span>{v === "Dashboard" ? "Home" : v}</span>
            </button>
          ))}
      </nav>
      {notice && (
        <div className="toast" role="status">
          {notice}
          <button onClick={() => setNotice("")} aria-label="Dismiss">
            <X size={16} />
          </button>
        </div>
      )}
      {detail && (
        <div className="modal-backdrop" onClick={() => setDetail(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="section-top">
              <h2>Process details</h2>
              <button
                className="icon-btn"
                onClick={() => setDetail(null)}
                aria-label="Close"
              >
                <X />
              </button>
            </div>
            <dl>
              {Object.entries(detail)
                .filter(([k]) => !["argv"].includes(k))
                .map(([k, v]) => (
                  <React.Fragment key={k}>
                    <dt>{k}</dt>
                    <dd>
                      {typeof v === "object" ? JSON.stringify(v) : String(v)}
                    </dd>
                  </React.Fragment>
                ))}
            </dl>
          </div>
        </div>
      )}
    </div>
  );
}
const descriptions = {
  Projects: "Find your projects. Start work with one tap.",
  Servers: "Discover, open, and control your local development apps.",
  Files: "Browse and manage files within your configured roots.",
  Terminal: "A real shell. Persistent sessions. Built for your phone.",
  Sessions: "Pick up exactly where you left off.",
  Processes: "Understand what is running and what it needs.",
  Logs: "Live output from your terminals, apps, and containers.",
  Docker: "Containers and development services at a glance.",
  System: "Machine health, network, and safe power controls.",
  Settings: "Make this workspace yours.",
};
function cpuTemperature(m) {
  const v = m.sensors.filter((s) => /coretemp|k10temp|cpu/i.test(s.name));
  return v.length ? Math.max(...v.map((s) => s.celsius)) : null;
}
function Metric({ title, icon: I, value, sub, percent, threshold, history }) {
  const warning = percent >= threshold;
  return (
    <section className={"metric " + (warning ? "warning" : "")}>
      <div className="metric-top">
        <span>{title}</span>
        <I size={17} />
      </div>
      <div className="metric-value">
        {value}
        <span
          className={
            "dot " + (percent == null ? "" : warning ? "warn" : "good")
          }
        />
      </div>
      <div className="metric-sub">{sub}</div>
      {history ? (
        <svg className="spark" viewBox="0 0 240 28" preserveAspectRatio="none">
          <polyline
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            points={history
              .map((v, i) => `${(i * 240) / 29},${27 - v * 0.25}`)
              .join(" ")}
          />
        </svg>
      ) : (
        <div className="meter">
          <div style={{ width: Math.min(percent || 0, 100) + "%" }} />
        </div>
      )}
    </section>
  );
}
function ServerCard({ s, actions: a, expanded }) {
  return (
    <article className="server-card">
      <div className="server-main">
        <div className="app-icon">
          <Radio size={20} />
        </div>
        <div>
          <strong>
            {s.framework}
            <Badge kind="good">Running</Badge>
          </strong>
          <small>
            {s.cwd?.split("/").at(-1)} · :{s.port}
          </small>
        </div>
        <Button
          kind="primary small"
          onClick={() => a.act(() => a.openServer(s))}
        >
          Open <ExternalLink size={13} />
        </Button>
      </div>
      <div className="server-meta">
        <span>CPU {s.cpu.toFixed(1)}%</span>
        <span>{bytes(s.memory)}</span>
        <span>Up {duration(s.runtime)}</span>
      </div>
      <div className="action-row">
        <Button onClick={() => a.logs({ pid: s.pid })}>
          <ScrollText size={14} />
          Logs
        </Button>
        <Button onClick={() => a.act(() => a.terminal(s.cwd))}>
          <TerminalSquare size={14} />
          Terminal
        </Button>
        <Button onClick={() => a.act(() => a.processAction(s, "restart"))}>
          <RotateCw size={14} />
          Restart
        </Button>
        <Button onClick={() => a.act(() => a.processAction(s, "stop"))}>
          <Square size={13} />
          Stop
        </Button>
        {expanded && (
          <>
            <Button
              kind="danger"
              onClick={() => a.act(() => a.processAction(s, "kill"))}
            >
              Force kill
            </Button>
            <Button onClick={() => a.details(s)}>Details</Button>
            <Button
              onClick={() =>
                a.act(async () => {
                  const d = await api(`/process/${s.pid}/expose`, {
                    start: s.start,
                    port: s.port,
                  });
                  await navigator.clipboard.writeText(d.url);
                })
              }
            >
              <Copy size={13} />
              URL
            </Button>
          </>
        )}
      </div>
    </article>
  );
}
function SessionRow({ s, actions: a, expanded }) {
  return (
    <article className="session-row">
      <div className="mini-icon">
        <TerminalSquare size={18} />
      </div>
      <div className="session-content">
        <strong>
          {s.name}
          <Badge kind={s.attached ? "good" : ""}>{s.status}</Badge>
        </strong>
        <small>{s.cwd}</small>
        <span className="tiny">
          {s.command} · {duration((Date.now() - s.created) / 1000)}
        </span>
      </div>
      <Button onClick={() => a.act(() => a.terminal(null, s))}>
        Attach <ArrowUpRight size={13} />
      </Button>
      {expanded && (
        <div className="action-row">
          <Button onClick={() => a.logs({ session: s.id })}>Logs</Button>
          <Button
            onClick={() =>
              a.act(async () => {
                const name = prompt("Session name", s.name);
                if (name)
                  await api(`/sessions/${encodeURIComponent(s.id)}/rename`, {
                    name,
                  });
              })
            }
          >
            Rename
          </Button>
          <Button
            onClick={() =>
              a.act(() =>
                api(`/sessions/${encodeURIComponent(s.id)}/detach`, {}),
              )
            }
          >
            Detach
          </Button>
          <Button
            kind="danger"
            onClick={() =>
              a.act(async () => {
                if (confirm(`Terminate ${s.name} and its running commands?`))
                  await api(`/sessions/${encodeURIComponent(s.id)}/terminate`, {
                    confirm: true,
                  });
              })
            }
          >
            Terminate
          </Button>
        </div>
      )}
    </article>
  );
}
function Projects({ projects, actions: a, sessions, logSources = [] }) {
  const [search, setSearch] = useState("");
  return (
    <>
      <div className="search-field">
        <Search size={17} />
        <input
          placeholder="Find a project…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Badge>{projects.length} projects</Badge>
      </div>
      <div className="project-grid">
        {projects
          .filter((p) =>
            (p.name + p.path).toLowerCase().includes(search.toLowerCase()),
          )
          .map((p) => (
            <article key={p.path} className="project-card">
              <div className="section-top">
                <FolderGit2 size={24} />
                <Badge kind={p.processes.length ? "good" : ""}>
                  {p.processes.length ? "Active" : p.framework}
                </Badge>
              </div>
              <h2>{p.name}</h2>
              <p className="path">{p.path}</p>
              <div className="project-git">
                <Badge>{p.branch || "No Git branch"}</Badge>
                {p.git && (
                  <Badge kind={p.dirty ? "warn" : "good"}>
                    {p.dirty ? "Modified" : "Clean"}
                  </Badge>
                )}
                <Badge>{p.manager}</Badge>
              </div>
              <p className="commit">{p.lastCommit || "No commit history"}</p>
              {p.remote && (
                <div className="tiny truncate" title={p.remote}>
                  {p.remote}
                </div>
              )}
              <div className="favorite-row">
                {p.servers.map((s) => (
                  <Button
                    key={s.id}
                    onClick={() => a.act(() => a.openServer(s))}
                  >
                    :{s.port}
                    <ExternalLink size={12} />
                  </Button>
                ))}
                {sessions
                  .filter((s) => s.cwd?.startsWith(p.path))
                  .map((s) => (
                    <Button
                      key={s.id}
                      onClick={() => a.act(() => a.terminal(null, s))}
                    >
                      Attach {s.name}
                    </Button>
                  ))}
              </div>
              <div className="action-row">
                <Button
                  kind="primary"
                  disabled={!p.commands.dev && !p.commands.start}
                  onClick={() =>
                    a.act(async () => {
                      const s = await api("/projects/action", {
                        project: p.path,
                        action: p.commands.dev ? "dev" : "start",
                      });
                      await a.terminal(null, s);
                    })
                  }
                >
                  <Play size={13} />
                  Start
                </Button>
                <Button onClick={() => a.act(() => a.terminal(p.path))}>
                  <TerminalSquare size={14} />
                  Terminal
                </Button>
                <Button onClick={() => a.files(p.path)}>
                  <Files size={14} />
                  Files
                </Button>
                <Button
                  onClick={() => {
                    const s = sessions.find((s) => s.project === p.path);
                    if (s) a.logs({ session: s.id });
                    else if (p.processes[0])
                      a.logs({ pid: p.processes[0].pid });
                    else {
                      const source = logSources.find(
                        (x) => x.project === p.path,
                      );
                      a.logs(source ? { source: source.id } : {});
                    }
                  }}
                >
                  Logs
                </Button>
                <Button
                  onClick={() =>
                    a.act(async () => {
                      if (confirm(`Stop development processes for ${p.name}?`))
                        await api("/projects/action", {
                          project: p.path,
                          action: "stop",
                          confirm: true,
                        });
                    })
                  }
                >
                  Stop
                </Button>
                <Button
                  disabled={!p.commands.dev}
                  onClick={() =>
                    a.act(async () => {
                      if (confirm(`Restart ${p.name}?`)) {
                        const s = await api("/projects/action", {
                          project: p.path,
                          action: "restart",
                          confirm: true,
                        });
                        await a.terminal(null, s);
                      }
                    })
                  }
                >
                  Restart
                </Button>
              </div>
              <details>
                <summary>Commands & configuration</summary>
                {Object.entries(p.commands).map(([k, v]) => (
                  <div className="command-row" key={k}>
                    <code>{v}</code>
                    <Button
                      onClick={() =>
                        a.act(async () => {
                          if (
                            k === "install" &&
                            !confirm(
                              `Install dependencies for ${p.name}?\n${v}`,
                            )
                          )
                            return;
                          const s = await api("/projects/action", {
                            project: p.path,
                            action: k,
                            confirm: k === "install",
                          });
                          await a.terminal(null, s);
                        })
                      }
                    >
                      {k}
                    </Button>
                  </div>
                ))}
                <Button
                  onClick={() =>
                    a.act(async () => {
                      const k = prompt(
                        "Command type: dev/start/test/build/lint/typecheck",
                        "dev",
                      );
                      if (!k) return;
                      const command = prompt(
                        "Shell command",
                        p.commands[k] || "",
                      );
                      if (command !== null)
                        await api("/settings", {
                          projectCommands: {
                            [p.path]: { ...p.commands, [k]: command },
                          },
                        });
                    })
                  }
                >
                  Configure command
                </Button>
              </details>
            </article>
          ))}
      </div>
    </>
  );
}
function QuickCommands({ presets, projects, cwd, act, runPreset, terminal }) {
  const [category, setCategory] = useState("Claude"),
    [selectedProject, setSelectedProject] = useState("");
  const group = (p) =>
    ["Tests", "Development"].includes(p.group) ? "Dev" : p.group || "System";
  const categories = [
    ...new Set([
      "Claude",
      "Codex",
      "Dev",
      "Git",
      "System",
      "Docker",
      ...presets.map(group),
    ]),
  ];
  const inferred = projects
    .filter((p) => cwd === p.path || cwd?.startsWith(p.path + "/"))
    .sort((a, b) => b.path.length - a.path.length)[0];
  const project =
    projects.find((p) => p.path === selectedProject) || inferred || projects[0];
  return (
    <div className="quick-commands">
      <div
        className="command-categories"
        role="tablist"
        aria-label="Command categories"
      >
        {categories.map((c) => (
          <button
            key={c}
            role="tab"
            id={`command-tab-${c}`}
            aria-selected={category === c}
            aria-controls="command-panel"
            onClick={() => setCategory(c)}
          >
            {c}
          </button>
        ))}
      </div>
      <section
        id="command-panel"
        role="tabpanel"
        aria-labelledby={`command-tab-${category}`}
      >
        {category === "Dev" && (
          <>
            <label className="command-project">
              Project
              <select
                aria-label="Quick command project"
                value={project?.path || ""}
                onChange={(e) => setSelectedProject(e.target.value)}
              >
                {!projects.length && (
                  <option value="">No discovered projects</option>
                )}
                {projects.map((p) => (
                  <option key={p.path} value={p.path}>
                    {p.name} · {p.manager}
                  </option>
                ))}
              </select>
            </label>
            <div className="command-buttons">
              {Object.entries(project?.commands || {})
                .filter(([, cmd]) => cmd)
                .map(([action, command]) => (
                  <Button
                    key={action}
                    title={command}
                    onClick={() =>
                      act(async () => {
                        if (
                          action === "install" &&
                          !confirm(
                            `Install dependencies for ${project.name}?\n${command}`,
                          )
                        )
                          return;
                        const s = await api("/projects/action", {
                          project: project.path,
                          action,
                          confirm: action === "install",
                        });
                        await terminal(null, s);
                      })
                    }
                  >
                    {action === "dev" ? "Start dev server" : action}
                    <code>{command}</code>
                  </Button>
                ))}
            </div>
            {!Object.values(project?.commands || {}).some(Boolean) && (
              <p className="muted">
                No detected scripts. Configure commands in Projects.
              </p>
            )}
          </>
        )}
        <div className="command-buttons">
          {presets
            .filter(
              (p) =>
                group(p) === category &&
                !["npm-install", "pnpm-install"].includes(p.id),
            )
            .map((p) => (
              <Button
                key={p.id}
                title={p.command}
                onClick={() => act(() => runPreset(p))}
              >
                {p.label}
                {p.confirm && <ShieldCheck size={12} />}
              </Button>
            ))}
        </div>
      </section>
    </div>
  );
}
function TerminalPanel({ id, visible, shortcuts, act }) {
  const holder = useRef(),
    termRef = useRef(),
    socket = useRef(),
    [status, setStatus] = useState("Connecting"),
    [full, setFull] = useState(false),
    [ctrl, setCtrl] = useState(false),
    [reconnect, setReconnect] = useState(0);
  const fitRef = useRef(),
    actionRef = useRef(),
    copyRef = useRef();
  const [keyboardPosition, setKeyboardPosition] = useState(null),
    [textView, setTextView] = useState(null),
    [textLoading, setTextLoading] = useState(false);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const update = () => {
      const focused = holder.current?.contains(document.activeElement);
      const keyboard =
        Math.max(window.innerHeight, document.documentElement.clientHeight) -
          viewport.height >
        100;
      setKeyboardPosition(
        visible &&
          textView === null &&
          focused &&
          keyboard &&
          viewport.scale < 1.1
          ? {
              top:
                viewport.offsetTop +
                viewport.height -
                (actionRef.current?.offsetHeight || 62),
              left: viewport.offsetLeft,
              width: viewport.width,
            }
          : null,
      );
    };
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    document.addEventListener("focusin", update);
    document.addEventListener("focusout", update);
    const observer = new ResizeObserver(update);
    if (actionRef.current) observer.observe(actionRef.current);
    update();
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
      document.removeEventListener("focusin", update);
      document.removeEventListener("focusout", update);
      observer.disconnect();
    };
  }, [visible, textView, ctrl, id]);
  useEffect(() => {
    if (textView !== null) copyRef.current?.focus();
  }, [textView !== null, textLoading]);
  useEffect(() => {
    setTextView(null);
  }, [id]);
  useEffect(() => {
    if (!holder.current) return;
    const term = new XTerm({
      fontFamily: '"SFMono-Regular", Consolas, monospace',
      fontSize: 13,
      cursorBlink: true,
      scrollback: 5000,
      theme: {
        background: "#0b0e12",
        foreground: "#d8dee9",
        cursor: "#abf5b7",
      },
      allowProposedApi: false,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(holder.current);
    termRef.current = term;
    fitRef.current = fit;
    let ws,
      stopped = false,
      retry,
      attempt = 0;
    const send = (m) => {
      if (ws?.readyState === 1) ws.send(JSON.stringify(m));
    };
    const resize = () => {
      try {
        fit.fit();
        send({ type: "resize", cols: term.cols, rows: term.rows });
      } catch {}
    };
    function connect() {
      if (stopped) return;
      setStatus("Connecting");
      ws = new WebSocket(
        `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/terminal?session=${encodeURIComponent(id)}&csrf=${encodeURIComponent(csrf)}`,
      );
      socket.current = ws;
      ws.onopen = () => {
        attempt = 0;
        setStatus("Attached");
        resize();
        term.focus();
      };
      ws.onmessage = (e) => {
        const m = JSON.parse(e.data);
        if (m.type === "output") term.write(m.data);
      };
      ws.onclose = () => {
        if (stopped) return;
        setStatus("Disconnected · reconnecting");
        retry = setTimeout(connect, Math.min(15000, 1000 * 2 ** attempt++));
      };
      ws.onerror = () => setStatus("Connection unavailable");
    }
    connect();
    const onData = term.onData((data) => send({ type: "input", data }));
    const obs = new ResizeObserver(resize);
    obs.observe(holder.current);
    window.visualViewport?.addEventListener("resize", resize);
    return () => {
      stopped = true;
      clearTimeout(retry);
      ws?.close();
      obs.disconnect();
      onData.dispose();
      term.dispose();
      window.visualViewport?.removeEventListener("resize", resize);
    };
  }, [id, reconnect]);
  useEffect(() => {
    if (visible)
      setTimeout(() => {
        try {
          fitRef.current?.fit();
        } catch {}
      }, 50);
  }, [visible, full]);
  const send = (text) => {
    if (socket.current?.readyState === 1)
      socket.current.send(JSON.stringify({ type: "input", data: text }));
    termRef.current?.focus();
  };
  const key = (k) => {
    if (k === "Ctrl") {
      setCtrl(!ctrl);
      return;
    }
    const map = {
      Esc: "\x1b",
      Tab: "\t",
      "↑": "\x1b[A",
      "↓": "\x1b[B",
      "←": "\x1b[D",
      "→": "\x1b[C",
      "●": "\x03",
    };
    let text = map[k] || k.trim();
    if (ctrl && text.length === 1) {
      text = String.fromCharCode(text.toUpperCase().charCodeAt(0) & 31);
      setCtrl(false);
    }
    send(text);
  };
  return (
    <section className={"terminal-shell " + (full ? "fullscreen" : "")}>
      <div className="terminal-toolbar">
        <span>
          <span
            className={"dot " + (status === "Attached" ? "good" : "warn")}
          />
          {status}
        </span>
        <div>
          <Button
            onClick={() =>
              act(async () => {
                const term = termRef.current;
                const readBuffer = (buffer) => {
                  const lines = [];
                  for (let i = 0; i < buffer.length; i++) {
                    const line = buffer.getLine(i);
                    if (!line) continue;
                    if (line.isWrapped && lines.length)
                      lines[lines.length - 1] += line.translateToString(true);
                    else lines.push(line.translateToString(true));
                  }
                  return lines.join("\n").trimEnd();
                };
                const normal = readBuffer(term.buffer.normal);
                const alternate =
                  term.buffer.active.type === "alternate"
                    ? readBuffer(term.buffer.active)
                    : "";
                const browserText = [normal, alternate]
                  .filter(Boolean)
                  .join("\n\n");
                term.blur();
                setTextView(browserText);
                setTextLoading(true);
                try {
                  const history = await api(
                    `/sessions/${encodeURIComponent(id)}/text`,
                  );
                  const parts = [
                    history.text,
                    history.alternate,
                    browserText,
                  ].filter(Boolean);
                  const unique = parts.filter(
                    (part, i) =>
                      !parts.some(
                        (other, j) =>
                          j !== i &&
                          other.includes(part) &&
                          (other.length > part.length || j < i),
                      ),
                  );
                  if (term === termRef.current)
                    setTextView(unique.join("\n\n"));
                } finally {
                  if (term === termRef.current) setTextLoading(false);
                }
              })
            }
          >
            <Copy size={14} />
            Text / Copy
          </Button>
          <Button
            onClick={() => setReconnect((n) => n + 1)}
            aria-label="Reconnect"
          >
            <RotateCw size={15} />
          </Button>
          <Button onClick={() => setFull(!full)} aria-label="Toggle fullscreen">
            {full ? <Minimize size={15} /> : <Maximize size={15} />}
          </Button>
        </div>
      </div>
      <div ref={holder} className="terminal-host" />
      <div
        className="terminal-actions-placeholder"
        style={
          keyboardPosition
            ? { height: actionRef.current?.offsetHeight }
            : undefined
        }
      >
        <div
          ref={actionRef}
          className={
            "terminal-actions" + (keyboardPosition ? " keyboard-open" : "")
          }
          style={keyboardPosition || undefined}
        >
          <div className="shortcut-bar">
            <button
              onPointerDown={(e) => e.preventDefault()}
              onClick={() =>
                act(async () => {
                  if (!navigator.clipboard?.readText)
                    throw new Error(
                      "Clipboard access unavailable. Use the keyboard’s Paste action.",
                    );
                  const term = termRef.current;
                  const text = await navigator.clipboard.readText();
                  if (
                    term !== termRef.current ||
                    socket.current?.readyState !== 1
                  )
                    throw new Error(
                      "Terminal disconnected. Reconnect before pasting.",
                    );
                  term.paste(text);
                  term.focus();
                })
              }
            >
              Paste
            </button>
            {shortcuts.map((k, i) => (
              <button
                key={i}
                className={k === "Ctrl" && ctrl ? "pressed" : ""}
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => key(k)}
              >
                {k === "●" ? "Ctrl+C" : k}
              </button>
            ))}
          </div>
          <div className="ctrl-keys">
            {ctrl && "Ctrl enabled — tap a letter: "}
            {(ctrl ? ["a", "c", "d", "e", "l", "r", "z"] : []).map((k) => (
              <Button
                key={k}
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => key(k)}
              >
                {k.toUpperCase()}
              </Button>
            ))}
          </div>
        </div>
      </div>
      {textView !== null && (
        <div className="modal-backdrop" onClick={() => setTextView(null)}>
          <section
            className="modal terminal-text-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="terminal-text-title"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Escape") setTextView(null);
              if (e.key === "Tab") {
                e.preventDefault();
                const buttons = [...e.currentTarget.querySelectorAll("button")];
                const index = buttons.indexOf(document.activeElement);
                buttons[
                  (index + (e.shiftKey ? -1 : 1) + buttons.length) %
                    buttons.length
                ]?.focus();
              }
            }}
          >
            <div className="section-top">
              <h2 id="terminal-text-title">Terminal text</h2>
              <Button
                onClick={() => setTextView(null)}
                aria-label="Close terminal text"
              >
                <X size={16} />
              </Button>
            </div>
            <p className="muted">
              Read-only snapshot of all available tmux and browser scrollback.
            </p>
            <button
              ref={copyRef}
              className="btn"
              disabled={textLoading}
              onClick={() => act(() => navigator.clipboard.writeText(textView))}
            >
              Copy All
            </button>
            {textLoading && <p role="status">Loading full scrollback…</p>}
            <pre className="terminal-plain-text" tabIndex={0}>
              {textView}
            </pre>
          </section>
        </div>
      )}
      <div className="terminal-info">
        Closing this view detaches the terminal. Your tmux session keeps
        running.
      </div>
    </section>
  );
}
// Capture the row before mobile Grid focus changes the click target; use SVAR public events.
function bridgeGridRow(e, fm) {
  const row = e.target.closest?.("[data-row-id]");
  if (!row) return;
  const encoded = row.getAttribute("data-row-id");
  row.setAttribute("data-id", encoded);
  const id = encoded.startsWith(":") ? encoded.slice(1) : encoded;
  if (fm && ["pointerdown", "click", "dblclick"].includes(e.type)) {
    e.stopPropagation();
    if (e.type === "pointerdown") e.preventDefault();
    const doubleTap =
      e.type === "pointerdown" &&
      Date.now() - Number(row.dataset.hdcTap || 0) < 400;
    if (e.type === "pointerdown") row.dataset.hdcTap = String(Date.now());
    if (e.type !== "dblclick" && !doubleTap)
      fm.exec("select-file", {
        id,
        toggle: e.ctrlKey || e.metaKey,
        range: e.shiftKey,
      });
    else {
      const f = fm.getFile(id);
      if (f) fm.exec(f.type === "folder" ? "set-path" : "open-file", { id });
    }
  }
}
function FileBrowser({ root, setRoot, roots, actions: a }) {
  const [data, setData] = useState([]),
    [current, setCurrent] = useState("/"),
    [selected, setSelected] = useState(null),
    [version, setVersion] = useState(0),
    [edit, setEdit] = useState(null),
    [git, setGit] = useState(""),
    [permissions, setPermissions] = useState(""),
    [rootInput, setRootInput] = useState(root),
    apiRef = useRef();
  const absolute = (id) => root + (id === "/" ? "" : id);
  const virtual = (p) => p.slice(root.length) || "/";
  const load = async (id, api) => {
    const r = await apiCallFiles(absolute(id));
    const files = r.files.map((f) => ({
      ...f,
      id: virtual(f.id),
      date: new Date(f.date),
    }));
    if (api) await api.exec("provide-data", { id, data: files });
    return files;
  };
  async function apiCallFiles(p) {
    return api("/files?path=" + encodeURIComponent(p));
  }
  useEffect(() => {
    setRootInput(root);
    setCurrent("/");
    setSelected(null);
    setGit("");
    a.act(async () => setData(await load("/")));
  }, [root, version]);
  async function refresh() {
    setVersion((n) => n + 1);
  }
  async function operation(action, p, target) {
    await api("/files/action", { action, path: p, target, confirm: true });
    await load(
      apiRef.current?.getState().panels[apiRef.current.getState().activePanel]
        .path || current,
      apiRef.current,
    );
    setSelected(null);
  }
  async function preview(id) {
    const p = absolute(id);
    if (/\.(png|jpe?g|gif|webp)$/i.test(p)) {
      setEdit({ path: p, image: true });
      return;
    }
    const f = await api("/files/content?path=" + encodeURIComponent(p));
    setEdit({ path: p, ...f });
  }
  const init = useCallback(
    (fm) => {
      apiRef.current = fm;
      fm.on("set-path", (e) => {
        setCurrent(e.id);
        setSelected(null);
      });
      fm.on("select-file", (e) => {
        setSelected(e.id);
        const f = fm.getFile(e.id);
        setPermissions(f?.permissions || "");
      });
      fm.intercept("request-data", (e) => {
        a.act(() => load(e.id, fm));
        return false;
      });
      fm.intercept("open-file", (e) => {
        a.act(() => preview(e.id));
        return false;
      });
      fm.intercept("download-file", (e) => {
        location.href =
          "/api/files/download?path=" + encodeURIComponent(absolute(e.id));
        return false;
      });
      for (const event of [
        "create-file",
        "rename-file",
        "delete-files",
        "move-files",
        "copy-files",
      ])
        fm.intercept(event, (e) => {
          a.act(async () => {
            if (event === "create-file") {
              const p =
                absolute(e.parent) +
                (e.parent === "/" ? "" : "/") +
                e.file.name;
              if (e.file.file) {
                await uploadFile(e.file.file, absolute(e.parent));
              } else
                await operation(
                  e.file.type === "folder" ? "create-folder" : "create-file",
                  p,
                );
            }
            if (event === "rename-file") {
              if (confirm("Rename " + e.id + "?"))
                await operation(
                  "rename",
                  absolute(e.id),
                  absolute(e.id).split("/").slice(0, -1).join("/") +
                    "/" +
                    e.name,
                );
            }
            if (event === "delete-files") {
              if (
                confirm(
                  "Delete " + e.ids.length + " item(s)? This cannot be undone.",
                )
              )
                for (const id of e.ids) await operation("delete", absolute(id));
            }
            if (event === "move-files" || event === "copy-files") {
              if (event === "move-files" && !confirm("Move selected files?"))
                return;
              for (const id of e.ids)
                await operation(
                  event === "move-files" ? "move" : "copy",
                  absolute(id),
                  absolute(e.target) + "/" + id.split("/").at(-1),
                );
            }
          });
          return false;
        });
    },
    [root],
  );
  async function uploadFile(file, dir) {
    const form = new FormData();
    form.append("file", file);
    const r = await fetch("/api/files/upload?path=" + encodeURIComponent(dir), {
      method: "POST",
      headers: { "X-CSRF-Token": csrf },
      body: form,
    });
    const result = await r.json();
    if (!r.ok) throw Error(result.error);
    await load(
      apiRef.current?.getState().panels[apiRef.current.getState().activePanel]
        .path || current,
      apiRef.current,
    );
  }
  return (
    <>
      <div className="file-location">
        <Files size={18} />
        <input
          value={rootInput}
          onChange={(e) => setRootInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") setRoot(rootInput);
          }}
          aria-label="File root"
        />
        <Button onClick={() => setRoot(rootInput)}>Go</Button>
        <Button onClick={() => setRoot(roots[0])}>Home</Button>
      </div>
      <div className="favorite-row">
        <Button
          onClick={() =>
            a.act(() =>
              a.terminal(
                selected && apiRef.current?.getFile(selected)?.type === "folder"
                  ? absolute(selected)
                  : absolute(current),
              ),
            )
          }
        >
          <TerminalSquare size={14} />
          Terminal here
        </Button>
        <Button
          onClick={() =>
            a.act(() =>
              navigator.clipboard.writeText(
                selected ? absolute(selected) : absolute(current),
              ),
            )
          }
        >
          <Copy size={14} />
          Path
        </Button>
        <Button onClick={() => a.navigate("Projects")}>Open project</Button>
        <Button
          onClick={() =>
            a.act(async () =>
              setGit(
                (
                  await api(
                    "/files/git?path=" + encodeURIComponent(absolute(current)),
                  )
                ).text,
              ),
            )
          }
        >
          Git status
        </Button>
        <label className="btn">
          Upload
          <input
            type="file"
            className="hidden"
            onChange={(e) =>
              e.target.files[0] &&
              a.act(() => uploadFile(e.target.files[0], absolute(current)))
            }
          />
        </label>
        <Button
          onClick={() =>
            a.act(async () => {
              const name = prompt("New file name");
              if (name)
                await operation("create-file", absolute(current) + "/" + name);
            })
          }
        >
          New file
        </Button>
        <Button
          onClick={() =>
            a.act(async () => {
              const name = prompt("New folder name");
              if (name)
                await operation(
                  "create-folder",
                  absolute(current) + "/" + name,
                );
            })
          }
        >
          New folder
        </Button>
      </div>
      {git && <pre className="git-output">{git}</pre>}
      <div
        className="filemanager"
        onPointerDownCapture={(e) => bridgeGridRow(e, apiRef.current)}
        onClickCapture={(e) => bridgeGridRow(e, apiRef.current)}
        onDoubleClickCapture={(e) => bridgeGridRow(e, apiRef.current)}
        onContextMenuCapture={bridgeGridRow}
      >
        <WillowDark fonts={false}>
          <Filemanager
            key={root + version}
            data={data}
            init={init}
            icons="simple"
            mode="table"
            preview={false}
          />
        </WillowDark>
      </div>
      {selected && (
        <div className="file-selection">
          <span className="path">
            {absolute(selected)} · permissions {permissions}
          </span>
          <div className="action-row">
            {apiRef.current?.getFile(selected)?.type === "folder" ? (
              <Button
                kind="primary"
                onClick={() =>
                  apiRef.current.exec("set-path", { id: selected })
                }
              >
                Open folder
              </Button>
            ) : (
              <Button onClick={() => a.act(() => preview(selected))}>
                Preview / edit
              </Button>
            )}
            <Button
              onClick={() => {
                location.href =
                  "/api/files/download?path=" +
                  encodeURIComponent(absolute(selected));
              }}
            >
              Download
            </Button>
            <Button
              onClick={() =>
                a.act(async () => {
                  const p = absolute(selected);
                  await operation("duplicate", p, p + "-copy");
                })
              }
            >
              Duplicate
            </Button>
            <Button
              onClick={() =>
                a.act(async () => {
                  const name = prompt("Rename to", selected.split("/").at(-1));
                  if (name && confirm("Rename this item?"))
                    await operation(
                      "rename",
                      absolute(selected),
                      absolute(selected).split("/").slice(0, -1).join("/") +
                        "/" +
                        name,
                    );
                })
              }
            >
              Rename
            </Button>
            <Button
              onClick={() =>
                a.act(async () => {
                  const dest = prompt("Move to absolute path");
                  if (dest && confirm("Move this item?"))
                    await operation("move", absolute(selected), dest);
                })
              }
            >
              Move
            </Button>
            <Button
              onClick={() =>
                a.act(async () => {
                  const dest = prompt("Copy to absolute path");
                  if (dest) await operation("copy", absolute(selected), dest);
                })
              }
            >
              Copy
            </Button>
            <Button
              kind="danger"
              onClick={() =>
                a.act(async () => {
                  if (confirm("Permanently delete " + absolute(selected) + "?"))
                    await operation("delete", absolute(selected));
                })
              }
            >
              Delete
            </Button>
          </div>
        </div>
      )}
      {edit && <Editor file={edit} close={() => setEdit(null)} act={a.act} />}
    </>
  );
}
function Editor({ file, close, act }) {
  const el = useRef(),
    editor = useRef();
  useEffect(() => {
    if (file.image) return;
    const language = /\.(py)$/i.test(file.path)
      ? python()
      : javascript({ jsx: true, typescript: true });
    editor.current = new EditorView({
      doc: file.text,
      extensions: [
        basicSetup,
        language,
        EditorView.lineWrapping,
        EditorView.theme(
          {
            "&": {
              height: "100%",
              backgroundColor: "#11151c",
              color: "#d8dee9",
            },
            ".cm-content": { caretColor: "#a4efb5" },
            ".cm-gutters": { backgroundColor: "#151922", color: "#7f8b9e" },
            ".cm-activeLine": { backgroundColor: "#ffffff08" },
          },
          { dark: true },
        ),
      ],
      parent: el.current,
    });
    return () => editor.current.destroy();
  }, [file]);
  return (
    <div className="modal-backdrop">
      <div className="modal editor-modal">
        <div className="section-top">
          <h2>{file.path.split("/").at(-1)}</h2>
          <Button onClick={close}>
            <X size={16} />
          </Button>
        </div>
        <p className="path">{file.path}</p>
        {file.image ? (
          <img
            className="image-preview"
            src={"/api/files/image?path=" + encodeURIComponent(file.path)}
            alt={file.path}
          />
        ) : (
          <>
            <div ref={el} className="code-editor" />
            <div className="section-top">
              <span className="tiny">
                {bytes(file.size)} · {file.permissions} ·{" "}
                {new Date(file.modified).toLocaleString()}
              </span>
              <Button
                kind="primary"
                onClick={() =>
                  act(async () => {
                    await api("/files/edit", {
                      path: file.path,
                      text: editor.current.state.doc.toString(),
                      etag: file.etag,
                    });
                    close();
                  })
                }
              >
                Save changes
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
function Processes({ state, actions: a }) {
  const [filter, setFilter] = useState("development"),
    [search, setSearch] = useState(""),
    [sort, setSort] = useState("cpu");
  const matches = (p) => {
    const cmd = p.command.toLowerCase();
    return (
      (filter === "all" || filter === "user"
        ? filter === "all" || p.uid === state.config.uid
        : filter === "development"
          ? p.development
          : cmd.includes(filter)) &&
      (p.name + p.command + p.cwd).toLowerCase().includes(search.toLowerCase())
    );
  };
  return (
    <>
      <div className="filter-row">
        <select value={filter} onChange={(e) => setFilter(e.target.value)}>
          {[
            "development",
            "node",
            "python",
            "docker",
            "claude",
            "codex",
            "user",
            "all",
          ].map((f) => (
            <option key={f}>{f}</option>
          ))}
        </select>
        <input
          placeholder="Search processes…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="cpu">CPU</option>
          <option value="memory">Memory</option>
          <option value="runtime">Runtime</option>
        </select>
      </div>
      <div className="process-list">
        {state.processes
          .filter(matches)
          .sort((a, b) => b[sort] - a[sort])
          .map((p) => (
            <article className="process-card" key={p.pid}>
              <div className="section-top">
                <h3>
                  {p.name}
                  <Badge>PID {p.pid}</Badge>
                </h3>
                <div className="resource-values">
                  <strong>{p.cpu.toFixed(1)}% CPU</strong>
                  <span>
                    {bytes(p.memory)} · {duration(p.runtime)}
                  </span>
                </div>
              </div>
              <p className="path">{p.cwd || "Working directory unavailable"}</p>
              <code className="process-command">{p.command.slice(0, 400)}</code>
              <div className="tiny">
                {p.user} · PPID {p.ppid} · ports {p.ports.join(", ") || "none"}
              </div>
              <div className="action-row">
                <Button onClick={() => a.details(p)}>Details</Button>
                <Button
                  disabled={!p.cwd}
                  onClick={() => a.act(() => a.terminal(p.cwd))}
                >
                  Terminal
                </Button>
                {p.development && (
                  <>
                    <Button
                      onClick={() => a.act(() => a.processAction(p, "stop"))}
                    >
                      Stop
                    </Button>
                    <Button
                      kind="danger"
                      onClick={() => a.act(() => a.processAction(p, "kill"))}
                    >
                      Force kill
                    </Button>
                  </>
                )}
              </div>
            </article>
          ))}
      </div>
      <div className="section-top">
        <h2>Agent processes</h2>
        <Badge>{state.agents.length}</Badge>
      </div>
      {state.agents.map((p) => {
        const s = state.sessions.find((s) => p.session === s.id);
        return (
          <div className="panel agent-card" key={p.pid}>
            <h3>{/claude/.test(p.name) ? "Claude Code" : "Codex"}</h3>
            <p className="path">{p.cwd}</p>
            <span>
              {duration(p.runtime)} · CPU {p.cpu.toFixed(1)}% · RAM{" "}
              {bytes(p.memory)}
            </span>
            {s ? (
              <Button onClick={() => a.act(() => a.terminal(null, s))}>
                Attach {s.name}
              </Button>
            ) : (
              <small>No attachable tmux session detected</small>
            )}
          </div>
        );
      })}
    </>
  );
}
function AgentList({ state, actions: a }) {
  return (
    <>
      <div className="section-top">
        <h2>Agent sessions</h2>
        <Badge>{state.agents.length} processes</Badge>
      </div>
      {state.agents.map((p) => (
        <article className="panel agent-card" key={p.pid}>
          <div className="section-top">
            <h3>{/claude/.test(p.name) ? "Claude Code" : "Codex"}</h3>
            <Badge kind="good">Running</Badge>
          </div>
          <p className="path">{p.cwd || "Working directory unavailable"}</p>
          <span>
            PID {p.pid} · {duration(p.runtime)} · CPU {p.cpu.toFixed(1)}% · RAM{" "}
            {bytes(p.memory)}
          </span>
          {p.session ? (
            <Button
              onClick={() =>
                a.act(() =>
                  a.terminal(
                    null,
                    state.sessions.find((s) => s.id === p.session),
                  ),
                )
              }
            >
              Attach
            </Button>
          ) : (
            <small>
              No tmux ancestor detected; open a terminal here to start an
              attachable agent.
            </small>
          )}
        </article>
      ))}
    </>
  );
}
function LogViewer({ target, setTarget, state, act }) {
  const [data, setData] = useState({ text: "", source: "" }),
    [paused, setPaused] = useState(false),
    [search, setSearch] = useState(""),
    [level, setLevel] = useState("all"),
    [auto, setAuto] = useState(true),
    el = useRef();
  const query = new URLSearchParams(target).toString();
  useEffect(() => {
    if (paused || !query) return;
    let stopped = false;
    const refresh = () =>
      api("/logs?" + query)
        .then((d) => {
          if (!stopped) setData(d);
        })
        .catch((e) => {
          if (!stopped) setData({ text: "", source: e.message });
        });
    refresh();
    const t = setInterval(refresh, 2000);
    return () => {
      stopped = true;
      clearInterval(t);
    };
  }, [query, paused]);
  useEffect(() => {
    if (auto && el.current) el.current.scrollTop = el.current.scrollHeight;
  }, [data, auto]);
  const lines = data.text
    .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "")
    .split("\n")
    .filter(
      (l) =>
        l.toLowerCase().includes(search.toLowerCase()) &&
        (level === "all" ||
          new RegExp(
            level === "errors" ? "error|exception|fail" : "warn",
            "i",
          ).test(l)),
    )
    .slice(-1500);
  return (
    <>
      <div className="filter-row">
        <select
          value={query}
          onChange={(e) =>
            setTarget(Object.fromEntries(new URLSearchParams(e.target.value)))
          }
        >
          <option value="">Select a log source</option>
          {state.sessions.map((s) => (
            <option
              key={s.id}
              value={new URLSearchParams({ session: s.id }).toString()}
            >
              Session: {s.name}
            </option>
          ))}
          {state.servers.map((s) => (
            <option key={s.id} value={"pid=" + s.pid}>
              Process: {s.framework} :{s.port}
            </option>
          ))}
          {(state.logSources || []).map((source) => (
            <option
              key={"history-" + source.id}
              value={new URLSearchParams({ source: source.id }).toString()}
            >
              History: {source.label} ·{" "}
              {source.created
                ? new Date(source.created).toLocaleString()
                : "Time unavailable"}
            </option>
          ))}
          {state.docker.containers.map((c) => (
            <option key={c.ID} value={"container=" + c.ID}>
              Docker: {c.Names}
            </option>
          ))}
        </select>
        <input
          placeholder="Search logs…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select value={level} onChange={(e) => setLevel(e.target.value)}>
          {["all", "errors", "warnings"].map((x) => (
            <option key={x}>{x}</option>
          ))}
        </select>
      </div>
      <div className="section-top">
        <Badge kind={paused ? "warn" : "good"}>
          {paused ? "Paused" : "Live · refresh 2s"}
        </Badge>
        <div className="favorite-row">
          <Button onClick={() => setPaused(!paused)}>
            {paused ? "Resume" : "Pause"}
          </Button>
          <Button onClick={() => setAuto(!auto)}>
            Auto-scroll: {auto ? "on" : "off"}
          </Button>
          <Button
            onClick={() =>
              act(() => navigator.clipboard.writeText(lines.join("\n")))
            }
          >
            Copy
          </Button>
        </div>
      </div>
      <p className="tiny">
        {data.source ||
          "Choose a session, server, or container. Terminal logs retain original timestamps where the command emits them; collection refresh time appears below."}
      </p>
      <div className="log-output" ref={el}>
        {lines.map((line, i) => (
          <div
            key={i}
            className={
              /error|exception|fail/i.test(line)
                ? "log-error"
                : /warn/i.test(line)
                  ? "log-warn"
                  : ""
            }
          >
            {line || " "}
          </div>
        ))}
      </div>
      <p className="tiny">
        Capped history · last read {new Date().toLocaleTimeString()}
      </p>
    </>
  );
}
function Docker({ state, actions: a }) {
  if (!state.docker.available)
    return <Empty>Docker unavailable: {state.docker.error}</Empty>;
  return (
    <div className="project-grid">
      {state.docker.containers.map((c) => (
        <article className="project-card" key={c.ID}>
          <div className="section-top">
            <Container size={23} />
            <Badge kind={c.State === "running" ? "good" : ""}>{c.State}</Badge>
          </div>
          <h2>{c.Names}</h2>
          <p>{c.Image}</p>
          <p className="tiny">
            {c.Status}
            <br />
            {c.Ports || "No published ports"}
          </p>
          <div className="tiny">
            CPU {c.stats?.CPUPerc || "—"} · RAM {c.stats?.MemUsage || "—"}
          </div>
          <div className="action-row">
            {["start", "stop", "restart", "logs", "terminal", "open"].map(
              (action) => (
                <Button
                  key={action}
                  onClick={() =>
                    a.act(async () => {
                      if (action === "logs") {
                        a.logs({ container: c.ID });
                        return;
                      }
                      if (
                        ["stop", "restart"].includes(action) &&
                        !confirm(`${action} ${c.Names}?`)
                      )
                        return;
                      const w =
                        action === "open"
                          ? window.open("about:blank", "_blank")
                          : null;
                      try {
                        const r = await api(`/docker/${c.ID}/${action}`, {
                          confirm: true,
                        });
                        if (action === "terminal") await a.terminal(null, r);
                        if (w) {
                          w.opener = null;
                          w.location = r.url;
                        }
                      } catch (e) {
                        w?.close();
                        throw e;
                      }
                    })
                  }
                >
                  {action}
                </Button>
              ),
            )}
          </div>
        </article>
      ))}
      {!state.docker.containers.length && <Empty>No containers found.</Empty>}
    </div>
  );
}
function System({ state, act }) {
  const m = state.metrics;
  const [audit, setAudit] = useState([]);
  useEffect(() => {
    api("/audit")
      .then(setAudit)
      .catch(() => {});
  }, []);
  return (
    <>
      <div className="dashboard-columns">
        <section className="panel padded">
          <h2>Machine</h2>
          <dl>
            <dt>Hostname</dt>
            <dd>{m.hostname}</dd>
            <dt>Uptime</dt>
            <dd>{duration(m.uptime)}</dd>
            <dt>Load (1 / 5 / 15m)</dt>
            <dd>{m.load.map((n) => n.toFixed(2)).join(" / ")}</dd>
            <dt>Swap</dt>
            <dd>
              {bytes(m.memory.swapUsed)} / {bytes(m.memory.swapTotal)}
            </dd>
            <dt>Tailscale</dt>
            <dd>{state.tailscale?.state || "Unavailable"}</dd>
            <dt>Tailnet addresses</dt>
            <dd>{state.tailscale?.ip?.join(", ")}</dd>
          </dl>
        </section>
        <section className="panel padded">
          <h2>Hardware sensors</h2>
          {m.sensors.map((s) => (
            <div className="sensor-row" key={s.name + s.label}>
              <span>
                {s.name} / {s.label}
              </span>
              <strong>{s.celsius}°C</strong>
            </div>
          ))}
          {!m.sensors.length && <Empty>No sensors available.</Empty>}
          <h3>Network traffic</h3>
          {m.network.map((n) => (
            <div className="sensor-row" key={n.name}>
              <span>{n.name}</span>
              <span>
                ↓ {bytes(n.rxRate)}/s · ↑ {bytes(n.txRate)}/s
              </span>
            </div>
          ))}
        </section>
      </div>
      <section className="panel padded power-panel">
        <div>
          <h2>Machine controls</h2>
          <p>Close your work before requesting a power operation.</p>
        </div>
        <div className="favorite-row">
          {["reboot", "poweroff"].map((action) => (
            <Button
              kind="danger"
              key={action}
              onClick={() =>
                act(async () => {
                  const confirm = prompt(
                    `Type ${action} to confirm. This will disconnect your sessions.`,
                  );
                  if (confirm === action)
                    await api("/power/" + action, { confirm });
                })
              }
            >
              <Power size={15} />
              {action === "reboot" ? "Reboot" : "Shut down"}
            </Button>
          ))}
        </div>
      </section>
      <section className="panel padded">
        <h2>Audit history</h2>
        <div className="audit-list">
          {audit.map((e, i) => (
            <div className="audit-row" key={i}>
              <time>{new Date(e.time).toLocaleString()}</time>
              <strong>{e.action}</strong>
              <span>{JSON.stringify(e.details)}</span>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
function SettingsView({ state, act, onConfig, onPreset }) {
  const [thresholds, setThresholds] = useState(state.config.thresholds),
    [shortcuts, setShortcuts] = useState(state.config.shortcuts.join(",")),
    [label, setLabel] = useState(""),
    [command, setCommand] = useState(""),
    [group, setGroup] = useState("Custom"),
    [cwd, setCwd] = useState(state.config.roots[0]),
    [confirm, setConfirm] = useState(false),
    [target, setTarget] = useState("new"),
    [icon, setIcon] = useState("▶");
  return (
    <div className="settings-grid">
      <section className="panel padded">
        <h2>Warning thresholds</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            act(async () => onConfig(await api("/settings", { thresholds })));
          }}
        >
          {Object.entries(thresholds).map(([key, value]) => (
            <label className="setting-line" key={key}>
              <span>{key}</span>
              <input
                type="number"
                min="1"
                max="120"
                value={value}
                onChange={(e) =>
                  setThresholds((t) => ({
                    ...t,
                    [key]: Number(e.target.value),
                  }))
                }
              />
              <small>
                {key.toLowerCase().includes("temperature") ? "°C" : "%"}
              </small>
            </label>
          ))}
          <Button kind="primary" type="submit">
            Save thresholds
          </Button>
        </form>
        <p className="tiny">
          CPU warning requires sustained usage. Critical disk, memory, or swap:
          95%.
        </p>
      </section>
      <section className="panel padded">
        <h2>Mobile terminal keys</h2>
        <label>
          Comma-separated shortcuts
          <textarea
            value={shortcuts}
            onChange={(e) => setShortcuts(e.target.value)}
          />
        </label>
        <Button
          onClick={() =>
            act(async () =>
              onConfig(
                await api("/settings", {
                  shortcuts: shortcuts
                    .split(",")
                    .map((x) => x.trim())
                    .filter(Boolean),
                }),
              ),
            )
          }
        >
          Save shortcuts
        </Button>
        <p className="tiny">Ctrl toggles control mode. ● sends Ctrl+C.</p>
        <h3>Pinned commands</h3>
        {state.presets.map((p) => (
          <label className="checkbox" key={p.id}>
            <input
              type="checkbox"
              checked={state.config.favorites.includes(p.id)}
              onChange={() =>
                act(async () => {
                  const f = state.config.favorites.includes(p.id)
                    ? state.config.favorites.filter((x) => x !== p.id)
                    : [...state.config.favorites, p.id];
                  onConfig(await api("/settings", { favorites: f }));
                })
              }
            />
            {p.label}
          </label>
        ))}
      </section>
      <section className="panel padded">
        <h2>Create a command button</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            act(async () => {
              onPreset(
                await api("/presets", {
                  label,
                  command,
                  group,
                  cwd,
                  confirm,
                  target,
                  icon,
                }),
              );
              setLabel("");
              setCommand("");
            });
          }}
        >
          <label>
            Label
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              required
            />
          </label>
          <label>
            Shell command
            <textarea
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              required
            />
          </label>
          <label>
            Working directory
            <input
              value={cwd}
              onChange={(e) => setCwd(e.target.value)}
              required
            />
          </label>
          <label>
            Icon (text or emoji)
            <input
              value={icon}
              onChange={(e) => setIcon(e.target.value)}
              maxLength={8}
            />
          </label>
          <label>
            Group
            <input value={group} onChange={(e) => setGroup(e.target.value)} />
          </label>
          <label>
            Terminal
            <select value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="new">New terminal</option>
              <option value="current">Current terminal</option>
            </select>
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={confirm}
              onChange={(e) => setConfirm(e.target.checked)}
            />
            Require confirmation
          </label>
          <Button kind="primary" type="submit">
            Create button
          </Button>
        </form>
      </section>
      <section className="panel padded">
        <h2>Access & configuration</h2>
        <p>
          <a href="/THIRD_PARTY_NOTICES.txt" target="_blank" rel="noreferrer">
            Open-source license notices
          </a>
        </p>
        <Badge kind="good">
          <ShieldCheck size={13} /> Identity verified by Tailscale
        </Badge>
        <p>Allowlisted users: {state.config.allowedUsers.join(", ")}</p>
        <p className="path">~/.config/home-dev-control/config.json</p>
        <p className="tiny">
          Roots and access settings are changed locally. Hidden files are
          protected in the file browser. The terminal has your full normal user
          permissions.
        </p>
        <Button
          onClick={() =>
            act(async () => {
              await api("/logout", {});
              location.reload();
            })
          }
        >
          <LogOut size={15} />
          Lock dashboard
        </Button>
      </section>
    </div>
  );
}
createRoot(document.getElementById("root")).render(<App />);
