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

function copyTls(tls) {
    if (!tls || typeof tls !== 'object') return tls;
    return {
        ...tls,
        mutualTLS: tls.mutualTLS && { ...tls.mutualTLS },
        creds: tls.creds && { ...tls.creds },
    };
}

function pickTenantSlice(conf) {
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
    // Certs mTLS Hub (extapi) : le NOTIFY PM4ML les met dans outbound.tls.creds.
    if (conf.outbound && conf.outbound.tls) {
        slice.outboundTls = copyTls(conf.outbound.tls);
    }
    if (conf.inbound && conf.inbound.tls) {
        slice.inboundTls = copyTls(conf.inbound.tls);
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
        if (outboundTls) {
            next.outbound = {
                ...baseConf.outbound,
                tls: {
                    ...baseConf.outbound?.tls,
                    ...outboundTls,
                    creds: {
                        ...baseConf.outbound?.tls?.creds,
                        ...outboundTls.creds,
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
