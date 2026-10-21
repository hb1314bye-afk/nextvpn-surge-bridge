import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { URL } from 'node:url';

const UPSTREAM_URL = process.env.UPSTREAM_URL || "https://app.nextvpn.xyz/api/sub/174b601027fb8f2e358e218c0cd5586a810d024a?remark=VPN%E7%BD%91%E7%BB%9C%E5%8A%A9%E6%89%8B";
const ACCESS_TOKEN = process.env.ACCESS_TOKEN || "enwI9fD22lJhkildU0H4_Sk-oUx-SS7NT530T34l3Y8";
const TROJAN_PASSWORD = process.env.TROJAN_PASSWORD || "SurgeSecret988";
const PORT = parseInt(process.env.PORT || '10000', 10);
const CONFIG_PATH = process.env.CONFIG_PATH || '/app/sing-box.json';

let currentNodes = [];
let singboxProcess = null;

function decode64(str) {
  const norm = str.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(norm, 'base64').toString('utf8');
}

async function fetchLatestNodes() {
  console.log(`[${new Date().toISOString()}] Fetching upstream subscription...`);
  const res = await fetch(UPSTREAM_URL, {
    headers: { 'User-Agent': 'Surge iOS/5.20.0' }
  });
  if (!res.ok) throw new Error(`Upstream returned ${res.status}`);
  let text = (await res.text()).trim();
  if (!/(?:^|\n)\s*(?:ss|vless|vmess|trojan):\/\//i.test(text)) {
    text = decode64(text);
  }
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.startsWith('vless://'));
  const nodes = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const hash = line.indexOf('#');
    const rawName = hash >= 0 ? decodeURIComponent(line.slice(hash + 1)) : `VLESS-${i + 1}`;
    const cleanName = rawName.replace(/[\x00-\x1f\x7f]/g, ' ')
      .replace(/,/g, '，').replace(/=/g, '＝').replace(/#/g, '＃')
      .replace(/"/g, '＂').replace(/\\/g, '＼').replace(/\s+/g, ' ').trim();
    
    const u = new URL(line.slice(0, hash >= 0 ? hash : undefined));
    const q = u.searchParams;

    // 分配专属路径，如 /node1, /node2 ...
    const path = `/node${i + 1}`;
    const internalPort = 20000 + (i + 1);

    nodes.push({
      index: i + 1,
      name: `${cleanName} - NextVPN`,
      path,
      internalPort,
      server: u.hostname,
      port: parseInt(u.port, 10),
      uuid: u.username,
      flow: q.get('flow') || '',
      sni: q.get('sni') || '',
      pbk: q.get('pbk') || '',
      sid: q.get('sid') || '',
      fp: q.get('fp') || 'chrome'
    });
  }

  return nodes;
}

function generateSingboxConfig(nodes) {
  const inbounds = nodes.map(n => ({
    type: 'trojan',
    tag: `in-${n.index}`,
    listen: '127.0.0.1',
    listen_port: n.internalPort,
    users: [
      { name: 'surge', password: TROJAN_PASSWORD }
    ],
    transport: {
      type: 'ws',
      path: n.path
    }
  }));

  const outbounds = nodes.map(n => ({
    tag: `out-${n.index}`,
    type: 'vless',
    server: n.server,
    server_port: n.port,
    uuid: n.uuid,
    flow: n.flow,
    tls: {
      enabled: true,
      server_name: n.sni,
      reality: {
        enabled: true,
        public_key: n.pbk,
        short_id: n.sid
      },
      utls: {
        enabled: true,
        fingerprint: n.fp
      }
    }
  }));

  outbounds.push({ tag: 'direct', type: 'direct' });

  const rules = nodes.map(n => ({
    inbound: [`in-${n.index}`],
    outbound: `out-${n.index}`
  }));

  return {
    log: { level: 'warn' },
    inbounds,
    outbounds,
    route: {
      auto_detect_interface: true,
      rules,
      final: 'direct'
    }
  };
}

function startSingbox(config) {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
    console.log(`[sing-box] Configuration written to ${CONFIG_PATH}`);
  } catch (err) {
    console.error('[sing-box] Failed to write config:', err.message);
    return;
  }

  if (singboxProcess) {
    console.log('[sing-box] Restarting existing instance...');
    singboxProcess.kill('SIGTERM');
  }

  try {
    singboxProcess = spawn('sing-box', ['run', '-c', CONFIG_PATH], { stdio: 'inherit' });
    singboxProcess.on('exit', (code, signal) => {
      console.log(`[sing-box] Exited with code ${code}, signal ${signal}`);
    });
    console.log('[sing-box] Process spawned successfully.');
  } catch (err) {
    console.error('[sing-box] Spawn failed (ignorable if running locally without sing-box in PATH):', err.message);
  }
}

async function refreshAndReload() {
  try {
    const nodes = await fetchLatestNodes();
    currentNodes = nodes;
    console.log(`[Bridge] Successfully loaded ${nodes.length} VLESS Reality nodes!`);
    const config = generateSingboxConfig(nodes);
    startSingbox(config);
  } catch (err) {
    console.error('[Bridge] Failed to refresh nodes:', err.message);
  }
}

// 启动定时轮询（每 1 小时自动拉取并热更新）
setInterval(refreshAndReload, 3600 * 1000);

// 创建主 HTTP/WebSocket 服务
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  
  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('ok\n');
  }

  if (url.pathname === '/surge.conf') {
    const token = url.searchParams.get('token');
    if (token !== ACCESS_TOKEN) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Not found\n');
    }

    const host = (req.headers['x-forwarded-host'] || req.headers.host || 'localhost').split(':')[0];
    const proxyLines = currentNodes.map(n => {
      return `${n.name} = trojan, ${host}, 443, password=${TROJAN_PASSWORD}, tls=true, sni=${host}, ws=true, ws-path=${n.path}`;
    });

    const content = `# NextVPN VLESS Bridge for Surge\n# Generated: ${new Date().toISOString()}\n# Compatible nodes: ${currentNodes.length}\n[Proxy]\n${proxyLines.join('\n')}\n`;
    
    res.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'profile-update-interval': '6',
      'x-compatible-nodes': String(currentNodes.length)
    });
    return res.end(content);
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not found\n');
});

// 处理 WebSocket 协议升级并反向代理给 sing-box 本地端口
server.on('upgrade', (req, clientSocket, head) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const node = currentNodes.find(n => n.path === url.pathname);

  if (!node) {
    clientSocket.write('HTTP/1.1 404 Not Found\r\n\r\n');
    clientSocket.destroy();
    return;
  }

  const singboxSocket = net.connect(node.internalPort, '127.0.0.1', () => {
    // 构造完整的原始 HTTP 请求头部发送给内部 sing-box
    let raw = `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`;
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      raw += `${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}\r\n`;
    }
    raw += '\r\n';

    singboxSocket.write(raw);
    if (head && head.length) {
      singboxSocket.write(head);
    }

    singboxSocket.pipe(clientSocket);
    clientSocket.pipe(singboxSocket);
  });

  singboxSocket.on('error', err => {
    console.error(`[Proxy Error] node ${node.index}:`, err.message);
    clientSocket.destroy();
  });

  clientSocket.on('error', () => {
    singboxSocket.destroy();
  });
});

server.listen(PORT, '0.0.0.0', async () => {
  console.log(`[Bridge Server] Listening on port ${PORT}`);
  await refreshAndReload();
});
