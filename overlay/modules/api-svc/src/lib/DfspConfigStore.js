'use strict';

const TENANT_KEYS = [
    'dfspId',
    'jwsSigningKey',
    'jwsSign',
    'validateInboundJws',
    'peerJWSKeys',
    'backendEndpoint',
    'peerEndpoint',
    'alsEndpoint',
    'quotesEndpoint',
    'transfersEndpoint',
    'transactionRequestsEndpoint',
    'bulkQuotesEndpoint',
    'bulkTransfersEndpoint',
    'supportedCurrencies',
];

const SKIP_DFSP_IDS = new Set(['', 'placeholder', 'mojaloop']);

function stripLeadingScheme(value) {
    if (typeof value !== 'string') return value;
    return value.replace(/^https?:\/\//i, '');
}

function fixPem(value) {
    const v = toNodeCert(value);
    if (typeof v === 'string' && v.includes('\\n') && !v.includes('\n')) {
        return v.replace(/\\n/g, '\n');
    }
    return v;
}

function toNodeCert(value) {
    if (value == null) return value;
    if (Buffer.isBuffer(value)) return value;
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) {
        if (value.length && typeof value[0] === 'number') {
            return Buffer.from(value);
        }
        return value.map(toNodeCert);
    }
    if (typeof value === 'object' && value.type === 'Buffer' && Array.isArray(value.data)) {
        return Buffer.from(value.data);
    }
    // lodash.merge casse un Buffer en {0,1,2,...,length}
    if (typeof value === 'object' && typeof value.length === 'number' && value.length > 20 && typeof value[0] === 'number') {
        return Buffer.from(Uint8Array.from({ length: value.length }, (_, i) => value[i]));
    }
    return value;
}

function pemString(value) {
    const v = fixPem(value);
    if (v == null || v === '') return undefined;
    if (Buffer.isBuffer(v)) return v.toString('utf8');
    if (typeof v === 'string') return v;
    return undefined;
}

function hasPem(value) {
    const s = pemString(value);
    return Boolean(s && s.length > 50);
}

function copyTls(tls) {
    if (!tls || typeof tls !== 'object') return tls;
    const raw = tls.creds || tls;
    const creds = {
        ca: pemString(raw.ca),
        cert: pemString(raw.cert || raw.certificate || raw.clientCert),
        key: pemString(raw.key || raw.privateKey || raw.clientKey),
    };
    const out = { creds };
    if (tls.mutualTLS) {
        out.mutualTLS = { ...tls.mutualTLS };
    }
    if (tls.enabled !== undefined) {
        out.enabled = tls.enabled;
    }
    return out;
}

function pickTenantSlice(conf) {
    if (!conf || typeof conf !== 'object') return {};
    const slice = {};
    for (const k of TENANT_KEYS) {
        if (conf[k] !== undefined) slice[k] = conf[k];
    }
    // InboundTransfersModel prefixe http:// — comme le lab (host:port[/path], sans schéma).
    for (const k of Object.keys(slice)) {
        if (k.endsWith('Endpoint') && typeof slice[k] === 'string') {
            slice[k] = stripLeadingScheme(slice[k]);
        }
    }
    // Certs mTLS Hub : outbound.tls.creds, ou un slice déjà aplati (outboundTls).
    const outboundSrc = (conf.outbound && conf.outbound.tls) || conf.outboundTls;
    if (outboundSrc) {
        slice.outboundTls = copyTls(outboundSrc);
    }
    const inboundSrc = (conf.inbound && conf.inbound.tls) || conf.inboundTls;
    if (inboundSrc) {
        slice.inboundTls = copyTls(inboundSrc);
    }
    if (conf.mutualTLS) {
        slice.mutualTLS = conf.mutualTLS;
    }
    return slice;
}

class DfspConfigStore {
    constructor() {
        const g = globalThis;
        g.__mojaloopDfspTenants = g.__mojaloopDfspTenants || new Map();
        g.__mojaloopDfspPeerJws = g.__mojaloopDfspPeerJws || {};
        this._tenants = g.__mojaloopDfspTenants;
        this.peerJWSKeys = g.__mojaloopDfspPeerJws;
    }

    upsert(confSlice) {
        const dfspId = confSlice && confSlice.dfspId;
        if (!dfspId || SKIP_DFSP_IDS.has(String(dfspId))) {
            return null;
        }
        const slice = pickTenantSlice(confSlice);
        slice.dfspId = dfspId;
        const existing = this._tenants.get(dfspId);
        const incomingPem = hasPem(slice.outboundTls && slice.outboundTls.creds && slice.outboundTls.creds.cert)
            && hasPem(slice.outboundTls && slice.outboundTls.creds && slice.outboundTls.creds.key);
        const existingPem = existing && hasPem(existing.outboundTls && existing.outboundTls.creds && existing.outboundTls.creds.cert)
            && hasPem(existing.outboundTls && existing.outboundTls.creds && existing.outboundTls.creds.key);
        if (existingPem && !incomingPem) {
            slice.outboundTls = existing.outboundTls;
            slice.inboundTls = slice.inboundTls || existing.inboundTls;
        }
        this._tenants.set(dfspId, slice);
        if (slice.peerJWSKeys && typeof slice.peerJWSKeys === 'object') {
            Object.assign(this.peerJWSKeys, slice.peerJWSKeys);
        }
        return slice;
    }

    get(dfspId) {
        return this._tenants.get(dfspId);
    }

    has(dfspId) {
        return this._tenants.has(dfspId);
    }

    list() {
        return [...this._tenants.keys()].sort();
    }

    applyTo(baseConf, dfspId) {
        const tenant = this.get(dfspId);
        if (!tenant) return baseConf;
        const {
            outboundTls,
            inboundTls,
            mutualTLS,
            ...flat
        } = tenant;
        const next = {
            ...baseConf,
            ...flat,
            dfspId,
            peerJWSKeys: this.peerJWSKeys,
        };
        if (outboundTls && outboundTls.creds) {
            const hasClient = hasPem(outboundTls.creds.cert) && hasPem(outboundTls.creds.key);
            next.outbound = {
                ...baseConf.outbound,
                tls: {
                    mutualTLS: {
                        ...(baseConf.outbound && baseConf.outbound.tls && baseConf.outbound.tls.mutualTLS),
                        ...(outboundTls.mutualTLS || {}),
                        enabled: hasClient,
                    },
                    creds: {
                        ca: outboundTls.creds.ca,
                        cert: outboundTls.creds.cert,
                        key: outboundTls.creds.key,
                    },
                },
            };
        }
        if (inboundTls) {
            next.inbound = {
                ...baseConf.inbound,
                tls: {
                    ...baseConf.inbound?.tls,
                    ...inboundTls,
                    creds: {
                        ...baseConf.inbound?.tls?.creds,
                        ...inboundTls.creds,
                    },
                },
            };
        }
        if (mutualTLS) {
            next.mutualTLS = mutualTLS;
        }
        if (next.outbound && next.outbound.tls) {
            next.tls = {
                enabled: Boolean(next.outbound.tls.mutualTLS && next.outbound.tls.mutualTLS.enabled),
                creds: next.outbound.tls.creds,
            };
        } else if (mutualTLS && mutualTLS.outboundRequests) {
            next.tls = mutualTLS.outboundRequests;
        }
        return next;
    }
}

const g = globalThis;
if (!g.__mojaloopDfspConfigStore) {
    g.__mojaloopDfspConfigStore = new DfspConfigStore();
}
const store = g.__mojaloopDfspConfigStore;
store.pickTenantSlice = pickTenantSlice;
module.exports = store;
