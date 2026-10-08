'use strict';

const http = require('http');

const port = Number(process.env.PORT || 3000);

const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        console.log(`[mock-backend] ${req.method} ${req.url}`);
        if (body) console.log(body);

        res.setHeader('content-type', 'application/json');

        if (req.method === 'GET' && req.url.startsWith('/parties/')) {
            // Schéma CBS du SDK (pas FSPIOP). Type/ID viennent du path ; le SDK complète le PUT Hub.
            res.end(JSON.stringify({
                firstName: 'POC',
                lastName: 'Party',
                middleName: 'Test',
                dateOfBirth: '1980-01-01',
            }));
            return;
        }

        res.statusCode = 200;
        res.end(JSON.stringify({ status: 'ok', path: req.url }));
    });
});

server.listen(port, () => {
    console.log(`[mock-backend] listening on :${port}`);
});
