'use strict';

/**
 * Slim CBS-facing outbound JSON: drop axios config, ILP packets, Hub headers.
 * Full dump: header X-SDK-Verbose: 1 (still requires OUTBOUND_API_KEY if set).
 */

const stripAgents = (value) => {
    if (!value || typeof value !== 'object') {
        return;
    }
    if (Array.isArray(value)) {
        value.forEach(stripAgents);
        return;
    }
    delete value.httpsAgent;
    delete value.httpAgent;
    Object.values(value).forEach(stripAgents);
};

const errorInfo = (body) => {
    const nested = body && body.lastError && body.lastError.mojaloopError
        && body.lastError.mojaloopError.errorInformation;
    if (nested) {
        return {
            errorCode: nested.errorCode,
            errorDescription: nested.errorDescription,
        };
    }
    if (body && body.statusCode && body.message) {
        return { errorCode: body.statusCode, errorDescription: body.message };
    }
    return null;
};

const compactBody = (body, dfspId) => {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return body;
    }
    if (!body.currentState && !body.transferId && !body.homeTransactionId) {
        stripAgents(body);
        return body;
    }
    return {
        ok: body.currentState === 'COMPLETED'
            && (!body.fulfil || !body.fulfil.body
                || body.fulfil.body.transferState === 'COMMITTED'),
        currentState: body.currentState,
        transferId: body.transferId,
        homeTransactionId: body.homeTransactionId,
        direction: body.direction,
        initiatedTimestamp: body.initiatedTimestamp,
        payer: body.from ? {
            fsp: dfspId || body.from.fspId || null,
            idType: body.from.idType,
            idValue: body.from.idValue,
        } : undefined,
        payee: body.to ? {
            fsp: body.to.fspId || null,
            idType: body.to.idType,
            idValue: body.to.idValue,
        } : undefined,
        amount: body.amount,
        currency: body.currency,
        quoteId: body.quoteId,
        fulfilState: (body.fulfil && body.fulfil.body && body.fulfil.body.transferState) || null,
        error: errorInfo(body),
    };
};

const requireOutboundApiKey = (conf) => async (ctx, next) => {
    const expected = conf.outboundApiKey;
    if (!expected) {
        await next();
        return;
    }
    const sent = ctx.get('x-api-key')
        || (ctx.get('authorization') || '').replace(/^Bearer\s+/i, '');
    if (sent !== expected) {
        ctx.status = 401;
        ctx.body = { statusCode: '401', message: 'outbound API key required' };
        return;
    }
    await next();
};

const compactOutboundResponse = (conf) => async (ctx, next) => {
    await next();
    const body = ctx.response.body;
    if (!body || typeof body !== 'object') {
        return;
    }
    const verbose = /^1|true|yes$/i.test(ctx.get('x-sdk-verbose') || '');
    const compactOn = conf.pm4mlMultiTenant && conf.outboundCompactResponse !== false;
    if (compactOn && !verbose) {
        ctx.response.body = compactBody(body, ctx.state.pm4mlDfspId);
        return;
    }
    stripAgents(body);
};

module.exports = {
    compactBody,
    compactOutboundResponse,
    requireOutboundApiKey,
};
