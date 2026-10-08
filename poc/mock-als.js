'use strict';

const http = require('http');

const port = Number(process.env.PORT || 4002);

http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
        console.log(`[mock-als] ${req.method} ${req.url}`);
        res.statusCode = req.method === 'GET' ? 202 : 200;
        res.end();
    });
}).listen(port, () => {
    console.log(`[mock-als] listening on :${port}`);
});
