import {createFrontendServer} from './frontend-server.js';

const port = Number(process.env.PORT || 4173);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new TypeError('PORT must be an integer from 1 to 65535');
const server = createFrontendServer({root: process.argv[2] || 'dist'});
server.listen(port, '127.0.0.1', () => console.log(`Biopeia Frontend local-only: http://127.0.0.1:${port}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
