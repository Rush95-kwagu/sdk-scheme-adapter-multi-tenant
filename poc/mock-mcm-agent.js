'use strict';

const { WebSocketServer } = require('ws');

const port = Number(process.env.PORT || 4004);
const dfspId = process.env.DFSP_ID || 'dfsp-a';
const backendEndpoint = process.env.BACKEND_ENDPOINT || 'backend:3000';
const peerEndpoint = process.env.PEER_ENDPOINT || 'sdk:4000';

const tenantConfig = {
    dfspId,
    jwsSign: false,
    validateInboundJws: false,
    backendEndpoint,
    peerEndpoint,
    alsEndpoint: peerEndpoint,
    quotesEndpoint: peerEndpoint,
    transfersEndpoint: peerEndpoint,
};

const wss = new WebSocketServer({ port });
console.log(`[mock-mcm-agent] ${dfspId} listening on :${port}`);

function sendNotify(ws, id = 'boot') {
    ws.send(JSON.stringify({
        verb: 'NOTIFY',
        msg: 'CONFIGURATION',
        id,
        data: tenantConfig,
    }));
}

wss.on('connection', (ws) => {
    console.log(`[mock-mcm-agent] ${dfspId} client connected`);
    sendNotify(ws);

    const pingTimer = setInterval(() => {
        if (ws.readyState === ws.OPEN) ws.ping();
    }, 15000);

    ws.on('message', (raw) => {
        let msg;
        try {
            msg = JSON.parse(raw.toString());
        } catch {
            return;
        }
        console.log(`[mock-mcm-agent] ${dfspId} recv`, msg.verb, msg.msg);
        if (msg.msg === 'CONFIGURATION' && msg.verb === 'READ') {
            ws.send(JSON.stringify({
                verb: 'NOTIFY',
                msg: 'CONFIGURATION',
                id: msg.id,
                data: tenantConfig,
            }));
        }
    });

    ws.on('close', () => clearInterval(pingTimer));
});
